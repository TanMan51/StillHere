"""Weather-aware check-ins: heat and cold advisories tighten a community's watch. Owner: Person A.

Older adults living alone are the people most at risk in heat waves and cold snaps, and the
least likely to be noticed. While the National Weather Service has a heat or cold advisory out
for a community's location, its grid thresholds shrink (WEATHER_THRESHOLD_FACTOR), the check-in
list covers everyone quiet that long, and each quiet resident's family gets one text per
advisory. Only residents with real (not simulated) sensors are ever texted.
"""

from __future__ import annotations

import json
import logging
import urllib.parse
import urllib.request
from datetime import datetime, timedelta

from sqlmodel import Session, select

from . import clock, config, messages, routing
from .models import Community, Device, Resident, WeatherNotice
from .serialize import is_online

log = logging.getLogger("stillhere.weather")

NWS_ALERTS_URL = "https://api.weather.gov/alerts/active"
NWS_POINTS_URL = "https://api.weather.gov/points/{latitude:.4f},{longitude:.4f}"
# Open-Meteo (free, no key): city search and current conditions.
GEOCODE_URL = "https://geocoding-api.open-meteo.com/v1/search"
FORECAST_URL = "https://api.open-meteo.com/v1/forecast"
# WMO weather codes, grouped into plain words.
CONDITIONS = [
    (0, "Clear"),
    (2, "Partly cloudy"),
    (3, "Overcast"),
    (48, "Fog"),
    (57, "Drizzle"),
    (67, "Rain"),
    (77, "Snow"),
    (82, "Rain showers"),
    (86, "Snow showers"),
    (99, "Thunderstorms"),
]
# NWS event names that put older adults living alone at risk.
HEAT_EVENTS = {
    "Heat Advisory",
    "Excessive Heat Warning",
    "Excessive Heat Watch",
    "Extreme Heat Warning",
    "Extreme Heat Watch",
}
COLD_EVENTS = {
    "Cold Weather Advisory",
    "Extreme Cold Warning",
    "Extreme Cold Watch",
    "Wind Chill Advisory",
    "Wind Chill Warning",
    "Wind Chill Watch",
}
WATCHED_EVENTS = HEAT_EVENTS | COLD_EVENTS


def active(community: Community) -> bool:
    ends = clock.as_utc(community.weather_ends_at)
    return community.weather_event is not None and (ends is None or ends > clock.real_now())


def thresholds(community: Community) -> tuple[int, int]:
    """(watch, worry) minutes, tightened while an advisory is active."""
    if not active(community):
        return community.watch_after_minutes, community.worry_after_minutes
    factor = config.WEATHER_THRESHOLD_FACTOR
    return (
        max(1, round(community.watch_after_minutes * factor)),
        max(2, round(community.worry_after_minutes * factor)),
    )


def weather_dict(community: Community) -> dict | None:
    if not active(community):
        return None
    watch, worry = thresholds(community)
    return {
        "id": community.weather_id,
        "event": community.weather_event,
        "kind": "heat" if community.weather_event in HEAT_EVENTS else "cold",
        "headline": community.weather_headline,
        "ends_at": clock.iso(community.weather_ends_at),
        "source": community.weather_source,
        "watch_after_minutes": watch,
        "worry_after_minutes": worry,
    }


def pick_advisory(features: list[dict]) -> dict | None:
    """The first heat or cold advisory in an NWS alerts response, as the fields we keep."""
    for feature in features:
        props = feature.get("properties", {})
        if props.get("event") in WATCHED_EVENTS:
            ends = props.get("ends") or props.get("expires")
            return {
                "id": props.get("id") or feature.get("id"),
                "event": props["event"],
                "headline": props.get("headline"),
                "ends_at": clock.as_utc(datetime.fromisoformat(ends)) if ends else None,
            }
    return None


def _get_json(url: str, params: dict | None = None, timeout: float = 10) -> dict:
    if params:
        url = f"{url}?{urllib.parse.urlencode(params)}"
    request = urllib.request.Request(
        url, headers={"User-Agent": config.WEATHER_USER_AGENT, "Accept": "application/json"}
    )
    with urllib.request.urlopen(request, timeout=timeout) as response:
        return json.load(response)


def fetch_features(latitude: float, longitude: float) -> list[dict]:
    body = _get_json(NWS_ALERTS_URL, {"point": f"{latitude:.4f},{longitude:.4f}"})
    return body.get("features", [])


def search_places(query: str) -> list[dict]:
    """US cities and towns matching the name typed in, for the location picker. The NWS only
    covers the US, so places elsewhere are left out."""
    body = _get_json(
        GEOCODE_URL, {"name": query, "count": 10, "language": "en", "format": "json"}, timeout=5
    )
    places = []
    for r in body.get("results", []):
        if r.get("country_code") != "US":
            continue
        region = r.get("admin1")
        places.append(
            {
                "name": f"{r['name']}, {region}" if region else r["name"],
                "latitude": round(r["latitude"], 4),
                "longitude": round(r["longitude"], 4),
            }
        )
    return places[:6]


def place_name(latitude: float, longitude: float) -> str | None:
    """ "City, ST" for coordinates (from the NWS, which names the nearest town)."""
    try:
        body = _get_json(NWS_POINTS_URL.format(latitude=latitude, longitude=longitude), timeout=5)
        where = body["properties"]["relativeLocation"]["properties"]
        return f"{where['city']}, {where['state']}"
    except Exception as e:  # outside the US, network trouble, or an unexpected shape
        log.warning("no place name for %s,%s: %s", latitude, longitude, e)
        return None


def describe(code: int | None) -> str | None:
    if code is None:
        return None
    return next((words for top, words in CONDITIONS if code <= top), None)


def fetch_conditions(latitude: float, longitude: float) -> dict:
    body = _get_json(
        FORECAST_URL,
        {
            "latitude": f"{latitude:.4f}",
            "longitude": f"{longitude:.4f}",
            "current": "temperature_2m,apparent_temperature,weather_code",
            "temperature_unit": "fahrenheit",
            "timezone": "UTC",
        },
    )
    current = body["current"]
    return {
        "temperature_f": current.get("temperature_2m"),
        "feels_like_f": current.get("apparent_temperature"),
        "description": describe(current.get("weather_code")),
        "observed_at": clock.as_utc(datetime.fromisoformat(current["time"] + "+00:00")),
    }


def conditions_dict(community: Community) -> dict | None:
    if community.weather_temp_f is None:
        return None
    return {
        "temperature_f": community.weather_temp_f,
        "feels_like_f": community.weather_feels_f,
        "description": community.weather_conditions,
        "observed_at": clock.iso(community.weather_observed_at),
    }


def set_advisory(community: Community, advisory: dict | None, source: str) -> None:
    if advisory is None:
        community.weather_id = community.weather_event = community.weather_headline = None
        community.weather_ends_at = community.weather_source = None
        return
    community.weather_id = advisory["id"]
    community.weather_event = advisory["event"]
    community.weather_headline = advisory["headline"]
    community.weather_ends_at = advisory["ends_at"]
    community.weather_source = source


def refresh_community(community: Community) -> None:
    """Current conditions and any NWS advisory for one community. A simulated advisory stays
    until it's cleared; a failed lookup keeps whatever was known before. Caller saves."""
    if community.latitude is None or community.longitude is None:
        return
    try:
        now = fetch_conditions(community.latitude, community.longitude)
        community.weather_temp_f = now["temperature_f"]
        community.weather_feels_f = now["feels_like_f"]
        community.weather_conditions = now["description"]
        community.weather_observed_at = now["observed_at"]
    except Exception as e:  # network, HTTP, or format trouble: try again next time
        log.warning("conditions for %s failed: %s", community.id, e)
    if community.weather_source == "simulated" and active(community):
        return
    try:
        advisory = pick_advisory(fetch_features(community.latitude, community.longitude))
    except Exception as e:
        log.warning("weather lookup for %s failed: %s", community.id, e)
        return
    if (advisory or {}).get("id") != community.weather_id:
        log.info("%s: weather advisory now %s", community.id, advisory and advisory["event"])
    set_advisory(community, advisory, "nws")
    community.weather_checked_real = clock.real_now()


def refresh(session: Session) -> None:
    """Refresh every community's weather. Caller commits."""
    for community in session.exec(select(Community)).all():
        refresh_community(community)
        session.add(community)


def simulate(community: Community, kind: str | None) -> None:
    """Demo control: start a pretend heat or cold advisory for the next 6 hours, or clear it."""
    if kind is None:
        set_advisory(community, None, "simulated")
        community.weather_checked_real = None
        return
    event = "Heat Advisory" if kind == "heat" else "Cold Weather Advisory"
    ends = clock.real_now() + timedelta(hours=6)
    set_advisory(
        community,
        {
            "id": f"simulated-{kind}-{int(clock.real_now().timestamp())}",
            "event": event,
            "headline": f"{event} (simulated for a demo)",
            "ends_at": ends,
        },
        "simulated",
    )


def notify_quiet(session: Session) -> None:
    """Text family once per advisory about residents who've been quiet past the tightened watch
    threshold. Simulated apartments never text. Caller commits."""
    for community in session.exec(select(Community)).all():
        if not active(community) or community.weather_id is None:
            continue
        watch, _ = thresholds(community)
        now = clock.now()
        residents = session.exec(
            select(Resident).where(Resident.community_id == community.id)
        ).all()
        for resident in residents:
            devices = session.exec(select(Device).where(Device.resident_id == resident.id)).all()
            # Simulated apartments never text; an offline sensor has its own alert.
            if not devices or all(d.simulated for d in devices):
                continue
            if not any(is_online(d) for d in devices):
                continue
            already = session.exec(
                select(WeatherNotice).where(
                    WeatherNotice.resident_id == resident.id,
                    WeatherNotice.weather_id == community.weather_id,
                )
            ).first()
            if already is not None:
                continue
            motions = [clock.as_utc(d.last_motion_at) for d in devices if d.last_motion_at]
            last_motion = max(motions, default=None)
            if last_motion is not None and now - last_motion < timedelta(minutes=watch):
                continue
            body = messages.weather_quiet(community.weather_event, resident.first_name, last_motion)
            routing.deliver(routing.family_phones(session, resident), body)
            session.add(
                WeatherNotice(resident_id=resident.id, weather_id=community.weather_id, sent_at=now)
            )
            log.info("%s: weather check-in text for %s", community.id, resident.id)
