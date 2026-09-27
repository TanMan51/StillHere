"""Shared test setup. Owner: Person A. Points the app at a throwaway database."""

import os
import tempfile

os.environ["CHECKER_ENABLED"] = "false"  # tests call checker.check_all() directly
os.environ["WEATHER_ENABLED"] = "false"  # tests never call the real weather service
os.environ["DATABASE_URL"] = f"sqlite:///{tempfile.mkdtemp()}/test.db"
for key in (
    "TEXTBELT_API_KEY",
    "RESEND_API_KEY",
    "SMTP_USER",
    "SMTP_PASSWORD",
    "ALERT_EMAILS",
):
    os.environ[key] = ""
