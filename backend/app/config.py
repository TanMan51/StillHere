"""Settings, read once from environment variables (see .env.example). Owner: Person A."""

from __future__ import annotations

import json
import os
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

# Demo clock: at 1440, one real second is 24 simulated minutes (12 h passes in 30 s).
DEMO_TIME_SCALE = float(os.getenv("DEMO_TIME_SCALE", "1440"))

# Durations the contract says are measured in REAL time, even in demo mode.
OFFLINE_AFTER = timedelta(hours=2)
REPLY_WINDOW = timedelta(seconds=30)

# The check loop runs every CHECK_INTERVAL_SECONDS real seconds. It is cheap, so one short
# interval serves both normal and demo mode. CHECKER_ENABLED=false turns it off (tests).
CHECK_INTERVAL_SECONDS = float(os.getenv("CHECK_INTERVAL_SECONDS", "2"))
CHECKER_ENABLED = os.getenv("CHECKER_ENABLED", "true").lower() != "false"

# SimpleTexting. When the API key is set, texts go through SimpleTexting instead of Twilio.
SIMPLETEXTING_API_KEY = os.getenv("SIMPLETEXTING_API_KEY", "")
SIMPLETEXTING_FROM_NUMBER = os.getenv("SIMPLETEXTING_FROM_NUMBER", "")  # optional
SIMPLETEXTING_API_URL = os.getenv(
    "SIMPLETEXTING_API_URL", "https://api-app2.simpletexting.com/v2/api/messages"
)

# Twilio. When neither provider is configured, notify.py logs texts instead of sending them.
TWILIO_ACCOUNT_SID = os.getenv("TWILIO_ACCOUNT_SID", "")
TWILIO_AUTH_TOKEN = os.getenv("TWILIO_AUTH_TOKEN", "")
TWILIO_FROM_NUMBER = os.getenv("TWILIO_FROM_NUMBER", "")

# Email fallback: used when no SMS provider is set up or every text fails.
# For Gmail, SMTP_PASSWORD is an app password (Google Account > Security > App passwords).
SMTP_HOST = os.getenv("SMTP_HOST", "smtp.gmail.com")
SMTP_PORT = int(os.getenv("SMTP_PORT", "587"))
SMTP_USER = os.getenv("SMTP_USER", "")
SMTP_PASSWORD = os.getenv("SMTP_PASSWORD", "")
EMAIL_FROM = os.getenv("EMAIL_FROM", "") or SMTP_USER
ALERT_EMAILS = [e.strip() for e in os.getenv("ALERT_EMAILS", "").split(",") if e.strip()]
