"""Demo controls: fast clock, synthetic week, reset. Owner: Person A."""

from __future__ import annotations

from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlmodel import Session, delete, select

from .. import clock, config, routine
from ..db import get_session
from ..models import Alert, Device, Event

router = APIRouter()


def demo_dict() -> dict:
    return {
        "enabled": clock.enabled(),
        "time_scale": clock.time_scale(),
        "clock_started_at": clock.iso(clock.clock_started_at()),
        "server_now": clock.iso(clock.now()),
    }


class DemoIn(BaseModel):
    enabled: bool
    time_scale: float | None = Field(default=None, gt=0)
    start_clock_at: datetime | None = None


@router.get("/demo")
def get_demo():
    return demo_dict()


@router.post("/demo")
def set_demo(body: DemoIn):
    if body.enabled:
        clock.enable(body.time_scale, body.start_clock_at)
    else:
        clock.disable()
    return demo_dict()


class SeedIn(BaseModel):
    device_id: str
    days: int = Field(default=7, ge=1, le=60)


@router.post("/demo/seed")
def seed(body: SeedIn, session: Session = Depends(get_session)):
    device = session.get(Device, body.device_id)
    if device is None:
        raise HTTPException(404, f"Unknown device {body.device_id}")
    times = routine.generate_week(
        clock.now(), config.HOUSEHOLD_TZ, days=body.days, object_type=device.object_type
    )
    session.add_all(Event(device_id=device.id, type="motion", ts=t) for t in times)
    if times:
        latest = max(times)
        current = clock.as_utc(device.last_motion_at)
        if current is None or latest > current:
            device.last_motion_at = latest
        session.add(device)
    session.commit()
    return {"ok": True, "events_created": len(times)}


@router.post("/demo/reset")
def reset(session: Session = Depends(get_session)):
    session.exec(delete(Event))
    session.exec(delete(Alert))
    now = clock.now()
    for device in session.exec(select(Device)).all():
        device.status = "ok"
        device.status_since = now
        device.last_motion_at = None
        device.last_heartbeat_at = None
        device.reply_deadline_real = None
        session.add(device)
    session.commit()
    return {"ok": True}
