"""Engine, table creation, and the per-request session. Owner: Person A."""

from __future__ import annotations

from collections.abc import Iterator

from sqlalchemy import inspect, text
from sqlmodel import Session, SQLModel, create_engine, select

from . import clock, config
from .models import Device

engine = create_engine(
    config.DATABASE_URL,
    connect_args={"check_same_thread": False} if config.DATABASE_URL.startswith("sqlite") else {},
)


# Device columns added after v1. create_all never alters an existing table, so older databases
# get them here with their defaults.
_ADDED_DEVICE_COLUMNS = {
    "sound_enabled": "BOOLEAN NOT NULL DEFAULT 1",
    "motion_sensitivity": "VARCHAR NOT NULL DEFAULT 'medium'",
}


def _add_missing_columns() -> None:
    existing = {c["name"] for c in inspect(engine).get_columns("device")}
    with engine.begin() as conn:
        for name, ddl in _ADDED_DEVICE_COLUMNS.items():
            if name not in existing:
                conn.execute(text(f"ALTER TABLE device ADD COLUMN {name} {ddl}"))


def init_db() -> None:
    """Create tables and make sure every configured device has a row."""
    SQLModel.metadata.create_all(engine)
    _add_missing_columns()
    with Session(engine) as session:
        existing = set(session.exec(select(Device.id)).all())
        for d in config.DEVICES:
            if d["id"] not in existing:
                session.add(
                    Device(
                        id=d["id"],
                        name=d["name"],
                        object_type=d["object_type"],
                        limit_minutes=d.get("limit_minutes", config.DEFAULT_LIMIT_MINUTES),
                        status_since=clock.now(),
                    )
                )
        session.commit()


def get_session() -> Iterator[Session]:
    with Session(engine) as session:
        yield session
