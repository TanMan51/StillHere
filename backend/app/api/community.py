"""The provider's community views: the housing grid and its thresholds. Owner: Person A."""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlmodel import Session

from .. import auth, clock, community
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
    return {
        "server_now": clock.iso(clock.now()),
        "community": community.community_dict(found),
        "units": community.grid(session, found),
    }


class ThresholdPatch(BaseModel):
    # Up to a week, in minutes.
    watch_after_minutes: int | None = Field(default=None, ge=1, le=10080)
    worry_after_minutes: int | None = Field(default=None, ge=1, le=10080)


@router.patch("/community")
def patch_community(
    body: ThresholdPatch,
    session: Session = Depends(get_session),
    user: User = Depends(auth.require_provider),
):
    found = _community(session, user)
    watch = body.watch_after_minutes or found.watch_after_minutes
    worry = body.worry_after_minutes or found.worry_after_minutes
    if watch >= worry:
        raise HTTPException(422, "The yellow threshold must come before the red one")
    found.watch_after_minutes, found.worry_after_minutes = watch, worry
    session.add(found)
    session.commit()
    session.refresh(found)
    return community.community_dict(found)
