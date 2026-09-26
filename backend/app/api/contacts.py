"""Family contacts. Each follows one resident; unassigned ones get every alert. Owner: Person A."""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Response
from pydantic import BaseModel, Field
from sqlmodel import Session, col, or_, select

from .. import auth, clock, messages, notify
from ..db import get_session
from ..models import Contact, User
from ..serialize import contact_dict

router = APIRouter()


class ContactIn(BaseModel):
    name: str = Field(min_length=1)
    phone: str = Field(pattern=r"^\+[1-9]\d{6,14}$")  # E.164
    # Family caregivers' contacts always follow their own resident; this is for providers.
    resident_id: str | None = None


def _visible(session: Session, user: User | None):
    query = select(Contact).order_by(Contact.id)
    allowed = auth.visible_resident_ids(session, user)
    if allowed is not None:
        query = query.where(
            or_(col(Contact.resident_id).in_(allowed), col(Contact.resident_id).is_(None))
        )
    return query


@router.get("/contacts")
def list_contacts(
    session: Session = Depends(get_session), user: User | None = Depends(auth.current_user)
):
    return [contact_dict(c) for c in session.exec(_visible(session, user)).all()]


@router.post("/contacts", status_code=201)
def create_contact(
    body: ContactIn,
    session: Session = Depends(get_session),
    user: User | None = Depends(auth.current_user),
):
    resident_id = user.resident_id if user and user.role == "family" else body.resident_id
    if resident_id is not None and not auth.can_see(session, user, resident_id):
        raise HTTPException(404, f"Unknown resident {resident_id}")
    contact = Contact(
        name=body.name, phone=body.phone, resident_id=resident_id, created_at=clock.now()
    )
    session.add(contact)
    session.commit()
    session.refresh(contact)
    return contact_dict(contact)


def _get_contact(session: Session, contact_id: int, user: User | None) -> Contact:
    contact = session.exec(_visible(session, user).where(Contact.id == contact_id)).first()
    if contact is None:
        raise HTTPException(404, f"Unknown contact {contact_id}")
    return contact


@router.delete("/contacts/{contact_id}", status_code=204)
def delete_contact(
    contact_id: int,
    session: Session = Depends(get_session),
    user: User | None = Depends(auth.current_user),
):
    session.delete(_get_contact(session, contact_id, user))
    session.commit()
    return Response(status_code=204)


@router.post("/contacts/{contact_id}/test")
def test_contact(
    contact_id: int,
    session: Session = Depends(get_session),
    user: User | None = Depends(auth.current_user),
):
    contact = _get_contact(session, contact_id, user)
    body = messages.test_message(contact.name)
    sms_error = None
    if notify.sms_configured() or not notify.email_configured():
        try:
            return {"ok": True, "channel": notify.send_sms(contact.phone, body)}
        except notify.SmsError as e:
            sms_error = e
    if notify.email_configured():
        try:
            return {"ok": True, "channel": notify.send_email("StillHere test", body)}
        except notify.EmailError as e:
            raise HTTPException(502, f"{sms_error}; {e}" if sms_error else str(e)) from e
    raise HTTPException(502, str(sms_error))
