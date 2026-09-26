"""The community housing grid: one cell per apartment, colored by time since movement.
Owner: Person A.

The backend decides each cell's state so the dashboard only displays it (contract rule).
A resident with several devices counts as moving when any of them moved, and as offline only
when none of them is online, so one dead battery never hides a resident who is up and about.
"""

from __future__ import annotations

from datetime import datetime, time, timedelta
from zoneinfo import ZoneInfo

from sqlmodel import Session, col, select

from . import clock, config, routine
from .models import Alert, Community, Device, Event, Resident
from .routing import URGENT_KINDS
from .serialize import active_alert, alert_dict, is_online


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


def resident_trend(session: Session, resident: Resident) -> routine.Trend:
    now = clock.now()
    device_ids = session.exec(select(Device.id).where(Device.resident_id == resident.id)).all()
    times = session.exec(
        select(Event.ts).where(
            col(Event.device_id).in_(device_ids),
            Event.type == "motion",
            Event.ts >= now - timedelta(days=routine.trends.TREND_DAYS),
        )
    ).all()
    return routine.activity_trend([clock.as_utc(t) for t in times], now, config.HOUSEHOLD_TZ)


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
        "activity_lower_than_usual": resident_trend(session, resident).lower_than_usual,
    }


def community_dict(community: Community) -> dict:
    return {
        "id": community.id,
        "name": community.name,
        "watch_after_minutes": community.watch_after_minutes,
        "worry_after_minutes": community.worry_after_minutes,
        "on_call_phone": community.on_call_phone,
        "escalate_after_minutes": community.escalate_after_minutes,
        "checkin_time": community.checkin_time,
    }


def checkin_since(checkin_time: str, now: datetime, timezone: str) -> datetime:
    """The most recent occurrence of the local check-in time: today's once it has passed,
    otherwise yesterday's."""
    zone = ZoneInfo(timezone)
    local_now = now.astimezone(zone)
    hour, minute = (int(part) for part in checkin_time.split(":"))
    since = datetime.combine(local_now.date(), time(hour, minute), tzinfo=zone)
    if since > local_now:
        since -= timedelta(days=1)
    return since.astimezone(now.tzinfo)


def checkin_list(community: Community, units: list[dict]) -> dict:
    """Residents with no movement since the check-in time, longest inactivity first."""
    since = checkin_since(community.checkin_time, clock.now(), config.HOUSEHOLD_TZ)
    quiet = [
        u
        for u in units
        if u["last_motion_at"] is None or datetime.fromisoformat(u["last_motion_at"]) < since
    ]
    # Longest inactivity first; residents with no movement on record lead the list.
    quiet.sort(key=lambda u: -(u["minutes_since_motion"] or float("inf")))
    return {
        "time": community.checkin_time,
        "since": clock.iso(since),
        "resident_ids": [u["resident_id"] for u in quiet],
    }


def response_times(alerts: list[Alert]) -> dict:
    """Average staff response over the given alerts: to "I'm on it", and to resolved."""
    acknowledged = [
        (clock.as_utc(a.acknowledged_at) - clock.as_utc(a.sent_at)).total_seconds()
        for a in alerts
        if a.acknowledged_at is not None
    ]
    resolved = [
        (clock.as_utc(a.resolved_at) - clock.as_utc(a.sent_at)).total_seconds()
        for a in alerts
        if a.resolved_at is not None and a.acknowledged_at is not None
    ]
    return {
        "alerts": len(alerts),
        "acknowledged": len(acknowledged),
        "average_acknowledge_seconds": round(sum(acknowledged) / len(acknowledged))
        if acknowledged
        else None,
        "average_resolve_seconds": round(sum(resolved) / len(resolved)) if resolved else None,
    }


def recent_alerts(session: Session, resident_ids: list[str], days: int = 30) -> list[Alert]:
    """Alerts from these residents' devices over the last `days` days, newest first."""
    device_ids = session.exec(
        select(Device.id).where(col(Device.resident_id).in_(resident_ids))
    ).all()
    return list(
        session.exec(
            select(Alert)
            .where(
                col(Alert.device_id).in_(device_ids),
                Alert.sent_at >= clock.now() - timedelta(days=days),
            )
            .order_by(col(Alert.sent_at).desc(), col(Alert.id).desc())
        ).all()
    )


def grid(session: Session, community: Community) -> list[dict]:
    residents = session.exec(
        select(Resident)
        .where(Resident.community_id == community.id)
        .order_by(Resident.floor, Resident.unit)
    ).all()
    return [resident_cell(session, community, r) for r in residents]
