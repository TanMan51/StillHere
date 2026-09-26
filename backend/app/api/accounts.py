"""Login for family caregivers and healthcare providers. Owner: Person A."""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlmodel import Session, select

from .. import auth, passwords
from ..db import get_session
from ..models import User
from ..serialize import user_dict

router = APIRouter()


class LoginIn(BaseModel):
    email: str
    password: str


@router.post("/auth/login")
def login(body: LoginIn, session: Session = Depends(get_session)):
    email = body.email.strip().lower()
    user = session.exec(select(User).where(User.email == email)).first()
    if user is None or not passwords.verify_password(body.password, user.password_hash):
        raise HTTPException(401, "Email or password is incorrect")
    return {"token": auth.make_token(user), "user": user_dict(session, user)}


@router.get("/auth/me")
def me(session: Session = Depends(get_session), user: User = Depends(auth.require_user)):
    return {"user": user_dict(session, user)}
