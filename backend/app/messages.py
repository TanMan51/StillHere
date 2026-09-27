"""Every SMS wording in one place, so it can be edited without touching logic. Owner: Person A."""

from __future__ import annotations

from datetime import datetime
from zoneinfo import ZoneInfo

from . import config


def _local_time(dt: datetime) -> str:
    return dt.astimezone(ZoneInfo(config.HOUSEHOLD_TZ)).strftime("%I:%M %p").lstrip("0")


# Texts name the resident (their first name) and use neutral wording, never "Mom" or "her":
# the same sensor can be followed by family and by community staff.


def inactivity(
    device_name: str, last_motion: datetime, person: str, note: str | None = None
) -> str:
    """note is the learned routine's own sentence (routine.evaluate), used as-is when present."""
    if note:
        return f"StillHere: {note}"
    return (
        f"StillHere: No activity from {device_name} since {_local_time(last_motion)}. "
        f"You may want to call {person}."
    )


def urgent(device_name: str, person: str) -> str:
    return f"URGENT from StillHere: {person} asked for help near {device_name}. Please call now."


def resident_urgent(first_name: str, unit: str) -> str:
    return (
        f"URGENT from StillHere: {first_name} in apartment {unit} asked for help. "
        "Please check in now."
    )


def weather_quiet(event: str, first_name: str, last_motion: datetime | None) -> str:
    quiet = (
        f"has been quiet since {_local_time(last_motion)}"
        if last_motion
        else "has no movement recorded today"
    )
    return (
        f"StillHere: {event} in effect. {first_name}'s apartment {quiet}. You may want to check in."
    )


def escalated(original: str, minutes: int) -> str:
    return f"StillHere: not yet acknowledged after {minutes} minutes. {original}"


def resident_no_reply(first_name: str, unit: str) -> str:
    return (
        f"StillHere: Loud sound in apartment {unit} ({first_name}), and no reply when asked "
        "if they're okay. Please check in."
    )


def _trigger_phrase(trigger: str) -> str:
    return "Possible fall detected" if trigger == "fall" else "Loud sound"


def no_reply(device_name: str, person: str, trigger: str = "loud") -> str:
    """trigger is the event that started the "Are you okay?" check: "loud" or "fall"."""
    return (
        f"StillHere: {_trigger_phrase(trigger)} near {device_name}, and no reply when {person} "
        "was asked if they're okay. You may want to call."
    )


def false_alarm(device_name: str, person: str, trigger: str = "loud") -> str:
    return f'{_trigger_phrase(trigger)}, then {person} pressed "I\'m okay". No text sent.'


def offline(device_name: str) -> str:
    return f"StillHere: {device_name} sensor is offline. Its battery or Wi-Fi may need a check."


def all_clear(device_name: str, person: str) -> str:
    return (
        f"StillHere: Activity detected at {device_name} since the alert. {person} is likely okay."
    )


def test_message(contact_name: str) -> str:
    return f"StillHere: Hi {contact_name}, this is a test. You'll get alerts at this number."


def email_subject(body: str) -> str:
    return "URGENT: StillHere alert" if body.startswith("URGENT") else "StillHere alert"
