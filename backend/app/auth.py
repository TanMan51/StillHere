"""Demo-grade accounts: signed login tokens and who may see what (hashing is in passwords.py).
Owner: Person A.

Tokens are "<user id>.<expiry>.<signature>", signed with SECRET_KEY, so the server keeps no
session table. Family caregivers see only their own resident; healthcare providers see every
resident in their community. Requests without a token keep the contract's open hackathon
access unless AUTH_REQUIRED is set.
"""

from __future__ import annotations

import hashlib
import hmac
from datetime import timedelta

from fastapi import Depends, Header, HTTPException
from sqlmodel import Session, col, select

from . import clock, config
from .db import get_session
from .models import Device, Resident, User


def _sign(payload: str) -> str:
    return hmac.new(config.SECRET_KEY.encode(), payload.encode(), hashlib.sha256).hexdigest()


def make_token(user: User) -> str:
    # Login sessions last in real time; the demo clock never shortens them.
    expires = int((clock.real_now() + timedelta(hours=config.SESSION_HOURS)).timestamp())
    payload = f"{user.id}.{expires}"
    return f"{payload}.{_sign(payload)}"


def read_token(token: str) -> int | None:
    """The user id in a valid, unexpired token, else None."""
    try:
        user_id, expires, signature = token.split(".")
        valid = hmac.compare_digest(signature, _sign(f"{user_id}.{expires}"))
        if valid and int(expires) > clock.real_now().timestamp():
            return int(user_id)
    except ValueError:
        pass
    return None


def current_user(
    authorization: str | None = Header(default=None),
    session: Session = Depends(get_session),
) -> User | None:
    """The logged-in user, or None for an open (tokenless) request."""
    if not authorization:
        if config.AUTH_REQUIRED:
            raise HTTPException(401, "Log in to continue")
        return None
    scheme, _, token = authorization.partition(" ")
    user_id = read_token(token) if scheme.lower() == "bearer" else None
    user = session.get(User, user_id) if user_id is not None else None
    if user is None:
        raise HTTPException(401, "Your login has expired. Log in again.")
    return user


def require_user(user: User | None = Depends(current_user)) -> User:
    if user is None:
        raise HTTPException(401, "Log in to continue")
    return user


def require_provider(user: User | None = Depends(current_user)) -> User:
    if user is None:
        raise HTTPException(401, "Log in as a healthcare provider to see the community")
    if user.role != "provider" or user.community_id is None:
        raise HTTPException(403, "Only healthcare providers can see the community")
    return user


def visible_resident_ids(session: Session, user: User | None) -> set[str] | None:
    """Residents this user may see, or None when the request is open and sees everything."""
    if user is None:
        return None
    if user.role == "provider":
        return set(
            session.exec(select(Resident.id).where(Resident.community_id == user.community_id))
        )
    return {user.resident_id} if user.resident_id else set()


def visible_devices(session: Session, user: User | None) -> list[Device]:
    query = select(Device).order_by(Device.id)
    allowed = visible_resident_ids(session, user)
    if allowed is not None:
        query = query.where(col(Device.resident_id).in_(allowed))
    return list(session.exec(query).all())


def can_see(session: Session, user: User | None, resident_id: str | None) -> bool:
    allowed = visible_resident_ids(session, user)
    return allowed is None or resident_id in allowed


def family_limits(
    session: Session, user: User | None, resident_id: str | None
) -> tuple[bool, bool]:
    """(shows alerts, shows activity) for this viewer. Only family caregivers are limited."""
    if user is None or user.role != "family" or resident_id is None:
        return True, True
    resident = session.get(Resident, resident_id)
    if resident is None:
        return True, True
    return resident.share_alerts_with_family, resident.share_activity_with_family
