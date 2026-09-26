"""Database tables. Owner: Person A. Datetimes must be timezone-aware (stored as UTC)."""

from __future__ import annotations

from datetime import datetime

from sqlmodel import Field, SQLModel


class Community(SQLModel, table=True):
    id: str = Field(primary_key=True)
    name: str
    # Housing grid colors: under watch_after is fine (green), then watch (yellow), and from
    # worry_after on, worry (red). Minutes of demo-clock time since the last movement.
    watch_after_minutes: int = 240
    worry_after_minutes: int = 480
    # Urgent alerts page the on-call phone first. Unacknowledged after escalate_after_minutes
    # (real minutes, like the reply window), they escalate to the next contact.
    on_call_phone: str | None = None
    escalate_after_minutes: int = 10
    # Morning check-in list: residents with no movement since this local time ("HH:MM").
    checkin_time: str = "10:00"


class Resident(SQLModel, table=True):
    id: str = Field(primary_key=True)
    community_id: str | None = Field(default=None, foreign_key="community.id", index=True)
    first_name: str
    last_name: str
    floor: int | None = None
    unit: str | None = None
    # What family caregivers may see. Staff in the resident's community always see everything.
    share_alerts_with_family: bool = True
    share_activity_with_family: bool = True
    # When family hears about urgent alerts: "immediately" (with staff) or "if_unanswered"
    # (only when staff haven't acknowledged within the community's escalation window).
    family_notify: str = "immediately"


class User(SQLModel, table=True):
    id: int | None = Field(default=None, primary_key=True)
    email: str = Field(unique=True, index=True)
    name: str
    role: str  # "family" or "provider"
    password_hash: str
    # Providers belong to a community; family caregivers follow one resident.
    community_id: str | None = Field(default=None, foreign_key="community.id")
    resident_id: str | None = Field(default=None, foreign_key="resident.id")


class Device(SQLModel, table=True):
    id: str = Field(primary_key=True)
    name: str
    object_type: str
    resident_id: str | None = Field(default=None, foreign_key="resident.id", index=True)
    # Demo apartments with seeded state and no hardware. The check loop leaves them alone so
    # they never text anyone.
    simulated: bool = False
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
    # Staff response: "I'm on it" records who and when; escalation stops once acknowledged.
    acknowledged_at: datetime | None = None
    acknowledged_by: str | None = None
    escalation_level: int = 0
    # Internal, real time (not in the contract): when an unacknowledged alert escalates next.
    escalate_at_real: datetime | None = None


class Contact(SQLModel, table=True):
    id: int | None = Field(default=None, primary_key=True)
    name: str
    phone: str
    # The resident this family contact follows. Null: every alert, as before accounts existed.
    resident_id: str | None = Field(default=None, foreign_key="resident.id", index=True)
    created_at: datetime
