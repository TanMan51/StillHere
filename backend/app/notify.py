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


class SmsError(Exception):
    """Twilio refused or failed to send. The message is safe to show (no credentials)."""


def send_sms(to: str, body: str) -> str:
    """Send one text. Returns the channel used ("sms"). Raises SmsError on Twilio errors."""
    if not twilio_configured():
        log.warning("DRY RUN sms to %s: %s", to, body)
        return "sms"
    from twilio.base.exceptions import TwilioException, TwilioRestException
    from twilio.rest import Client

    client = Client(config.TWILIO_ACCOUNT_SID, config.TWILIO_AUTH_TOKEN)
    try:
        msg = client.messages.create(to=to, from_=config.TWILIO_FROM_NUMBER, body=body)
    except TwilioRestException as e:
        log.error("sms to %s failed: Twilio error %s: %s", to, e.code, e.msg)
        raise SmsError(f"Twilio error {e.code}: {e.msg}") from e
    except TwilioException as e:
        log.error("sms to %s failed: %s", to, e)
        raise SmsError(f"Twilio error: {e}") from e
    log.info("sms to %s sent (sid %s)", to, msg.sid)
    return "sms"
