"""Database tables. Owner: Person A. Datetimes must be timezone-aware (stored as UTC)."""

from __future__ import annotations

from datetime import datetime

from sqlmodel import Field, SQLModel


class Device(SQLModel, table=True):
    id: str = Field(primary_key=True)
    name: str
    object_type: str
    limit_minutes: int = 720
    status: str = "ok"
    status_since: datetime
    last_motion_at: datetime | None = None
    last_heartbeat_at: datetime | None = None
    sound_enabled: bool = True
    motion_sensitivity: str = "medium"
    # Internal, real-time bookkeeping (not in the contract).
    last_seen_real_at: datetime | None = None
    reply_deadline_real: datetime | None = None


class Event(SQLModel, table=True):
    id: int | None = Field(default=None, primary_key=True)
    device_id: str = Field(foreign_key="device.id", index=True)
    type: str = Field(index=True)
    value: str | None = None
    level: float | None = None
    ts: datetime = Field(index=True)


class Alert(SQLModel, table=True):
    id: int | None = Field(default=None, primary_key=True)
    device_id: str = Field(foreign_key="device.id", index=True)
    kind: str
    message: str
    sms_sent: bool = False
    sent_at: datetime
    resolved_at: datetime | None = None
    resolved_by: str | None = None


class Contact(SQLModel, table=True):
    id: int | None = Field(default=None, primary_key=True)
    name: str
    phone: str
    created_at: datetime
