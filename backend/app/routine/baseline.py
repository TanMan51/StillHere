"""Pure, timezone-aware routine learning. Owned by Person B.

The learned routine is a probabilistic model of when this person is usually active: a
non-homogeneous Poisson process whose rate depends on the local hour of day. It is fitted
from the last four weeks of motion with Bayesian (Gamma-Poisson) estimates, recent days
weighted more than older ones, and each hour smoothed with its neighbours. For any quiet
stretch the model gives the probability of seeing no activity at all over it; when that
probability drops below ALERT_PROBABILITY, the silence is unusual for this person.

Scoring the whole stretch, rather than only the current hour, keeps an ordinary night quiet
while still noticing that the usual breakfast activity never happened.
"""

from __future__ import annotations

import math
from dataclasses import asdict, dataclass, field
from datetime import date, datetime, timedelta
from datetime import timezone as dt_timezone
from zoneinfo import ZoneInfo

MIN_DAYS_FOR_READY = 5
HISTORY_DAYS = 28
UTC = dt_timezone.utc

# Alert when a silence this long had less than this chance under the learned model.
ALERT_PROBABILITY = 0.05
SURPRISE_LIMIT = -math.log(ALERT_PROBABILITY)
# Never call a gap unusual before an hour has passed, whatever the model says.
MIN_GAP_MINUTES = 60.0
MAX_THRESHOLD_MINUTES = 2880.0
# Motion within this many minutes of the previous event is the same visit (one fridge
# opening shakes the sensor several times), so it counts once.
SESSION_GAP_MINUTES = 5
# A day's weight halves every this many days, so the model follows changing habits.
HALF_LIFE_DAYS = 7.0
# Gamma prior on each hour's rate: PRIOR_EVENTS events over PRIOR_DAYS days. It keeps hours
# never seen active from getting a rate of exactly zero.
PRIOR_EVENTS = 0.002
PRIOR_DAYS = 0.1
# Share of each hour's rate that spills into each neighbouring hour, for habits that drift
# across an hour boundary (breakfast at 7:55 one day and 8:05 the next).
NEIGHBOUR_SHARE = 0.15
# Walk time in quarter hours: every timezone offset is a multiple of 15 minutes, so the local
# hour, and with it the rate, is constant inside each step.
STEP = timedelta(minutes=15)


@dataclass
class Baseline:
    ready: bool
    days_of_data: int
    timezone: str
    hourly_activity: list[float] = field(default_factory=lambda: [0.0] * 24)
    hourly_threshold_minutes: list[float] = field(default_factory=lambda: [0.0] * 24)
    # Learned visits per hour at each local hour of day. Internal, not in the contract.
    hourly_rate: list[float] | None = None

    def to_dict(self) -> dict:
        """Exactly the baseline object in contract/api.md."""
        data = asdict(self)
        del data["hourly_rate"]
        return data


@dataclass
class Verdict:
    irregular: bool
    reason: str | None
    note: str | None


def _utc(value: datetime) -> datetime:
    if value.tzinfo is None or value.utcoffset() is None:
        raise ValueError("Expected a timezone-aware datetime")
    return value.astimezone(UTC)


def _sessions(times: list[datetime]) -> list[datetime]:
    """Keep the first motion of each visit."""
    gap = timedelta(minutes=SESSION_GAP_MINUTES)
    starts = times[:1]
    for previous, t in zip(times, times[1:]):
        if t - previous >= gap:
            starts.append(t)
    return starts


def _fit_rates(
    sessions: list[datetime], days: list[date], today: date, zone: ZoneInfo
) -> list[float]:
    """Posterior mean visits per hour for each local hour, recency-weighted and smoothed."""
    weight = {d: 0.5 ** ((today - d).days / HALF_LIFE_DAYS) for d in days}
    exposure = sum(weight.values())
    counts = [0.0] * 24
    for t in sessions:
        local = t.astimezone(zone)
        if local.date() in weight:
            counts[local.hour] += weight[local.date()]
    rates = [(c + PRIOR_EVENTS) / (exposure + PRIOR_DAYS) for c in counts]
    keep = 1 - 2 * NEIGHBOUR_SHARE
    return [
        keep * rates[h] + NEIGHBOUR_SHARE * (rates[h - 1] + rates[(h + 1) % 24]) for h in range(24)
    ]


def _typical_thresholds(rates: list[float]) -> list[float]:
    """For display: the silence that becomes unusual when it ends at half past each hour."""
    thresholds = []
    for hour in range(24):
        surprise, minutes = 0.0, 0.0
        clock_hour, left_in_hour = hour, 30.0
        while minutes < MAX_THRESHOLD_MINUTES:
            rate = rates[clock_hour] / 60
            if rate > 0 and surprise + rate * left_in_hour >= SURPRISE_LIMIT:
                minutes += (SURPRISE_LIMIT - surprise) / rate
                break
            surprise += rate * left_in_hour
            minutes += left_in_hour
            clock_hour, left_in_hour = (clock_hour - 1) % 24, 60.0
        thresholds.append(round(max(MIN_GAP_MINUTES, min(MAX_THRESHOLD_MINUTES, minutes)), 2))
    return thresholds


def compute_baseline(motion_times: list[datetime], now: datetime, timezone: str) -> Baseline:
    """Fit the routine model to the last 28 days, excluding future and duplicate events.

    Only complete local days count: the first (partial) day of data and today are left out
    of both the fit and the five-day readiness rule. The caller's fixed limit is applied by
    evaluate(), since it is not part of this signature.
    """
    end = _utc(now)
    zone = ZoneInfo(timezone)
    history_start = end - timedelta(days=HISTORY_DAYS)
    times = sorted(t for t in {_utc(t) for t in motion_times} if history_start <= t < end)
    if not times:
        return Baseline(False, 0, timezone)
    first_day = times[0].astimezone(zone).date()
    today = end.astimezone(zone).date()
    observed_days = (today - first_day).days
    counts = [0] * 24
    active_days = set()
    for t in times:
        local = t.astimezone(zone)
        if local.date() < today:
            counts[local.hour] += 1
        if first_day < local.date() < today:
            active_days.add(local.date())
    complete_days = [first_day + timedelta(days=i) for i in range(1, observed_days)]
    rates = _fit_rates(_sessions(times), complete_days, today, zone)
    return Baseline(
        len(active_days) >= MIN_DAYS_FOR_READY,
        len(active_days),
        timezone,
        [round(c / max(1, observed_days), 3) for c in counts],
        _typical_thresholds(rates),
        [round(r, 4) for r in rates],
    )


def _steps(start: datetime, end: datetime, zone: ZoneInfo):
    """(step start, step end, local hour) pieces covering start to end."""
    cursor = start
    while cursor < end:
        boundary = datetime.fromtimestamp(
            (cursor.timestamp() // STEP.total_seconds() + 1) * STEP.total_seconds(), UTC
        )
        stop = min(boundary, end)
        yield cursor, stop, cursor.astimezone(zone).hour
        cursor = stop


def surprise(baseline: Baseline, start: datetime, end: datetime) -> float:
    """Expected visits between start and end under the model. The chance of seeing none at
    all is exp(-surprise), so larger means more unusual."""
    if not baseline.hourly_rate:
        return 0.0
    zone = ZoneInfo(baseline.timezone)
    return sum(
        baseline.hourly_rate[hour] * (stop - begin).total_seconds() / 3600
        for begin, stop, hour in _steps(_utc(start), _utc(end), zone)
    )


def _learned(baseline: Baseline) -> bool:
    return baseline.ready and bool(baseline.hourly_rate)


def evaluate(
    baseline: Baseline,
    last_motion: datetime | None,
    now: datetime,
    fixed_limit_minutes: int,
    device_name: str,
) -> Verdict:
    """Flag the silence since last_motion when the model finds it unlikely, or when it
    reaches the fixed limit, whichever comes first.

    No motion yet is left to the backend's onboarding/offline policy.
    """
    if fixed_limit_minutes <= 0:
        raise ValueError("fixed_limit_minutes must be positive")
    current = _utc(now)
    if last_motion is None:
        return Verdict(False, None, None)
    last = _utc(last_motion)
    gap = (current - last).total_seconds() / 60
    if _learned(baseline) and MIN_GAP_MINUTES <= gap < fixed_limit_minutes:
        score = surprise(baseline, last, current)
        # A hair of slack so the moment next_alert_time() returns always counts.
        if score >= SURPRISE_LIMIT - 1e-9:
            local = current.astimezone(ZoneInfo(baseline.timezone))
            note = (
                f"{device_name} has had no activity for {describe_duration(gap)}, "
                f"which is longer than usual around {_clock_hour(local)}. "
                f"Based on recent weeks, a quiet stretch this long is {_chance(score)}. "
                "You may want to check in."
            )
            return Verdict(True, "learned", note)
    if gap >= fixed_limit_minutes:
        return Verdict(True, "fixed_limit", None)
    return Verdict(False, None, None)


def _chance(score: float) -> str:
    """exp(-score) for people: "under a 1% chance", "about a 3% chance"."""
    percent = round(100 * math.exp(-score))
    return "under a 1% chance" if percent < 1 else f"about a {percent}% chance"


def describe_duration(minutes: float) -> str:
    """Round a span for people: 675 -> "about 11 hours", 45 -> "45 minutes"."""
    if minutes < 60:
        whole = max(1, int(minutes))
        return f"{whole} minute" + ("" if whole == 1 else "s")
    hours = round(minutes / 60)
    if hours < 2:
        return "about an hour"
    if hours < 36:
        return f"about {hours} hours"
    return f"about {round(hours / 24)} days"


def _clock_hour(local: datetime) -> str:
    """8 AM rather than 08:00 AM; strftime's no-padding flag isn't portable."""
    return f"{local.hour % 12 or 12} {'AM' if local.hour < 12 else 'PM'}"


def next_alert_time(
    baseline: Baseline, last_motion: datetime | None, now: datetime, fixed_limit_minutes: int
) -> datetime | None:
    """When evaluate() will first flag the current silence if nothing moves.

    Walks forward in UTC quarter hours, so skipped or repeated DST hours and half-hour
    timezones are handled. The result is on the server clock; Person A converts to real
    seconds.
    """
    current = _utc(now)
    if last_motion is None:
        return None
    last = _utc(last_motion)
    deadline = last + timedelta(minutes=fixed_limit_minutes)
    if not _learned(baseline):
        return max(current, deadline)
    earliest = last + timedelta(minutes=MIN_GAP_MINUTES)
    zone = ZoneInfo(baseline.timezone)
    score = 0.0
    for begin, stop, hour in _steps(last, deadline, zone):
        rate = baseline.hourly_rate[hour] / 3600
        step_score = rate * (stop - begin).total_seconds()
        if rate > 0 and score + step_score >= SURPRISE_LIMIT:
            crossing = begin + timedelta(seconds=(SURPRISE_LIMIT - score) / rate)
            return max(current, earliest, crossing)
        score += step_score
    return max(current, deadline)
