"""The check loop: an APScheduler job inside the FastAPI process. Owner: Person A.

Every CHECK_INTERVAL_SECONDS it runs alerts.check_device() for each real (not simulated)
device. Each device is checked in its own session and try/except, so one bad device can't
stop the loop.
"""

from __future__ import annotations

import logging
from datetime import datetime

from apscheduler.schedulers.background import BackgroundScheduler
from sqlmodel import Session, col, select

from . import alerts, clock, config, routing, weather
from .db import engine
from .models import Device

log = logging.getLogger("stillhere.checker")

_scheduler: BackgroundScheduler | None = None


def heartbeat_simulated() -> None:
    """Simulated apartments stay online, like hardware sending heartbeats, except any seeded
    as offline (never seen), which stay gray."""
    with Session(engine) as session:
        simulated = session.exec(
            select(Device).where(
                Device.simulated == True,  # noqa: E712
                col(Device.last_seen_real_at).is_not(None),
            )
        ).all()
        for device in simulated:
            device.last_seen_real_at = clock.real_now()
            device.last_heartbeat_at = clock.now()
            session.add(device)
        session.commit()


def escalate_alerts() -> None:
    with Session(engine) as session:
        routing.escalate_due(session)
        session.commit()


def weather_texts() -> None:
    with Session(engine) as session:
        weather.notify_quiet(session)
        session.commit()


def refresh_weather() -> None:
    try:
        with Session(engine) as session:
            weather.refresh(session)
            session.commit()
    except Exception:
        log.exception("weather refresh failed")


def check_all() -> None:
    for step in (heartbeat_simulated, escalate_alerts, weather_texts):
        try:
            step()
        except Exception:
            log.exception("%s failed", step.__name__)
    with Session(engine) as session:
        device_ids = session.exec(select(Device.id).where(Device.simulated == False)).all()  # noqa: E712
    for device_id in device_ids:
        try:
            with Session(engine) as session:
                device = session.get(Device, device_id)
                if device is None:
                    continue
                alerts.check_device(session, device)
                session.add(device)
                session.commit()
        except Exception:
            log.exception("check failed for %s", device_id)


def start() -> None:
    global _scheduler
    if not config.CHECKER_ENABLED or _scheduler is not None:
        return
    _scheduler = BackgroundScheduler()
    _scheduler.add_job(
        check_all,
        "interval",
        seconds=config.CHECK_INTERVAL_SECONDS,
        max_instances=1,
        coalesce=True,
    )
    if config.WEATHER_ENABLED:
        # Its own job, so a slow weather lookup never delays alert checks.
        _scheduler.add_job(
            refresh_weather,
            "interval",
            seconds=config.WEATHER_REFRESH_SECONDS,
            next_run_time=datetime.now(),
            max_instances=1,
            coalesce=True,
        )
    _scheduler.start()
    log.info("check loop running every %ss", config.CHECK_INTERVAL_SECONDS)


def stop() -> None:
    global _scheduler
    if _scheduler is not None:
        _scheduler.shutdown(wait=False)
        _scheduler = None
