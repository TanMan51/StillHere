"""Replays the routine model day by day, for the "watch it learn" demo. Owned by Person B.

Pure, like the rest of routine/: motion times, now, and the timezone in; frames out. Each frame
is the real model (compute_baseline) as it stood at the end of one day, plus that day's visits,
so the dashboard can show the schedule being learned rather than an illustration of it.
"""

from __future__ import annotations

import math
from datetime import datetime, time, timedelta
from zoneinfo import ZoneInfo

from .baseline import (
    ALERT_PROBABILITY,
    HISTORY_DAYS,
    MIN_DAYS_FOR_READY,
    MIN_GAP_MINUTES,
    UTC,
    _sessions,
    compute_baseline,
    surprise,
)

# "What if they go quiet?": quiet stretches from 30 minutes to 16 hours, every half hour.
WHAT_IF_MINUTES = list(range(30, 16 * 60 + 1, 30))


def _local_midnight(day, zone: ZoneInfo) -> datetime:
    return datetime.combine(day, time(), tzinfo=zone).astimezone(UTC)


def learning_replay(
    motion_times: list[datetime], now: datetime, timezone: str, max_days: int = HISTORY_DAYS
) -> dict:
    """One frame per local day, oldest first, ending today (the model as of now).

    A frame is {"date", "days_of_data", "ready", "hourly_rate" (learned visits per hour at each
    local hour), "hourly_threshold_minutes", "visits" (minutes after local midnight of that
    day's visits)}. "now" describes the current quiet stretch under today's model.
    """
    if now.tzinfo is None:
        raise ValueError("Expected a timezone-aware now")
    zone = ZoneInfo(timezone)
    end = now.astimezone(UTC)
    times = sorted({t.astimezone(UTC) for t in motion_times if t.astimezone(UTC) <= end})
    today = end.astimezone(zone).date()
    frames = []
    if times:
        first = max(times[0].astimezone(zone).date(), today - timedelta(days=max_days - 1))
        visits_by_day: dict = {}
        for t in _sessions(times):
            local = t.astimezone(zone)
            visits_by_day.setdefault(local.date(), []).append(local.hour * 60 + local.minute)
        day = first
        while day <= today:
            cutoff = end if day == today else _local_midnight(day + timedelta(days=1), zone)
            baseline = compute_baseline(times, cutoff, timezone)
            frames.append(
                {
                    "date": day.isoformat(),
                    "days_of_data": baseline.days_of_data,
                    "ready": baseline.ready,
                    "hourly_rate": baseline.hourly_rate or [0.0] * 24,
                    "hourly_threshold_minutes": baseline.hourly_threshold_minutes,
                    "visits": visits_by_day.get(day, []),
                }
            )
            day += timedelta(days=1)

    current = compute_baseline(times, end, timezone)
    last = times[-1] if times else None
    quiet = (end - last).total_seconds() / 60 if last else None
    chance = None
    if last is not None and current.ready and current.hourly_rate:
        chance = round(math.exp(-surprise(current, last, end)), 4)
    # The same judgment for quiet stretches of other lengths ending now, so the dashboard can
    # show where the model would start to worry without doing any of the math itself.
    what_if = []
    if current.ready and current.hourly_rate:
        for minutes in WHAT_IF_MINUTES:
            odds = round(math.exp(-surprise(current, end - timedelta(minutes=minutes), end)), 4)
            what_if.append(
                {
                    "quiet_minutes": minutes,
                    "chance": odds,
                    "unusual": odds < ALERT_PROBABILITY and minutes >= MIN_GAP_MINUTES,
                }
            )
    return {
        "timezone": timezone,
        "days_needed": MIN_DAYS_FOR_READY,
        "alert_probability": ALERT_PROBABILITY,
        "min_gap_minutes": MIN_GAP_MINUTES,
        "frames": frames,
        "what_if": what_if,
        "now": {
            "last_motion_at": (
                last.replace(microsecond=0).isoformat().replace("+00:00", "Z") if last else None
            ),
            "quiet_minutes": round(quiet) if quiet is not None else None,
            # Chance of a quiet stretch this long under the learned model; null until learned.
            "chance_of_quiet": chance,
            "unusual": chance is not None
            and chance < ALERT_PROBABILITY
            and (quiet or 0) >= MIN_GAP_MINUTES,
        },
    }
