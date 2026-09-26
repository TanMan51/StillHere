"""The check loop: an APScheduler job inside the FastAPI process. Owner: Person A.

Every CHECK_INTERVAL_SECONDS it runs alerts.check_device() for each device. Each
device is checked in its own session and try/except, so one bad device can't stop
the loop.
"""

from __future__ import annotations

import logging

from apscheduler.schedulers.background import BackgroundScheduler
from sqlmodel import Session, select

from . import alerts, config
from .db import engine
from .models import Device

log = logging.getLogger("stillhere.checker")

_scheduler: BackgroundScheduler | None = None


def check_all() -> None:
    with Session(engine) as session:
        device_ids = session.exec(select(Device.id)).all()
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
    _scheduler.start()
    log.info("check loop running every %ss", config.CHECK_INTERVAL_SECONDS)


def stop() -> None:
    global _scheduler
    if _scheduler is not None:
        _scheduler.shutdown(wait=False)
        _scheduler = None
