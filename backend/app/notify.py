"""Outgoing texts. Owner: Person A.

send_sms() picks the first configured provider: SimpleTexting (SIMPLETEXTING_API_KEY),
then Twilio (TWILIO_*). With neither, it only logs the text (dry run), so local dev
and tests never send real messages.
"""

from __future__ import annotations

import json
import logging
import urllib.error
import urllib.request

from . import config

log = logging.getLogger("stillhere.notify")


class SmsError(Exception):
    """The provider refused or failed to send. The message is safe to show (no credentials)."""


def simpletexting_configured() -> bool:
    return bool(config.SIMPLETEXTING_API_KEY)


def twilio_configured() -> bool:
    return bool(
        config.TWILIO_ACCOUNT_SID and config.TWILIO_AUTH_TOKEN and config.TWILIO_FROM_NUMBER
    )


def send_sms(to: str, body: str) -> str:
    """Send one text to an E.164 number. Returns the channel used ("sms").

    Raises SmsError when the provider rejects the message.
    """
    if simpletexting_configured():
        _send_simpletexting(to, body)
    elif twilio_configured():
        _send_twilio(to, body)
    else:
        log.warning("DRY RUN sms to %s: %s", to, body)
    return "sms"


def _us_digits(phone: str) -> str:
    """SimpleTexting takes US numbers as 10 digits: +14045550123 -> 4045550123."""
    digits = "".join(c for c in phone if c.isdigit())
    return digits[1:] if len(digits) == 11 and digits.startswith("1") else digits


def _send_simpletexting(to: str, body: str) -> None:
    payload = {"contactPhone": _us_digits(to), "mode": "AUTO", "text": body}
    if config.SIMPLETEXTING_FROM_NUMBER:
        payload["accountPhone"] = _us_digits(config.SIMPLETEXTING_FROM_NUMBER)
    request = urllib.request.Request(
        config.SIMPLETEXTING_API_URL,
        data=json.dumps(payload).encode(),
        headers={
            "Authorization": f"Bearer {config.SIMPLETEXTING_API_KEY}",
            "Content-Type": "application/json",
            "Accept": "application/json",
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=15) as response:
            result = response.read().decode(errors="replace")
    except urllib.error.HTTPError as e:
        detail = e.read().decode(errors="replace")[:300]
        log.error("sms to %s failed: SimpleTexting HTTP %s: %s", to, e.code, detail)
        raise SmsError(f"SimpleTexting error {e.code}: {detail}") from e
    except urllib.error.URLError as e:
        log.error("sms to %s failed: %s", to, e.reason)
        raise SmsError(f"SimpleTexting unreachable: {e.reason}") from e
    log.info("sms to %s sent via SimpleTexting: %s", to, result[:200])


def _send_twilio(to: str, body: str) -> None:
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
    log.info("sms to %s sent via Twilio (sid %s)", to, msg.sid)
