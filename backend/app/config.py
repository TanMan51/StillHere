"""Settings, read once from environment variables (see .env.example). Owner: Person A."""

from __future__ import annotations

import json
import os
import secrets
from datetime import timedelta
from pathlib import Path

from dotenv import load_dotenv

BACKEND_DIR = Path(__file__).resolve().parent.parent
REPO_DIR = BACKEND_DIR.parent
load_dotenv(BACKEND_DIR / ".env")

DATABASE_URL = os.getenv("DATABASE_URL", f"sqlite:///{BACKEND_DIR / 'stillhere.db'}")

# Household timezone. Hour-of-day routine buckets and SMS times use it.
HOUSEHOLD_TZ = os.getenv("HOUSEHOLD_TZ", "America/New_York")

CORS_ORIGINS = [
    o.strip()
    for o in os.getenv("CORS_ORIGINS", "http://localhost:5173,http://127.0.0.1:5173").split(",")
    if o.strip()
]

# Built dashboard, served at "/" when present so everything lives at one URL.
FRONTEND_DIST = Path(os.getenv("FRONTEND_DIST", REPO_DIR / "frontend" / "dist"))

# Devices are defined here, not through the API (see contract/api.md).
# Override with DEVICES_JSON='[{"id": ..., "name": ..., "object_type": ..., "token": ...}]'.
_DEFAULT_DEVICES = [
    {"id": "fridge-1", "name": "Mom's fridge", "object_type": "fridge", "token": "dev-fridge-1"},
    {"id": "walker-1", "name": "Mom's walker", "object_type": "walker", "token": "dev-walker-1"},
    {"id": "door-1", "name": "Front door", "object_type": "door", "token": "dev-door-1"},
]
DEVICES: list[dict] = (
    json.loads(os.environ["DEVICES_JSON"]) if os.getenv("DEVICES_JSON") else _DEFAULT_DEVICES
)
DEVICE_TOKENS = {d["id"]: d["token"] for d in DEVICES}

DEFAULT_LIMIT_MINUTES = 720

# Accounts. SECRET_KEY signs login tokens; without one, a random key is made at startup and
# everyone is logged out when the server restarts. Set a long random value when deployed.
SECRET_KEY = os.getenv("SECRET_KEY", "") or secrets.token_hex(32)
SESSION_HOURS = float(os.getenv("SESSION_HOURS", "12"))
# The contract keeps dashboard endpoints open for the hackathon: without a login token they
# answer as before. AUTH_REQUIRED=true makes them reject requests that have no token.
AUTH_REQUIRED = os.getenv("AUTH_REQUIRED", "false").lower() == "true"
# Weather-aware check-ins: heat and cold advisories from the National Weather Service
# (api.weather.gov, free, no key) tighten a community's thresholds while they last.
# WEATHER_ENABLED=false skips the lookups (tests, offline demos); simulated advisories still work.
WEATHER_ENABLED = os.getenv("WEATHER_ENABLED", "true").lower() != "false"
WEATHER_REFRESH_SECONDS = float(os.getenv("WEATHER_REFRESH_SECONDS", "900"))
# The NWS asks every client to identify itself with a contact in the User-Agent.
WEATHER_USER_AGENT = os.getenv("WEATHER_USER_AGENT", "StillHere (HackGT demo)")
# During an advisory, grid thresholds are multiplied by this (4h/8h becomes 2h/4h).
WEATHER_THRESHOLD_FACTOR = float(os.getenv("WEATHER_THRESHOLD_FACTOR", "0.5"))

# Seeds the demo community (Maple Grove Senior Living) with invented residents and accounts.
SEED_DEMO_COMMUNITY = os.getenv("SEED_DEMO_COMMUNITY", "true").lower() != "false"
# Password for the seeded demo accounts. They hold invented data only.
DEMO_PASSWORD = os.getenv("DEMO_PASSWORD", "stillhere-demo")

# Demo clock: at 1440, one real second is 24 simulated minutes (12 h passes in 30 s).
DEMO_TIME_SCALE = float(os.getenv("DEMO_TIME_SCALE", "1440"))

# Durations the contract says are measured in REAL time, even in demo mode.
# OFFLINE_AFTER_SECONDS shortens the 2-hour offline window for demos, so unplugging the sensor
# turns its apartment gray on stage. The firmware heartbeats every 30 s, so 90 is a safe minimum.
OFFLINE_AFTER = timedelta(seconds=float(os.getenv("OFFLINE_AFTER_SECONDS", "7200")))
# REPLY_WINDOW_SECONDS shortens the "Are you okay?" wait for hardware testing; the contract says 30.
REPLY_WINDOW = timedelta(seconds=float(os.getenv("REPLY_WINDOW_SECONDS", "30")))

# The check loop runs every CHECK_INTERVAL_SECONDS real seconds. It is cheap, so one short
# interval serves both normal and demo mode. CHECKER_ENABLED=false turns it off (tests).
CHECK_INTERVAL_SECONDS = float(os.getenv("CHECK_INTERVAL_SECONDS", "2"))
CHECKER_ENABLED = os.getenv("CHECKER_ENABLED", "true").lower() != "false"

# Textbelt (https://textbelt.com) sends the texts. Without a key, texts are only logged.
TEXTBELT_API_KEY = os.getenv("TEXTBELT_API_KEY", "")
TEXTBELT_API_URL = os.getenv("TEXTBELT_API_URL", "https://textbelt.com/text")

# Email fallback: used when no SMS provider is set up or every text fails.
# RESEND_API_KEY sends over HTTPS (works on Railway, which blocks SMTP below the Pro plan).
# Without it, SMTP is used. For Gmail, SMTP_PASSWORD is an app password.
RESEND_API_KEY = os.getenv("RESEND_API_KEY", "")
RESEND_API_URL = os.getenv("RESEND_API_URL", "https://api.resend.com/emails")
SMTP_HOST = os.getenv("SMTP_HOST", "smtp.gmail.com")
SMTP_PORT = int(os.getenv("SMTP_PORT", "587"))
SMTP_USER = os.getenv("SMTP_USER", "")
SMTP_PASSWORD = os.getenv("SMTP_PASSWORD", "")
# Resend's free tier sends from onboarding@resend.dev, only to the account's own address.
EMAIL_FROM = os.getenv("EMAIL_FROM", "") or (
    "StillHere <onboarding@resend.dev>" if RESEND_API_KEY else SMTP_USER
)
ALERT_EMAILS = [e.strip() for e in os.getenv("ALERT_EMAILS", "").split(",") if e.strip()]
