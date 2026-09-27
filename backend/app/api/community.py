"""The provider's community views: the housing grid and its thresholds. Owner: Person A."""

from __future__ import annotations

from typing import Literal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlmodel import Session

from .. import auth, clock, community, config, weather
from ..db import get_session
from ..models import Community, User

router = APIRouter()


def _community(session: Session, user: User) -> Community:
    found = session.get(Community, user.community_id)
    if found is None:
        raise HTTPException(404, f"Unknown community {user.community_id}")
    return found


@router.get("/community")
def get_community(
    session: Session = Depends(get_session), user: User = Depends(auth.require_provider)
):
    found = _community(session, user)
    units = community.grid(session, found)
    alerts = community.recent_alerts(session, [u["resident_id"] for u in units])
    return {
        "server_now": clock.iso(clock.now()),
        "community": community.community_dict(found),
        "units": units,
        "checkin": community.checkin_list(found, units),
        "weather": weather.weather_dict(found),
        "conditions": weather.conditions_dict(found),
        "response_times": community.response_times(alerts),
    }


class CommunityPatch(BaseModel):
    # Up to a week, in minutes.
    watch_after_minutes: int | None = Field(default=None, ge=1, le=10080)
    worry_after_minutes: int | None = Field(default=None, ge=1, le=10080)
    # E.164, or "" to clear it (urgent alerts then go straight to family).
    on_call_phone: str | None = Field(default=None, pattern=r"^(\+[1-9]\d{6,14})?$")
    escalate_after_minutes: int | None = Field(default=None, ge=1, le=240)
    checkin_time: str | None = Field(default=None, pattern=r"^([01]\d|2[0-3]):[0-5]\d$")
    latitude: float | None = Field(default=None, ge=-90, le=90)
    longitude: float | None = Field(default=None, ge=-180, le=180)
    # Optional with a new location; looked up from the coordinates when left out.
    location_name: str | None = Field(default=None, max_length=120)


@router.patch("/community")
def patch_community(
    body: CommunityPatch,
    session: Session = Depends(get_session),
    user: User = Depends(auth.require_provider),
):
    found = _community(session, user)
    watch = body.watch_after_minutes or found.watch_after_minutes
    worry = body.worry_after_minutes or found.worry_after_minutes
    if watch >= worry:
        raise HTTPException(422, "The yellow threshold must come before the red one")
    found.watch_after_minutes, found.worry_after_minutes = watch, worry
    if body.on_call_phone is not None:
        found.on_call_phone = body.on_call_phone or None
    if body.escalate_after_minutes is not None:
        found.escalate_after_minutes = body.escalate_after_minutes
    if body.checkin_time is not None:
        found.checkin_time = body.checkin_time
    if body.latitude is not None and body.longitude is not None:
        found.latitude, found.longitude = body.latitude, body.longitude
        # Name and weather come from outside services, skipped when weather is turned off.
        looked_up = (
            weather.place_name(body.latitude, body.longitude) if config.WEATHER_ENABLED else None
        )
        found.location_name = (
            body.location_name or looked_up or f"{body.latitude:.2f}, {body.longitude:.2f}"
        )
        # A real advisory for the old place no longer applies; check the new one right away.
        if found.weather_source == "nws":
            weather.set_advisory(found, None, "nws")
        if config.WEATHER_ENABLED:
            weather.refresh_community(found)
    session.add(found)
    session.commit()
    session.refresh(found)
    return community.community_dict(found)


class SimulateWeather(BaseModel):
    kind: Literal["heat", "cold"] | None


@router.post("/community/weather/simulate")
def simulate_weather(
    body: SimulateWeather,
    session: Session = Depends(get_session),
    user: User = Depends(auth.require_provider),
):
    """Demo control: pretend a heat or cold advisory is in effect, or clear the pretend one."""
    found = _community(session, user)
    weather.simulate(found, body.kind)
    session.add(found)
    session.commit()
    session.refresh(found)
    return {"weather": weather.weather_dict(found)}


@router.get("/places")
def places(query: str, user: User = Depends(auth.require_provider)):
    """US cities and towns matching `query`, for choosing the community's location."""
    if len(query.strip()) < 2:
        raise HTTPException(422, "Type at least 2 letters of a city or town")
    try:
        return weather.search_places(query.strip())
    except Exception as e:
        raise HTTPException(502, "City search is unavailable right now. Try again.") from e
