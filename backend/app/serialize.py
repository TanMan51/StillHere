"""Turn database rows into exactly the JSON shapes in contract/api.md. Owner: Person A."""

from __future__ import annotations

from sqlmodel import Session, col, select

from . import clock, config, routine
from .models import Alert, Contact, Device, Event


def alert_dict(a: Alert) -> dict:
    return {
        "id": a.id,
        "device_id": a.device_id,
        "kind": a.kind,
        "message": a.message,
        "sms_sent": a.sms_sent,
        "sent_at": clock.iso(a.sent_at),
        "resolved_at": clock.iso(a.resolved_at),
        "resolved_by": a.resolved_by,
    }


def event_dict(e: Event) -> dict:
    return {"id": e.id, "type": e.type, "value": e.value, "level": e.level, "ts": clock.iso(e.ts)}


def contact_dict(c: Contact) -> dict:
    return {"id": c.id, "name": c.name, "phone": c.phone, "created_at": clock.iso(c.created_at)}


def is_online(device: Device) -> bool:
    seen = clock.as_utc(device.last_seen_real_at)
    return seen is not None and clock.real_now() - seen <= config.OFFLINE_AFTER


def active_alert(session: Session, device_id: str) -> Alert | None:
    return session.exec(
        select(Alert)
        .where(Alert.device_id == device_id, col(Alert.resolved_at).is_(None))
        .order_by(col(Alert.sent_at).desc())
    ).first()


def device_baseline(session: Session, device: Device) -> routine.Baseline:
    now = clock.now()
    times = session.exec(
        select(Event.ts).where(
            Event.device_id == device.id,
            Event.type == "motion",
            Event.ts <= now,
        )
    ).all()
    return routine.compute_baseline([clock.as_utc(t) for t in times], now, config.HOUSEHOLD_TZ)


def device_dict(session: Session, device: Device, baseline: routine.Baseline | None = None) -> dict:
    now = clock.now()
    baseline = baseline or device_baseline(session, device)
    last_motion = clock.as_utc(device.last_motion_at)
    alert = active_alert(session, device.id)
    online = is_online(device)

    verdict = routine.evaluate(baseline, last_motion, now, device.limit_minutes, device.name)
    next_alert = None
    seconds_until = None
    if alert is None and online and device.status == "ok":
        next_alert = routine.next_alert_time(baseline, last_motion, now, device.limit_minutes)
        if next_alert is not None:
            seconds_until = max(0, round(clock.to_real_seconds(next_alert - now)))

    return {
        "id": device.id,
        "name": device.name,
        "object_type": device.object_type,
        "status": device.status,
        "status_since": clock.iso(device.status_since),
        "online": online,
        "last_motion_at": clock.iso(last_motion),
        "last_heartbeat_at": clock.iso(device.last_heartbeat_at),
        "limit_minutes": device.limit_minutes,
        "next_alert_at": clock.iso(next_alert),
        "seconds_until_alert": seconds_until,
        "routine_note": verdict.note if baseline.ready else None,
        "active_alert": alert_dict(alert) if alert else None,
    }


def device_detail_dict(session: Session, device: Device) -> dict:
    baseline = device_baseline(session, device)
    events = session.exec(
        select(Event)
        .where(Event.device_id == device.id, Event.type != "heartbeat")
        .order_by(col(Event.ts).desc(), col(Event.id).desc())
        .limit(50)
    ).all()
    alerts = session.exec(
        select(Alert)
        .where(Alert.device_id == device.id)
        .order_by(col(Alert.sent_at).desc(), col(Alert.id).desc())
        .limit(50)
    ).all()
    return {
        **device_dict(session, device, baseline),
        "events": [event_dict(e) for e in events],
        "alerts": [alert_dict(a) for a in alerts],
        "baseline": baseline.to_dict(),
    }
