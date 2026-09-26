"""The community housing grid: one cell per apartment, colored by time since movement.
Owner: Person A.

The backend decides each cell's state so the dashboard only displays it (contract rule).
A resident with several devices counts as moving when any of them moved, and as offline only
when none of them is online, so one dead battery never hides a resident who is up and about.
"""

from __future__ import annotations

from datetime import datetime

from sqlmodel import Session, col, select

from . import clock
from .models import Community, Device, Event, Resident
from .serialize import active_alert, alert_dict, is_online

# Alerts that turn a cell urgent: "help" heard, or no reply after a loud sound or fall.
URGENT_KINDS = {"urgent", "no_reply"}


def grid_state(
    minutes_since_motion: float | None,
    online: bool,
    urgent: bool,
    watch_after_minutes: int,
    worry_after_minutes: int,
) -> str:
    """fine, watch, worry, offline, or urgent. Urgent wins; offline beats any time-based color
    so a silent device never looks like a resident who is fine."""
    if urgent:
        return "urgent"
    if not online:
        return "offline"
    if minutes_since_motion is None or minutes_since_motion >= worry_after_minutes:
        return "worry"
    if minutes_since_motion >= watch_after_minutes:
        return "watch"
    return "fine"


def _latest(values: list[datetime | None]) -> datetime | None:
    present = [clock.as_utc(v) for v in values if v is not None]
    return max(present, default=None)


def resident_cell(session: Session, community: Community, resident: Resident) -> dict:
    now = clock.now()
    devices = session.exec(
        select(Device).where(Device.resident_id == resident.id).order_by(Device.id)
    ).all()
    last_motion = _latest([d.last_motion_at for d in devices])
    online = any(is_online(d) for d in devices)
    # Urgent alerts first, then the newest.
    alerts = sorted(
        (a for d in devices if (a := active_alert(session, d.id)) is not None),
        key=lambda a: (a.kind not in URGENT_KINDS, -clock.as_utc(a.sent_at).timestamp()),
    )
    alert = alerts[0] if alerts else None
    minutes = (now - last_motion).total_seconds() / 60 if last_motion else None
    last_event = session.exec(
        select(Event)
        .where(col(Event.device_id).in_([d.id for d in devices]), Event.type != "heartbeat")
        .order_by(col(Event.ts).desc(), col(Event.id).desc())
    ).first()
    # The device to open on click: the one with the alert, else the one that moved last.
    by_motion = sorted(
        devices, key=lambda d: clock.as_utc(d.last_motion_at) or clock.as_utc(d.status_since)
    )
    primary = next((d for d in devices if alert and d.id == alert.device_id), None) or (
        by_motion[-1] if by_motion else None
    )
    return {
        "resident_id": resident.id,
        "first_name": resident.first_name,
        "last_name": resident.last_name,
        "floor": resident.floor,
        "unit": resident.unit,
        "state": grid_state(
            minutes,
            online,
            alert is not None and alert.kind in URGENT_KINDS,
            community.watch_after_minutes,
            community.worry_after_minutes,
        ),
        "minutes_since_motion": round(minutes) if minutes is not None else None,
        "last_motion_at": clock.iso(last_motion),
        "last_event": (
            {"type": last_event.type, "value": last_event.value, "ts": clock.iso(last_event.ts)}
            if last_event
            else None
        ),
        "online": online,
        "last_heartbeat_at": clock.iso(_latest([d.last_heartbeat_at for d in devices])),
        "device_id": primary.id if primary else None,
        "device_status": primary.status if primary else None,
        "active_alert": alert_dict(alert) if alert else None,
    }


def community_dict(community: Community) -> dict:
    return {
        "id": community.id,
        "name": community.name,
        "watch_after_minutes": community.watch_after_minutes,
        "worry_after_minutes": community.worry_after_minutes,
    }


def grid(session: Session, community: Community) -> list[dict]:
    residents = session.exec(
        select(Resident)
        .where(Resident.community_id == community.id)
        .order_by(Resident.floor, Resident.unit)
    ).all()
    return [resident_cell(session, community, r) for r in residents]
