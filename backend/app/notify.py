"""Outgoing texts. Owner: Person A.

send_sms() sends through Twilio when TWILIO_* env vars are set. Without them it
only logs the text (dry run), so local dev and tests never send real messages.
"""

from __future__ import annotations

import logging

from . import config

log = logging.getLogger("stillhere.notify")


def twilio_configured() -> bool:
    return bool(
        config.TWILIO_ACCOUNT_SID and config.TWILIO_AUTH_TOKEN and config.TWILIO_FROM_NUMBER
    )


def send_sms(to: str, body: str) -> str:
    """Send one text. Returns the channel used ("sms"). Raises on Twilio errors."""
    if not twilio_configured():
        log.warning("DRY RUN sms to %s: %s", to, body)
        return "sms"
    from twilio.rest import Client

    client = Client(config.TWILIO_ACCOUNT_SID, config.TWILIO_AUTH_TOKEN)
    msg = client.messages.create(to=to, from_=config.TWILIO_FROM_NUMBER, body=body)
    log.info("sms to %s sent (sid %s)", to, msg.sid)
    return "sms"
