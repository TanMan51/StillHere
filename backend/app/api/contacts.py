"""Contacts: everyone here gets every alert. Owner: Person A."""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Response
from pydantic import BaseModel, Field
from sqlmodel import Session, select

from .. import clock, messages, notify
from ..db import get_session
from ..models import Contact
from ..serialize import contact_dict

router = APIRouter()


class ContactIn(BaseModel):
    name: str = Field(min_length=1)
    phone: str = Field(pattern=r"^\+[1-9]\d{6,14}$")  # E.164


@router.get("/contacts")
def list_contacts(session: Session = Depends(get_session)):
    return [contact_dict(c) for c in session.exec(select(Contact).order_by(Contact.id)).all()]


@router.post("/contacts", status_code=201)
def create_contact(body: ContactIn, session: Session = Depends(get_session)):
    contact = Contact(name=body.name, phone=body.phone, created_at=clock.now())
    session.add(contact)
    session.commit()
    session.refresh(contact)
    return contact_dict(contact)


def _get_contact(session: Session, contact_id: int) -> Contact:
    contact = session.get(Contact, contact_id)
    if contact is None:
        raise HTTPException(404, f"Unknown contact {contact_id}")
    return contact


@router.delete("/contacts/{contact_id}", status_code=204)
def delete_contact(contact_id: int, session: Session = Depends(get_session)):
    session.delete(_get_contact(session, contact_id))
    session.commit()
    return Response(status_code=204)


@router.post("/contacts/{contact_id}/test")
def test_contact(contact_id: int, session: Session = Depends(get_session)):
    contact = _get_contact(session, contact_id)
    try:
        channel = notify.send_sms(contact.phone, messages.test_message(contact.name))
    except notify.SmsError as e:
        raise HTTPException(502, str(e)) from e
    return {"ok": True, "channel": channel}
