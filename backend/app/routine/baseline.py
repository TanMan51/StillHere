"""Learned daily routine for one device.

Owner: Person B. Person A calls these functions from checker.py and the API
but never edits this file.

Everything here is a pure function: no database, no clock, no network.
Callers pass in the data and the current time (from clock.now(), so the demo
clock works automatically).

This is the v1 STUB. The function signatures are the agreement between A and B.
The bodies only apply the fixed limit for now. Person B replaces the bodies
later WITHOUT changing any signature or field name.
"""

from __future__ import annotations

from dataclasses import asdict, dataclass, field
from datetime import datetime, timedelta

MIN_DAYS_FOR_READY = 5


@dataclass
class Baseline:
    ready: bool
    days_of_data: int
    timezone: str
    hourly_activity: list[float] = field(default_factory=lambda: [0.0] * 24)
    hourly_threshold_minutes: list[float] = field(default_factory=lambda: [0.0] * 24)

    def to_dict(self) -> dict:
        """Exactly the `baseline` object in contract/api.md."""
        return asdict(self)


@dataclass
class Verdict:
    irregular: bool
    reason: str | None  # "learned", "fixed_limit", or None
    note: str | None  # sentence for the SMS and the dashboard's routine_note, or None


def compute_baseline(motion_times: list[datetime], now: datetime, timezone: str) -> Baseline:
    """Learn the device's usual daily pattern from past motion events.

    motion_times: timezone-aware UTC datetimes of motion events, in any order.
    now: the current time. Only events before `now` count.
    timezone: IANA name like "America/New_York". Hour-of-day buckets use it.
    """
    return Baseline(ready=False, days_of_data=0, timezone=timezone)


def evaluate(
    baseline: Baseline,
    last_motion: datetime | None,
    now: datetime,
    fixed_limit_minutes: int,
    device_name: str,
) -> Verdict:
    """Decide whether the current stretch without motion is unusual.

    Flags when the gap passes the learned threshold for the current hour
    (reason "learned") or the fixed limit (reason "fixed_limit"), whichever
    comes first. When `note` is None, the caller uses its standard message.
    last_motion is None when the device has never reported motion.
    """
    if last_motion is None:
        return Verdict(irregular=False, reason=None, note=None)
    gap_minutes = (now - last_motion) / timedelta(minutes=1)
    if gap_minutes > fixed_limit_minutes:
        return Verdict(irregular=True, reason="fixed_limit", note=None)
    return Verdict(irregular=False, reason=None, note=None)


def next_alert_time(
    baseline: Baseline,
    last_motion: datetime | None,
    now: datetime,
    fixed_limit_minutes: int,
) -> datetime | None:
    """When evaluate() will first flag, assuming no new motion arrives.

    Used for next_alert_at in the API. Returned on the same clock as `now`
    (the demo clock in demo mode); the caller converts it to real seconds.
    Returns None when the device has never reported motion.
    """
    if last_motion is None:
        return None
    return last_motion + timedelta(minutes=fixed_limit_minutes)
