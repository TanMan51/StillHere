"""Pure, timezone-aware routine learning. Owned by Person B.

Thresholds describe elapsed inactivity at each local hour, not the duration
of every gap touching that hour. This lets an ordinary night be quiet while
still noticing that the usual breakfast activity never happened.
"""

from __future__ import annotations

from bisect import bisect_right
from dataclasses import asdict, dataclass, field
from datetime import datetime, timedelta
from datetime import timezone as dt_timezone
from math import ceil
from zoneinfo import ZoneInfo

MIN_DAYS_FOR_READY = 5
UTC = dt_timezone.utc


@dataclass
class Baseline:
    ready: bool
    days_of_data: int
    timezone: str
    hourly_activity: list[float] = field(default_factory=lambda: [0.0] * 24)
    hourly_threshold_minutes: list[float] = field(default_factory=lambda: [0.0] * 24)

    def to_dict(self) -> dict:
        """Exactly the baseline object in contract/api.md."""
        return asdict(self)


@dataclass
class Verdict:
    irregular: bool
    reason: str | None
    note: str | None


def _utc(value: datetime) -> datetime:
    if value.tzinfo is None or value.utcoffset() is None:
        raise ValueError("Expected a timezone-aware datetime")
    return value.astimezone(UTC)


def compute_baseline(motion_times: list[datetime], now: datetime, timezone: str) -> Baseline:
    """Learn from the last 28 days, excluding future events and duplicate timestamps.

    For each historical hour, sample elapsed inactivity at its start, end,
    and immediately before each motion. Use p90 * 1.5, with a 60-minute floor.
    Missing hours use a conservative 2880-minute ceiling. The caller's fixed
    limit is applied by evaluate(), since it is not part of this signature.
    Partial boundary days do not count toward the five-day readiness rule.
    """
    end = _utc(now)
    zone = ZoneInfo(timezone)
    history_start = end - timedelta(days=28)
    normalized_times = {_utc(t) for t in motion_times}
    times = sorted(t for t in normalized_times if history_start <= t < end)
    if not times:
        return Baseline(False, 0, timezone)
    first_day = times[0].astimezone(zone).date()
    today = end.astimezone(zone).date()
    observed_days = (today - first_day).days
    counts = [0] * 24
    complete_active_days = set()
    for t in times:
        local = t.astimezone(zone)
        if local.date() < today:
            counts[local.hour] += 1
        # Require five complete local days with motion; exclude the first partial day.
        if first_day < local.date() < today:
            complete_active_days.add(local.date())
    samples: list[list[float]] = [[] for _ in range(24)]
    first_hour = times[0].astimezone(zone).replace(minute=0, second=0, microsecond=0)
    cursor = first_hour.astimezone(UTC) + timedelta(hours=1)
    while cursor + timedelta(hours=1) <= end:
        stop = cursor + timedelta(hours=1)
        local = cursor.astimezone(zone)
        if first_day < local.date() < today:
            index = bisect_right(times, cursor) - 1
            if index >= 0:
                last = times[index]
                maximum = (cursor - last).total_seconds() / 60
                index += 1
                while index < len(times) and times[index] < stop:
                    maximum = max(maximum, (times[index] - last).total_seconds() / 60)
                    last = times[index]
                    index += 1
                maximum = max(maximum, (stop - last).total_seconds() / 60)
                samples[local.hour].append(maximum)
        cursor = stop
    thresholds = []
    for values in samples:
        p90 = sorted(values)[ceil(len(values) * 0.9) - 1] if values else 1920
        thresholds.append(round(max(60.0, min(2880.0, p90 * 1.5)), 2))
    days = len(complete_active_days)
    return Baseline(
        days >= MIN_DAYS_FOR_READY,
        days,
        timezone,
        [round(c / max(1, observed_days), 3) for c in counts],
        thresholds,
    )


def _threshold(baseline: Baseline, now: datetime, fixed_limit_minutes: int) -> tuple[float, str]:
    if fixed_limit_minutes <= 0:
        raise ValueError("fixed_limit_minutes must be positive")
    if baseline.ready:
        learned = baseline.hourly_threshold_minutes[
            now.astimezone(ZoneInfo(baseline.timezone)).hour
        ]
        if 0 < learned < fixed_limit_minutes:
            return learned, "learned"
    return float(fixed_limit_minutes), "fixed_limit"


def evaluate(
    baseline: Baseline,
    last_motion: datetime | None,
    now: datetime,
    fixed_limit_minutes: int,
    device_name: str,
) -> Verdict:
    """Apply the smaller of this hour's learned threshold and the fixed limit.

    Equality triggers a check-in so next_alert_time() and evaluate() agree.
    No motion yet is left to the backend's onboarding/offline policy.
    """
    current = _utc(now)
    if last_motion is None:
        return Verdict(False, None, None)
    gap = (current - _utc(last_motion)).total_seconds() / 60
    threshold, reason = _threshold(baseline, current, fixed_limit_minutes)
    if gap < threshold:
        return Verdict(False, None, None)
    note = None
    if reason == "learned":
        local = current.astimezone(ZoneInfo(baseline.timezone))
        note = (
            f"{device_name} has had no activity for {int(gap)} minutes. "
            f"That is longer than usual around {local.strftime('%I:%M %p')} "
            f"({baseline.timezone}). You may want to check in."
        )
    return Verdict(True, reason, note)


def next_alert_time(
    baseline: Baseline, last_motion: datetime | None, now: datetime, fixed_limit_minutes: int
) -> datetime | None:
    """Find the first threshold crossing, including drops at local hour changes.

    Walk in UTC to handle skipped/repeated DST hours correctly. The minute
    scan also finds local hour transitions in half/quarter-hour timezones.
    The result is on the server clock; Person A converts to real seconds.
    """
    current = _utc(now)
    if last_motion is None:
        return None
    last = _utc(last_motion)
    deadline = last + timedelta(minutes=fixed_limit_minutes)
    if not baseline.ready:
        return max(current, deadline)
    cursor = current
    while cursor <= deadline:
        threshold, _ = _threshold(baseline, cursor, fixed_limit_minutes)
        crossing = last + timedelta(minutes=threshold)
        if crossing <= cursor:
            return cursor
        next_minute = cursor.replace(second=0, microsecond=0) + timedelta(minutes=1)
        if crossing < next_minute:
            return crossing
        cursor = next_minute
    return max(current, deadline)
