"""The per-device alert state machine. Owner: Person A.

Device status moves between the values in contract/api.md. Two things drive it:
events from the device (handle_event, called by POST /api/events) and the passage of
time (checker.py). Every transition goes through the helpers here so each alert fires
once and is resolved exactly once.
"""

from __future__ import annotations

import logging

from sqlmodel import Session, col, select

from . import clock, config, messages, routine, routing
from .models import Alert, Device, Event, Resident
from .serialize import device_baseline, is_online

log = logging.getLogger("stillhere.alerts")

# Loud sounds and falls are ignored while a more serious state is already active.
REPLY_FLOW_STARTS_FROM = {"ok", "inactive_alert", "awaiting_reply"}
MOTION_CLEARS = {"inactive_alert", "no_reply_alert"}


def person(session: Session, device: Device) -> str:
    """How texts name the person a device follows: the resident's first name."""
    resident = session.get(Resident, device.resident_id) if device.resident_id else None
    return resident.first_name if resident else "your family member"


def set_status(device: Device, status: str) -> None:
    if device.status != status:
        log.info("%s: %s -> %s", device.id, device.status, status)
        device.status = status
        device.status_since = clock.now()


def raise_alert(
    session: Session, device: Device, kind: str, message: str, *, sms: bool = True
) -> Alert:
    now = clock.now()
    alert = Alert(device_id=device.id, kind=kind, message=message, sent_at=now)
    # Who hears first (family, or on-call staff for urgent alerts in a community) is routing's call.
    alert.sms_sent = routing.notify_new(session, device, alert) if sms else False
    session.add(alert)
    log.info("%s: %s alert (sms_sent=%s): %s", device.id, kind, alert.sms_sent, message)
    return alert


def resolve_open_alerts(session: Session, device: Device, by: str) -> list[Alert]:
    now = clock.now()
    open_alerts = session.exec(
        select(Alert).where(Alert.device_id == device.id, col(Alert.resolved_at).is_(None))
    ).all()
    for alert in open_alerts:
        alert.resolved_at = now
        alert.resolved_by = by
        session.add(alert)
    return list(open_alerts)


def _log_resolved(session: Session, device: Device, kind: str, message: str, by: str, sms: bool):
    """An alert that is over the moment it happens (all-clear, false alarm)."""
    alert = raise_alert(session, device, kind, message, sms=sms)
    alert.resolved_at = alert.sent_at
    alert.resolved_by = by


def record_check_in(session: Session, device: Device, value: str | None = None) -> None:
    """A family check-in counts as activity: it restarts the inactivity countdown.

    value tags the motion event: "check_in" when someone marked the resident okay.
    """
    now = clock.now()
    session.add(Event(device_id=device.id, type="motion", value=value, ts=now))
    device.last_motion_at = now
    log.info("%s: family check-in counted as activity", device.id)


def reply_trigger(session: Session, device: Device) -> str:
    """The event ("loud" or "fall") that started the current "Are you okay?" check."""
    trigger = session.exec(
        select(Event.type)
        .where(
            Event.device_id == device.id,
            col(Event.type).in_(("loud", "fall")),
            Event.ts <= device.status_since,
        )
        .order_by(col(Event.ts).desc(), col(Event.id).desc())
    ).first()
    return trigger or "loud"


def handle_event(session: Session, device: Device, event: Event) -> None:
    """Update device fields and status for one incoming event. Caller commits."""
    if event.type != "heartbeat":
        log.info(
            "%s: %s event (value=%s, level=%s)", device.id, event.type, event.value, event.level
        )
    device.last_seen_real_at = clock.real_now()
    if device.status == "offline":
        resolve_open_alerts(session, device, "heartbeat")
        set_status(device, "ok")

    if event.type == "heartbeat":
        device.last_heartbeat_at = event.ts
    elif event.type == "motion":
        device.last_motion_at = event.ts
        if device.status in MOTION_CLEARS:
            resolve_open_alerts(session, device, "motion")
            _log_resolved(
                session,
                device,
                "all_clear",
                messages.all_clear(device.name, person(session, device)),
                "motion",
                True,
            )
            set_status(device, "ok")
    elif event.type == "loud" and not device.sound_enabled:
        return
    elif event.type in ("loud", "fall"):
        if device.status in REPLY_FLOW_STARTS_FROM:
            device.reply_deadline_real = clock.real_now() + config.REPLY_WINDOW
            set_status(device, "awaiting_reply")
    elif event.type == "reply":
        _handle_reply(session, device, event.value)


def _handle_reply(session: Session, device: Device, value: str | None) -> None:
    if value == "help":
        if device.status != "urgent":
            resolve_open_alerts(session, device, "reply")
            raise_alert(
                session, device, "urgent", messages.urgent(device.name, person(session, device))
            )
            device.reply_deadline_real = None
            set_status(device, "urgent")
        return
    # "I'm okay" (button or voice).
    if device.status == "awaiting_reply":
        _log_resolved(
            session,
            device,
            "false_alarm",
            messages.false_alarm(
                device.name, person(session, device), reply_trigger(session, device)
            ),
            "reply",
            False,
        )
        device.reply_deadline_real = None
        set_status(device, "ok")
    elif device.status == "no_reply_alert":
        resolve_open_alerts(session, device, "reply")
        _log_resolved(
            session,
            device,
            "all_clear",
            messages.all_clear(device.name, person(session, device)),
            "reply",
            True,
        )
        set_status(device, "ok")


def check_device(session: Session, device: Device) -> None:
    """Time-based transitions for one device. Caller commits."""
    real_now = clock.real_now()

    seen = device.last_seen_real_at is not None
    if device.status in ("ok", "awaiting_reply") and seen and not is_online(device):
        raise_alert(session, device, "offline", messages.offline(device.name))
        device.reply_deadline_real = None
        set_status(device, "offline")
        return

    deadline = clock.as_utc(device.reply_deadline_real)
    if device.status == "awaiting_reply" and deadline and real_now >= deadline:
        message = messages.no_reply(
            device.name, person(session, device), reply_trigger(session, device)
        )
        raise_alert(session, device, "no_reply", message)
        device.reply_deadline_real = None
        set_status(device, "no_reply_alert")
        return

    if device.status == "ok":
        last_motion = clock.as_utc(device.last_motion_at)
        verdict = routine.evaluate(
            device_baseline(session, device),
            last_motion,
            clock.now(),
            device.limit_minutes,
            device.name,
        )
        if verdict.irregular:
            log.info("%s: irregular (%s)", device.id, verdict.reason)
            message = messages.inactivity(
                device.name, last_motion, person(session, device), verdict.note
            )
            raise_alert(session, device, "inactivity", message)
            set_status(device, "inactive_alert")
