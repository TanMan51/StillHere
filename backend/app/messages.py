"""Every SMS wording in one place, so it can be edited without touching logic. Owner: Person A."""

from __future__ import annotations

from datetime import datetime
from zoneinfo import ZoneInfo

from . import config


def _local_time(dt: datetime) -> str:
    return dt.astimezone(ZoneInfo(config.HOUSEHOLD_TZ)).strftime("%I:%M %p").lstrip("0")


def inactivity(device_name: str, last_motion: datetime, note: str | None = None) -> str:
    extra = f" {note}" if note else ""
    return (
        f"StillHere: No activity from {device_name} since {_local_time(last_motion)}.{extra} "
        "You may want to call her."
    )


def urgent(device_name: str) -> str:
    return f"URGENT from StillHere: Mom asked for help near {device_name}. Please call her now."


def no_reply(device_name: str) -> str:
    return (
        "StillHere: Loud sound at Mom's, and no reply when asked if she's okay. "
        "You may want to call."
    )


def false_alarm(device_name: str) -> str:
    return 'Loud sound, then Mom pressed "I\'m okay". No text sent.'


def offline(device_name: str) -> str:
    return f"StillHere: {device_name} sensor is offline. Its battery or Wi-Fi may need a check."


def all_clear(device_name: str) -> str:
    return f"StillHere: Activity detected at {device_name} since the alert. She's likely okay."


def test_message(contact_name: str) -> str:
    return f"StillHere: Hi {contact_name}, this is a test. You'll get alerts at this number."
