"""Residents and what each one shares with family caregivers. Owner: Person A."""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlmodel import Session, col, select

from .. import auth
from ..db import get_session
from ..models import Resident, User
from ..serialize import resident_dict

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


@router.patch("/residents/{resident_id}")
def patch_resident(
    resident_id: str,
    body: SharingPatch,
    session: Session = Depends(get_session),
    user: User | None = Depends(auth.current_user),
):
    resident = session.get(Resident, resident_id)
    if resident is None or not auth.can_see(session, user, resident.id):
        raise HTTPException(404, f"Unknown resident {resident_id}")
    if body.share_alerts_with_family is not None:
        resident.share_alerts_with_family = body.share_alerts_with_family
    if body.share_activity_with_family is not None:
        resident.share_activity_with_family = body.share_activity_with_family
    session.add(resident)
    session.commit()
    session.refresh(resident)
    return resident_dict(session, resident)
