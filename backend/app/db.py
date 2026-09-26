"""Engine, table creation, and the per-request session. Owner: Person A."""

from __future__ import annotations

from collections.abc import Iterator

from sqlmodel import Session, SQLModel, create_engine, select

from . import clock, config
from .models import Device

engine = create_engine(
    config.DATABASE_URL,
    connect_args={"check_same_thread": False} if config.DATABASE_URL.startswith("sqlite") else {},
)


def init_db() -> None:
    """Create tables and make sure every configured device has a row."""
    SQLModel.metadata.create_all(engine)
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
