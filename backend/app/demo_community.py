"""The demo community, Maple Grove Senior Living, and its demo accounts. Owner: Person A.

Everything here is invented: no real people, apartments, or health data. Rosa (unit 204) owns
the real hardware devices from config, so live movement from the sensor shows up in the
community views. Every other apartment gets a simulated device with no hardware.
"""

from __future__ import annotations

from datetime import timedelta

from sqlmodel import Session, col, delete, select

from . import clock, config, messages, passwords, routine
from .models import Alert, Community, Device, Event, Resident, User

COMMUNITY_ID = "maple-grove"
COMMUNITY_NAME = "Maple Grove Senior Living"
FLOORS = 3
UNITS_PER_FLOOR = 8
REAL_DEVICE_UNIT = "204"
ATLANTA = (33.7756, -84.3963)
# The family account keeps the original demo login so the caregiver flow is unchanged.
FAMILY_EMAIL = "demo@stillhere.example"
PROVIDER_EMAIL = "staff@maplegrove.example"

# Invented residents, in unit order: floor 1 units 01-08, then floor 2, then floor 3.
NAMES = [
    ("Harold", "Bennett"),
    ("Dolores", "Kim"),
    ("Walter", "Okafor"),
    ("June", "Lindqvist"),
    ("Arthur", "Pham"),
    ("Beatrice", "Moreau"),
    ("Clarence", "Hughes"),
    ("Irene", "Castillo"),
    ("Frank", "Adeyemi"),
    ("Marjorie", "Walsh"),
    ("Eugene", "Takahashi"),
    ("Rosa", "Delgado"),
    ("Leonard", "Fischer"),
    ("Gladys", "Novak"),
    ("Vernon", "Ellis"),
    ("Mabel", "Iqbal"),
    ("Stanley", "Ruiz"),
    ("Edith", "Sorensen"),
    ("Howard", "Mensah"),
    ("Loretta", "Byrne"),
    ("Chester", "Aoki"),
    ("Viola", "Petrov"),
    ("Raymond", "Dubois"),
    ("Agnes", "Olsen"),
]


# Seeded states for the simulated apartments, so the housing grid opens with a realistic mix:
# mostly fine, a few to watch, a couple to worry about, one offline, one urgent.
SEEDED_STATES = {
    "103": "watch",
    "207": "watch",
    "302": "watch",
    "106": "worry",
    "301": "worry",
    "208": "offline",
    "305": "urgent",
}


# Residents whose last week is much quieter than the three weeks before, so the wellness
# trend flags "activity lower than usual" for them.
QUIETER_LATELY = {"102", "303"}
# Past alerts staff already handled, for response times and visit summaries:
# unit -> (kind, days ago, minutes to "I'm on it", minutes to resolved).
PAST_ALERTS = {
    "104": ("urgent", 6, 3, 12),
    "201": ("no_reply", 13, 5, 9),
    "306": ("urgent", 21, 2, 15),
    "107": ("no_reply", 3, 7, 20),
}
HISTORY_DAYS = 30


def units() -> list[tuple[int, str]]:
    return [
        (floor, f"{floor}{n:02d}")
        for floor in range(1, FLOORS + 1)
        for n in range(1, UNITS_PER_FLOOR + 1)
    ]


def ensure(session: Session) -> None:
    """Create whatever part of the demo community is missing. Safe to run on every start."""
    community = session.get(Community, COMMUNITY_ID)
    if community is None:
        community = Community(id=COMMUNITY_ID, name=COMMUNITY_NAME)
    if community.latitude is None:
        # An invented community placed in Atlanta, so weather advisories are real ones.
        community.latitude, community.longitude = ATLANTA
    if community.location_name is None:
        community.location_name = "Atlanta, GA"
    session.add(community)
    for (floor, unit), (first, last) in zip(units(), NAMES, strict=True):
        resident_id = f"mg-{unit}"
        if session.get(Resident, resident_id) is None:
            session.add(
                Resident(
                    id=resident_id,
                    community_id=COMMUNITY_ID,
                    first_name=first,
                    last_name=last,
                    floor=floor,
                    unit=unit,
                )
            )
        if unit != REAL_DEVICE_UNIT and session.get(Device, f"sim-{unit}") is None:
            session.add(
                Device(
                    id=f"sim-{unit}",
                    name=f"{first}'s apartment",
                    object_type="door",
                    resident_id=resident_id,
                    simulated=True,
                    status_since=clock.now(),
                )
            )
    session.flush()
    simulated = session.exec(select(Device).where(Device.simulated == True)).all()  # noqa: E712
    if not any(d.last_motion_at for d in simulated):
        seed_states(session)

    real_resident = f"mg-{REAL_DEVICE_UNIT}"
    for d in config.DEVICES:
        device = session.get(Device, d["id"])
        if device is None:
            continue
        if device.resident_id is None:
            device.resident_id = real_resident
        # The real sensors carry family-era names ("Mom's fridge"); name them for Rosa instead,
        # along with alerts already saved under the old name.
        family_prefix = "Mom's "
        owner = session.get(Resident, real_resident)
        if device.resident_id == real_resident and owner is not None:
            if device.name.startswith(family_prefix):
                object_name = device.name.removeprefix(family_prefix)
                device.name = f"{owner.first_name}'s {object_name}"
            renamed = f"{owner.first_name}'s "
            for alert in session.exec(select(Alert).where(Alert.device_id == device.id)).all():
                if family_prefix in alert.message:
                    alert.message = alert.message.replace(family_prefix, renamed)
                    session.add(alert)
        session.add(device)

    existing = set(session.exec(select(User.email)).all())
    if FAMILY_EMAIL not in existing:
        session.add(
            User(
                email=FAMILY_EMAIL,
                name="Sam (family)",
                role="family",
                password_hash=passwords.hash_password(config.DEMO_PASSWORD),
                resident_id=real_resident,
            )
        )
    if PROVIDER_EMAIL not in existing:
        session.add(
            User(
                email=PROVIDER_EMAIL,
                name="Maple Grove wellness staff",
                role="provider",
                password_hash=passwords.hash_password(config.DEMO_PASSWORD),
                community_id=COMMUNITY_ID,
            )
        )
    session.commit()


def seed_states(session: Session) -> None:
    """Give every simulated apartment its seeded state, measured back from the demo clock's now.

    Their time since movement keeps growing with the clock, so a fast demo clock walks the
    grid from green to yellow to red live.
    """
    now = clock.now()
    for index, (_, unit) in enumerate(units()):
        device = session.get(Device, f"sim-{unit}")
        resident = session.get(Resident, f"mg-{unit}")
        if device is None or resident is None:
            continue
        state = SEEDED_STATES.get(unit, "fine")
        minutes = {
            "fine": 10 + (index * 37) % 200,
            "watch": 270 + (index * 23) % 180,
            "worry": 560 + (index * 41) % 300,
            "offline": 190,
            "urgent": 25,
        }[state]
        device.last_motion_at = now - timedelta(minutes=minutes)
        device.status = "urgent" if state == "urgent" else "ok"
        device.status_since = now
        if state == "offline":
            # Never seen in real time, so it reads offline; its last heartbeat was long ago.
            device.last_seen_real_at = None
            device.last_heartbeat_at = now - timedelta(minutes=150)
        else:
            device.last_seen_real_at = clock.real_now()
            device.last_heartbeat_at = now
        session.add(device)
        session.add(Event(device_id=device.id, type="motion", ts=device.last_motion_at))
        _seed_history(session, device, index, quieter=unit in QUIETER_LATELY)
        if unit in PAST_ALERTS:
            _seed_past_alert(session, device, resident, unit, now)
        if state == "urgent":
            asked = now - timedelta(minutes=1)
            session.add(Event(device_id=device.id, type="reply", value="help", ts=asked))
            # Seeded, so it is shown but never texted.
            session.add(
                Alert(
                    device_id=device.id,
                    kind="urgent",
                    message=messages.resident_urgent(resident.first_name, unit),
                    sms_sent=False,
                    sent_at=asked,
                )
            )
    session.commit()


def _seed_history(session: Session, device: Device, index: int, *, quieter: bool) -> None:
    """A month of everyday movement ending at the device's last movement."""
    end = clock.as_utc(device.last_motion_at)
    times = routine.generate_week(
        end, config.HOUSEHOLD_TZ, days=HISTORY_DAYS, object_type="fridge", seed=index
    )
    recent = end - timedelta(days=7)
    for i, t in enumerate(times):
        # Quieter lately: keep one in three movements from the last week.
        if t >= end or (quieter and t >= recent and i % 3):
            continue
        session.add(Event(device_id=device.id, type="motion", ts=t))


def _seed_past_alert(session: Session, device: Device, resident: Resident, unit: str, now) -> None:
    kind, days_ago, acknowledge, resolve = PAST_ALERTS[unit]
    sent = now - timedelta(days=days_ago, hours=index_hour(unit))
    message = (
        messages.resident_urgent(resident.first_name, unit)
        if kind == "urgent"
        else messages.resident_no_reply(resident.first_name, unit)
    )
    session.add(
        Alert(
            device_id=device.id,
            kind=kind,
            message=message,
            sms_sent=False,
            sent_at=sent,
            acknowledged_at=sent + timedelta(minutes=acknowledge),
            acknowledged_by="Maple Grove wellness staff",
            resolved_at=sent + timedelta(minutes=resolve),
            resolved_by="staff",
        )
    )


def index_hour(unit: str) -> int:
    """A stable hour offset per apartment, so past alerts don't all share a time of day."""
    return int(unit) % 9 + 2


def reseed_simulated(session: Session) -> None:
    """Clear the simulated apartments' events and alerts and seed them again from now."""
    ids = list(session.exec(select(Device.id).where(Device.simulated == True)))  # noqa: E712
    session.exec(delete(Event).where(col(Event.device_id).in_(ids)))
    session.exec(delete(Alert).where(col(Alert.device_id).in_(ids)))
    session.commit()
    seed_states(session)
