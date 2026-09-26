"""The one clock every piece of backend code reads. Owner: Person A.

Normal mode: now() is real UTC time.
Demo mode:   now() = start_clock_at + real seconds since enabling x time_scale.

Use now() for anything on the household's timeline (event timestamps, inactivity
limits, the baseline). Use real_now() only for the things the contract keeps in
real time: offline detection, the 30 s reply window, and seconds_until_alert.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

from . import config

UTC = timezone.utc

_enabled = False
_time_scale = 1.0
_clock_started_at: datetime | None = None  # simulated time at the moment demo was enabled
_real_started_at: datetime | None = None


def real_now() -> datetime:
    return datetime.now(UTC)


def now() -> datetime:
    if not _enabled:
        return real_now()
    elapsed = real_now() - _real_started_at
    return _clock_started_at + elapsed * _time_scale


def enabled() -> bool:
    return _enabled


def time_scale() -> float:
    return _time_scale if _enabled else 1.0


def clock_started_at() -> datetime | None:
    return _clock_started_at if _enabled else None


def enable(time_scale: float | None = None, start_clock_at: datetime | None = None) -> None:
    global _enabled, _time_scale, _clock_started_at, _real_started_at
    start = as_utc(start_clock_at) if start_clock_at else now()
    _enabled = True
    _time_scale = float(time_scale or config.DEMO_TIME_SCALE)
    _clock_started_at = start
    _real_started_at = real_now()


def disable() -> None:
    global _enabled, _time_scale, _clock_started_at, _real_started_at
    _enabled, _time_scale, _clock_started_at, _real_started_at = False, 1.0, None, None


def to_real_seconds(sim: timedelta) -> float:
    """Convert a span on the demo clock to real seconds."""
    return sim.total_seconds() / time_scale()


def as_utc(dt: datetime | None) -> datetime | None:
    """Normalize to aware UTC (naive values are assumed to already be UTC)."""
    if dt is None:
        return None
    return dt.replace(tzinfo=UTC) if dt.tzinfo is None else dt.astimezone(UTC)


def iso(dt: datetime | None) -> str | None:
    """Contract timestamp format: ISO 8601 UTC with a Z."""
    if dt is None:
        return None
    return as_utc(dt).isoformat(timespec="seconds").replace("+00:00", "Z")
