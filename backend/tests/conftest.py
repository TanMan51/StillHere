"""Shared test setup. Owner: Person A. Points the app at a throwaway database."""

import os
import tempfile

os.environ["CHECKER_ENABLED"] = "false"  # tests call checker.check_all() directly
os.environ["DATABASE_URL"] = f"sqlite:///{tempfile.mkdtemp()}/test.db"
for key in (
    "TWILIO_ACCOUNT_SID",
    "TWILIO_AUTH_TOKEN",
    "TWILIO_FROM_NUMBER",
    "SIMPLETEXTING_API_KEY",
    "SIMPLETEXTING_FROM_NUMBER",
):
    os.environ[key] = ""
