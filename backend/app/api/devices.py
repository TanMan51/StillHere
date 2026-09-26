"""Device and alert endpoints for the dashboard. Owner: Person A."""

from __future__ import annotations

from typing import Literal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlmodel import Session, select

from .. import clock
from ..db import get_session
from ..models import Alert, Device
from ..serialize import active_alert, device_detail_dict, device_dict

router = APIRouter()


def _get_device(session: Session, device_id: str) -> Device:
    device = session.get(Device, device_id)
    if device is None:
        raise HTTPException(404, f"Unknown device {device_id}")
    return device


@router.get("/devices")
def list_devices(session: Session = Depends(get_session)):
    devices = session.exec(select(Device).order_by(Device.id)).all()
    return {
        "server_now": clock.iso(clock.now()),
        "devices": [device_dict(session, d) for d in devices],
    }


@router.get("/devices/{device_id}")
def get_device(device_id: str, session: Session = Depends(get_session)):
    device = _get_device(session, device_id)
    return {"server_now": clock.iso(clock.now()), "device": device_detail_dict(session, device)}


class DevicePatch(BaseModel):
    name: str | None = Field(default=None, min_length=1)
    limit_minutes: int | None = Field(default=None, ge=1, le=2880)
    sound_enabled: bool | None = None
    motion_sensitivity: Literal["low", "medium", "high"] | None = None


@router.patch("/devices/{device_id}")
def patch_device(device_id: str, body: DevicePatch, session: Session = Depends(get_session)):
    device = _get_device(session, device_id)
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
    return {"server_now": clock.iso(clock.now()), "device": device_dict(session, device)}


@router.post("/alerts/{alert_id}/resolve")
def resolve_alert(alert_id: int, session: Session = Depends(get_session)):
    alert = session.get(Alert, alert_id)
    if alert is None:
        raise HTTPException(404, f"Unknown alert {alert_id}")
    now = clock.now()
    if alert.resolved_at is None:
        alert.resolved_at = now
        alert.resolved_by = "family"
        session.add(alert)
        session.commit()
    device = session.get(Device, alert.device_id)
    if device and device.status != "ok" and active_alert(session, device.id) is None:
        device.status = "ok"
        device.status_since = now
        device.reply_deadline_real = None
        session.add(device)
        session.commit()
    return {"ok": True}
