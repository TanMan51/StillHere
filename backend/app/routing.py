"""Who hears about an alert, and escalation when staff don't respond. Owner: Person A.

Family contacts get a resident's alerts when the resident shares alerts with family. In a
community with an on-call phone, urgent alerts ("help", or no reply) page on-site staff first;
family hears with them or, if the resident prefers, only when staff haven't acknowledged in
time. An urgent alert nobody acknowledges escalates every `escalate_after_minutes` (real
minutes, like the reply window): first to family waiting on staff, then the on-call phone again.
"""

from __future__ import annotations

import logging
from datetime import timedelta

from sqlmodel import Session, col, or_, select

from . import clock, messages, notify
from .models import Alert, Community, Contact, Device, Resident

log = logging.getLogger("stillhere.routing")

URGENT_KINDS = {"urgent", "no_reply"}
MAX_ESCALATIONS = 3


def placement(session: Session, device: Device) -> tuple[Resident | None, Community | None]:
    resident = session.get(Resident, device.resident_id) if device.resident_id else None
    community = (
        session.get(Community, resident.community_id)
        if resident and resident.community_id
        else None
    )
    return resident, community


def family_phones(session: Session, resident: Resident | None) -> list[str]:
    """The resident's family contacts, plus unassigned contacts, who still get every alert."""
    if resident is not None and not resident.share_alerts_with_family:
        return []
    query = select(Contact).order_by(Contact.id)
    if resident is not None:
        query = query.where(
            or_(Contact.resident_id == resident.id, col(Contact.resident_id).is_(None))
        )
    return [c.phone for c in session.exec(query).all()]


def deliver(phones: list[str], body: str) -> bool:
    """Text each number, falling back to email when no text got through.

    One failed number never stops the others. True if anything was delivered.
    """
    sent = False
    if notify.sms_configured() or not notify.email_configured():
        for phone in dict.fromkeys(phones):
            try:
                notify.send_sms(phone, body)
                sent = True
            except notify.SmsError as e:
                log.error("text to %s failed: %s", phone[-4:], e)
    if not sent and notify.email_configured():
        try:
            notify.send_email(messages.email_subject(body), body)
            sent = True
        except notify.EmailError as e:
            log.error("email fallback failed: %s", e)
    return sent


def _staff_first(alert: Alert, resident: Resident | None, community: Community | None) -> bool:
    return (
        alert.kind in URGENT_KINDS
        and resident is not None
        and community is not None
        and bool(community.on_call_phone)
    )


def notify_new(session: Session, device: Device, alert: Alert) -> bool:
    """Send a new alert to its first recipients and schedule escalation. Caller commits."""
    resident, community = placement(session, device)
    family = family_phones(session, resident)
    if _staff_first(alert, resident, community):
        assert resident is not None and community is not None and community.on_call_phone
        phones = [community.on_call_phone]
        if resident.family_notify == "immediately":
            phones += family
        alert.escalate_at_real = clock.real_now() + timedelta(
            minutes=community.escalate_after_minutes
        )
    else:
        phones = family
    return deliver(phones, alert.message)


def escalate_due(session: Session) -> None:
    """Escalate urgent alerts that staff haven't acknowledged in time. Caller commits."""
    now = clock.real_now()
    due = session.exec(
        select(Alert).where(
            col(Alert.escalate_at_real).is_not(None),
            col(Alert.acknowledged_at).is_(None),
            col(Alert.resolved_at).is_(None),
        )
    ).all()
    for alert in due:
        if clock.as_utc(alert.escalate_at_real) > now:
            continue
        device = session.get(Device, alert.device_id)
        resident, community = placement(session, device) if device else (None, None)
        alert.escalate_at_real = None
        if not _staff_first(alert, resident, community):
            session.add(alert)
            continue
        assert resident is not None and community is not None and community.on_call_phone
        alert.escalation_level += 1
        waiting_family = alert.escalation_level == 1 and resident.family_notify == "if_unanswered"
        phones = (family_phones(session, resident) if waiting_family else []) or [
            community.on_call_phone
        ]
        minutes = community.escalate_after_minutes * alert.escalation_level
        deliver(phones, messages.escalated(alert.message, minutes))
        if alert.escalation_level < MAX_ESCALATIONS:
            alert.escalate_at_real = now + timedelta(minutes=community.escalate_after_minutes)
        log.info("alert %s escalated (level %s)", alert.id, alert.escalation_level)
        session.add(alert)
