"""Deterministic fake motion history; no database or network access."""

from __future__ import annotations

from datetime import datetime, time, timedelta
from datetime import timezone as dt_timezone
from random import Random
from zoneinfo import ZoneInfo


def generate_week(
    end: datetime, timezone: str, days: int = 7, object_type: str = "fridge", seed: int | None = 42
) -> list[datetime]:
    """Return sorted UTC events inside [end - days, end], with local daily habits."""
    if end.tzinfo is None or end.utcoffset() is None:
        raise ValueError("Expected a timezone-aware end")
    if days < 1 or days > 366:
        raise ValueError("days must be between 1 and 366")
    patterns = {
        "fridge": [
            7 * 60 + 20,
            7 * 60 + 50,
            8 * 60 + 15,
            12 * 60,
            12 * 60 + 20,
            17 * 60 + 45,
            18 * 60 + 15,
            18 * 60 + 40,
            20 * 60 + 30,
            22 * 60 + 10,
        ],
        "walker": [
            7 * 60 + 30,
            8 * 60 + 15,
            10 * 60,
            12 * 60,
            14 * 60 + 30,
            16 * 60,
            18 * 60,
            20 * 60,
            22 * 60,
        ],
        "door": [8 * 60 + 30, 9 * 60 + 15, 16 * 60 + 30, 17 * 60 + 15],
        "other": [8 * 60, 12 * 60, 17 * 60, 21 * 60],
    }
    if object_type not in patterns:
        raise ValueError(f"Unsupported object_type: {object_type}")
    zone = ZoneInfo(timezone)
    end = end.astimezone(dt_timezone.utc)
    start = end - timedelta(days=days)
    day = start.astimezone(zone).date()
    final_day = end.astimezone(zone).date()
    random = Random(seed)
    events = []
    while day <= final_day:
        for minute in patterns[object_type]:
            local = datetime.combine(day, time(), tzinfo=zone) + timedelta(
                minutes=minute + random.randint(-10, 10), seconds=random.randint(0, 59)
            )
            utc = local.astimezone(dt_timezone.utc)
            if start <= utc <= end:
                events.append(utc)
        day += timedelta(days=1)
    return sorted(set(events))
