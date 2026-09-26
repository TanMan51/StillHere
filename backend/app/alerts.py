"""The per-device alert state machine. Owner: Person A.

Device status moves between the values in contract/api.md. Two things drive it:
events from the device (handle_event, called by POST /api/events) and the passage of
time (checker.py). Every transition goes through the helpers here so each alert fires
once and is resolved exactly once.
"""

from __future__ import annotations

import logging

from sqlmodel import Session, col, select

from . import clock, config, messages, notify, routine
from .models import Alert, Contact, Device, Event
from .serialize import device_baseline, is_online

log = logging.getLogger("stillhere.alerts")

# Loud sounds and falls are ignored while a more serious state is already active.
REPLY_FLOW_STARTS_FROM = {"ok", "inactive_alert", "awaiting_reply"}
MOTION_CLEARS = {"inactive_alert", "no_reply_alert"}


def set_status(device: Device, status: str) -> None:
    if device.status != status:
        log.info("%s: %s -> %s", device.id, device.status, status)
        device.status = status
        device.status_since = clock.now()


def send_to_contacts(session: Session, body: str) -> bool:
    """Text every contact, falling back to email when no text got through.

    One failed number never stops the others. True if anything was delivered.
    """
    sent = False
    if notify.sms_configured() or not notify.email_configured():
        for contact in session.exec(select(Contact)).all():
            try:
                notify.send_sms(contact.phone, body)
                sent = True
            except notify.SmsError as e:
                log.error("text to contact %s failed: %s", contact.id, e)
    if not sent and notify.email_configured():
        try:
            notify.send_email(messages.email_subject(body), body)
            sent = True
        except notify.EmailError as e:
            log.error("email fallback failed: %s", e)
    return sent


def raise_alert(
    session: Session, device: Device, kind: str, message: str, *, sms: bool = True
) -> Alert:
    now = clock.now()
    alert = Alert(
        device_id=device.id,
        kind=kind,
        message=message,
        sms_sent=send_to_contacts(session, message) if sms else False,
        sent_at=now,
    )
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
                session, device, "all_clear", messages.all_clear(device.name), "motion", True
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
            raise_alert(session, device, "urgent", messages.urgent(device.name))
            device.reply_deadline_real = None
            set_status(device, "urgent")
        return
    # "I'm okay" (button or voice).
    if device.status == "awaiting_reply":
        _log_resolved(
            session, device, "false_alarm", messages.false_alarm(device.name), "reply", False
        )
        device.reply_deadline_real = None
        set_status(device, "ok")
    elif device.status == "no_reply_alert":
        resolve_open_alerts(session, device, "reply")
        _log_resolved(session, device, "all_clear", messages.all_clear(device.name), "reply", True)
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
        raise_alert(session, device, "no_reply", messages.no_reply(device.name))
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
            message = messages.inactivity(device.name, last_motion, verdict.note)
            raise_alert(session, device, "inactivity", message)
            set_status(device, "inactive_alert")
