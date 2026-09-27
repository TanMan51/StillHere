"""Engine, table creation, and the per-request session. Owner: Person A."""

from __future__ import annotations

from collections.abc import Iterator

from sqlalchemy import inspect, text
from sqlmodel import Session, SQLModel, create_engine, select

from . import clock, config, demo_community
from .models import Device

engine = create_engine(
    config.DATABASE_URL,
    connect_args={"check_same_thread": False} if config.DATABASE_URL.startswith("sqlite") else {},
)


# Columns added after a table first shipped. create_all never alters an existing table, so
# older databases get them here with their defaults.
_ADDED_COLUMNS = {
    "device": {
        "sound_enabled": "BOOLEAN NOT NULL DEFAULT 1",
        "motion_sensitivity": "VARCHAR NOT NULL DEFAULT 'medium'",
        "resident_id": "VARCHAR REFERENCES resident(id)",
        "simulated": "BOOLEAN NOT NULL DEFAULT 0",
    },
    "community": {
        "watch_after_minutes": "INTEGER NOT NULL DEFAULT 240",
        "worry_after_minutes": "INTEGER NOT NULL DEFAULT 480",
        "on_call_phone": "VARCHAR",
        "escalate_after_minutes": "INTEGER NOT NULL DEFAULT 10",
        "checkin_time": "VARCHAR NOT NULL DEFAULT '10:00'",
        "latitude": "FLOAT",
        "longitude": "FLOAT",
        "location_name": "VARCHAR",
        "weather_temp_f": "FLOAT",
        "weather_feels_f": "FLOAT",
        "weather_conditions": "VARCHAR",
        "weather_observed_at": "DATETIME",
        "weather_id": "VARCHAR",
        "weather_event": "VARCHAR",
        "weather_headline": "VARCHAR",
        "weather_ends_at": "DATETIME",
        "weather_source": "VARCHAR",
        "weather_checked_real": "DATETIME",
    },
    "resident": {
        "family_notify": "VARCHAR NOT NULL DEFAULT 'immediately'",
    },
    "alert": {
        "acknowledged_at": "DATETIME",
        "acknowledged_by": "VARCHAR",
        "escalation_level": "INTEGER NOT NULL DEFAULT 0",
        "escalate_at_real": "DATETIME",
    },
    "contact": {
        "resident_id": "VARCHAR REFERENCES resident(id)",
    },
}


def _add_missing_columns() -> None:
    with engine.begin() as conn:
        for table, columns in _ADDED_COLUMNS.items():
            existing = {c["name"] for c in inspect(conn).get_columns(table)}
            for name, ddl in columns.items():
                if name not in existing:
                    conn.execute(text(f"ALTER TABLE {table} ADD COLUMN {name} {ddl}"))


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
        if config.SEED_DEMO_COMMUNITY:
            demo_community.ensure(session)


def get_session() -> Iterator[Session]:
    with Session(engine) as session:
        yield session
