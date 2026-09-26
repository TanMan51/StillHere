"""POST /api/events, the device-facing endpoint. Owner: Person A."""

from __future__ import annotations

from typing import Literal

from fastapi import APIRouter, Depends, Header, HTTPException
from pydantic import BaseModel, model_validator
from sqlmodel import Session

from .. import alerts, clock, config
from ..db import get_session
from ..models import Device, Event

router = APIRouter()


class EventIn(BaseModel):
    device_id: str
    type: Literal["motion", "loud", "reply", "fall", "heartbeat"]
    value: Literal["ok_button", "ok_voice", "help"] | None = None
    level: float | None = None

    @model_validator(mode="after")
    def reply_needs_value(self):
        if self.type == "reply" and self.value is None:
            raise ValueError("reply events need a value")
        return self


@router.post("/events", status_code=202)
def post_event(
    body: EventIn,
    x_device_token: str | None = Header(default=None),
    session: Session = Depends(get_session),
):
    if body.device_id not in config.DEVICE_TOKENS:
        raise HTTPException(404, f"Unknown device {body.device_id}")
    if x_device_token != config.DEVICE_TOKENS[body.device_id]:
        raise HTTPException(401, "Bad or missing device token")
    device = session.get(Device, body.device_id)
    if device is None:
        raise HTTPException(404, f"Unknown device {body.device_id}")

    event = Event(
        device_id=device.id, type=body.type, value=body.value, level=body.level, ts=clock.now()
    )
    session.add(event)
    alerts.handle_event(session, device, event)
    session.add(device)
    session.commit()
    return {"ok": True}
