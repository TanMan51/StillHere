"""Fake motion history for demo seeding.

Owner: Person B. Person A's POST /api/demo/seed endpoint calls generate_week()
and inserts the returned times as motion events.

This is the v1 STUB: it returns an empty list. Person B fills in the body later
WITHOUT changing the signature.
"""

from __future__ import annotations

from datetime import datetime


def generate_week(
    end: datetime,
    timezone: str,
    days: int = 7,
    object_type: str = "fridge",
    seed: int | None = 42,
) -> list[datetime]:
    """Realistic motion times for `days` days, ending at `end`.

    end: the current time (the demo clock in demo mode). No times after it.
    timezone: IANA name like "America/New_York". Daily habits (breakfast,
        lunch, dinner) are placed in this local time.
    object_type: "fridge", "walker", "door", or "other". Picks the daily pattern.
    seed: fixed random seed so every demo run looks the same. None = random.
    Returns timezone-aware UTC datetimes, sorted oldest first.
    """
    return []
