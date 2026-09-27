"""Residents and what each one shares with family caregivers. Owner: Person A."""

from __future__ import annotations

from typing import Literal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlmodel import Session, col, select

from .. import alerts, auth, clock, community, config
from ..db import get_session
from ..models import Alert, Community, Device, Resident, User
from ..serialize import alert_dict, is_online, resident_dict

router = APIRouter()


@router.get("/residents")
def list_residents(
    session: Session = Depends(get_session), user: User | None = Depends(auth.current_user)
):
    query = select(Resident).order_by(Resident.floor, Resident.unit, Resident.id)
    allowed = auth.visible_resident_ids(session, user)
    if allowed is not None:
        query = query.where(col(Resident.id).in_(allowed))
    return [resident_dict(session, r) for r in session.exec(query).all()]


class SharingPatch(BaseModel):
    share_alerts_with_family: bool | None = None
    share_activity_with_family: bool | None = None
    family_notify: Literal["immediately", "if_unanswered"] | None = None


def _get_resident(session: Session, resident_id: str, user: User | None) -> Resident:
    resident = session.get(Resident, resident_id)
    if resident is None or not auth.can_see(session, user, resident.id):
        raise HTTPException(404, f"Unknown resident {resident_id}")
    return resident


@router.get("/residents/{resident_id}/summary")
def resident_summary(
    resident_id: str,
    session: Session = Depends(get_session),
    user: User | None = Depends(auth.current_user),
):
    """Everything for the resident page and the printable visit summary: current state,
    30-day activity trend, the past month's alerts, and staff response times."""
    resident = _get_resident(session, resident_id, user)
    home = session.get(Community, resident.community_id) if resident.community_id else None
    devices = session.exec(
        select(Device).where(Device.resident_id == resident.id).order_by(Device.id)
    ).all()
    shows_alerts, shows_activity = auth.family_limits(session, user, resident.id)
    alerts = community.recent_alerts(session, [resident.id]) if shows_alerts else []
    return {
        "server_now": clock.iso(clock.now()),
        "resident": resident_dict(session, resident),
        "community_name": home.name if home else None,
        "timezone": config.HOUSEHOLD_TZ,
        "unit": community.resident_cell(session, home, resident) if home else None,
        "devices": [
            {
                "id": d.id,
                "name": d.name,
                "object_type": d.object_type,
                "status": d.status,
                "online": is_online(d),
            }
            for d in devices
        ],
        "trend": community.resident_trend(session, resident).to_dict() if shows_activity else None,
        "alerts": [alert_dict(a) for a in alerts],
        "response_times": community.response_times(alerts),
    }


@router.post("/residents/{resident_id}/okay")
def mark_okay(
    resident_id: str,
    session: Session = Depends(get_session),
    user: User | None = Depends(auth.current_user),
):
    """Someone visited or called and the resident is okay. Counts as activity on each of the
    resident's sensors (restarting the countdown, so the grid turns green) and resolves open
    alerts. Offline-sensor alerts stay open: a resident being okay doesn't fix the sensor."""
    resident = _get_resident(session, resident_id, user)
    staff = user is not None and user.role == "provider"
    now = clock.now()
    devices = session.exec(select(Device).where(Device.resident_id == resident.id)).all()
    for device in devices:
        open_alerts = session.exec(
            select(Alert).where(Alert.device_id == device.id, col(Alert.resolved_at).is_(None))
        ).all()
        for alert in open_alerts:
            if alert.kind == "offline":
                continue
            alert.resolved_at = now
            alert.resolved_by = "staff" if staff else "family"
            alert.escalate_at_real = None
            if staff and alert.acknowledged_at is None:
                alert.acknowledged_at = now
                alert.acknowledged_by = user.name
            session.add(alert)
        alerts.record_check_in(session, device, value="check_in")
        if device.status != "offline":
            alerts.set_status(device, "ok")
            device.reply_deadline_real = None
        session.add(device)
    resident.marked_okay_at = now
    resident.marked_okay_by = user.name if user else "Family"
    session.add(resident)
    session.commit()
    session.refresh(resident)
    return resident_dict(session, resident)


@router.patch("/residents/{resident_id}")
def patch_resident(
    resident_id: str,
    body: SharingPatch,
    session: Session = Depends(get_session),
    user: User | None = Depends(auth.current_user),
):
    resident = _get_resident(session, resident_id, user)
    if body.share_alerts_with_family is not None:
        resident.share_alerts_with_family = body.share_alerts_with_family
    if body.share_activity_with_family is not None:
        resident.share_activity_with_family = body.share_activity_with_family
    if body.family_notify is not None:
        resident.family_notify = body.family_notify
    session.add(resident)
    session.commit()
    session.refresh(resident)
    return resident_dict(session, resident)
