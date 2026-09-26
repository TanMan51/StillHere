"""Device and alert endpoints for the dashboard. Owner: Person A."""

from __future__ import annotations

from typing import Literal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlmodel import Session

from .. import alerts, auth, clock
from ..db import get_session
from ..models import Alert, Device, User
from ..serialize import active_alert, alert_dict, device_detail_dict, device_dict

router = APIRouter()


def _get_device(session: Session, device_id: str, user: User | None) -> Device:
    device = session.get(Device, device_id)
    # Devices outside the viewer's residents look the same as ones that don't exist.
    if device is None or not auth.can_see(session, user, device.resident_id):
        raise HTTPException(404, f"Unknown device {device_id}")
    return device


def _shared(session: Session, user: User | None, device: Device, body: dict) -> dict:
    """Blank out what the resident doesn't share with family caregivers."""
    shows_alerts, shows_activity = auth.family_limits(session, user, device.resident_id)
    if not shows_alerts:
        body["active_alert"] = None
        if "alerts" in body:
            body["alerts"] = []
    if not shows_activity and "events" in body:
        body["events"] = []
    return body


@router.get("/devices")
def list_devices(
    session: Session = Depends(get_session), user: User | None = Depends(auth.current_user)
):
    return {
        "server_now": clock.iso(clock.now()),
        "devices": [
            _shared(session, user, d, device_dict(session, d))
            for d in auth.visible_devices(session, user)
        ],
    }


@router.get("/devices/{device_id}")
def get_device(
    device_id: str,
    session: Session = Depends(get_session),
    user: User | None = Depends(auth.current_user),
):
    device = _get_device(session, device_id, user)
    detail = _shared(session, user, device, device_detail_dict(session, device))
    return {"server_now": clock.iso(clock.now()), "device": detail}


class DevicePatch(BaseModel):
    name: str | None = Field(default=None, min_length=1)
    limit_minutes: int | None = Field(default=None, ge=1, le=2880)
    sound_enabled: bool | None = None
    motion_sensitivity: Literal["low", "medium", "high"] | None = None


@router.patch("/devices/{device_id}")
def patch_device(
    device_id: str,
    body: DevicePatch,
    session: Session = Depends(get_session),
    user: User | None = Depends(auth.current_user),
):
    device = _get_device(session, device_id, user)
    if body.name is not None:
        device.name = body.name
    if body.limit_minutes is not None:
        device.limit_minutes = body.limit_minutes
    if body.sound_enabled is not None:
        device.sound_enabled = body.sound_enabled
    if body.motion_sensitivity is not None:
        device.motion_sensitivity = body.motion_sensitivity
    session.add(device)
    session.commit()
    session.refresh(device)
    body = _shared(session, user, device, device_dict(session, device))
    return {"server_now": clock.iso(clock.now()), "device": body}


def _get_alert(session: Session, alert_id: int, user: User | None) -> Alert:
    alert = session.get(Alert, alert_id)
    owner = session.get(Device, alert.device_id) if alert else None
    if alert is None or owner is None or not auth.can_see(session, user, owner.resident_id):
        raise HTTPException(404, f"Unknown alert {alert_id}")
    return alert


@router.post("/alerts/{alert_id}/acknowledge")
def acknowledge_alert(
    alert_id: int,
    session: Session = Depends(get_session),
    user: User = Depends(auth.require_provider),
):
    """Staff's "I'm on it": records who took it and stops escalation."""
    alert = _get_alert(session, alert_id, user)
    if alert.acknowledged_at is None and alert.resolved_at is None:
        alert.acknowledged_at = clock.now()
        alert.acknowledged_by = user.name
        alert.escalate_at_real = None
        session.add(alert)
        session.commit()
        session.refresh(alert)
    return alert_dict(alert)


@router.post("/alerts/{alert_id}/resolve")
def resolve_alert(
    alert_id: int,
    session: Session = Depends(get_session),
    user: User | None = Depends(auth.current_user),
):
    """Family's "handled", or staff's "Resident okay"."""
    alert = _get_alert(session, alert_id, user)
    now = clock.now()
    device = session.get(Device, alert.device_id)
    if alert.resolved_at is None:
        alert.resolved_at = now
        alert.resolved_by = "staff" if user and user.role == "provider" else "family"
        alert.escalate_at_real = None
        if user and user.role == "provider" and alert.acknowledged_at is None:
            # Resolving without "I'm on it" first still counts as the staff response.
            alert.acknowledged_at = now
            alert.acknowledged_by = user.name
        session.add(alert)
        if device:
            alerts.record_check_in(session, device)
            session.add(device)
        session.commit()
    if device and device.status != "ok" and active_alert(session, device.id) is None:
        device.status = "ok"
        device.status_since = now
        device.reply_deadline_real = None
        session.add(device)
        session.commit()
    return {"ok": True}
