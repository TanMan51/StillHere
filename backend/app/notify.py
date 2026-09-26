"""Outgoing texts and the email fallback. Owner: Person A.

send_sms() picks the first configured provider: SimpleTexting (SIMPLETEXTING_API_KEY),
then Textbelt (TEXTBELT_API_KEY), then Twilio (TWILIO_*). With none, it only logs the
text (dry run), so local dev and tests never send real messages.

send_email() goes to ALERT_EMAILS over SMTP. Callers use it when no SMS provider is
set up or every text failed.
"""

from __future__ import annotations

import json
import logging
import smtplib
import urllib.error
import urllib.parse
import urllib.request
from email.message import EmailMessage

from . import config

log = logging.getLogger("stillhere.notify")


class SmsError(Exception):
    """The provider refused or failed to send. The message is safe to show (no credentials)."""


class EmailError(Exception):
    """SMTP failed. The message is safe to show (no credentials)."""


def sms_configured() -> bool:
    return simpletexting_configured() or textbelt_configured() or twilio_configured()


def textbelt_configured() -> bool:
    return bool(config.TEXTBELT_API_KEY)


def email_configured() -> bool:
    return bool(config.SMTP_USER and config.SMTP_PASSWORD and config.ALERT_EMAILS)


def send_email(subject: str, body: str) -> str:
    """Email every address in ALERT_EMAILS. Returns the channel used ("email")."""
    msg = EmailMessage()
    msg["Subject"] = subject
    msg["From"] = config.EMAIL_FROM
    msg["To"] = ", ".join(config.ALERT_EMAILS)
    msg.set_content(body)
    try:
        with smtplib.SMTP(config.SMTP_HOST, config.SMTP_PORT, timeout=15) as smtp:
            smtp.starttls()
            smtp.login(config.SMTP_USER, config.SMTP_PASSWORD)
            smtp.send_message(msg)
    except (smtplib.SMTPException, OSError) as e:
        log.error("email to %s failed: %s", msg["To"], e)
        raise EmailError(f"Email failed: {e}") from e
    log.info("email to %s sent: %s", msg["To"], subject)
    return "email"


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
    elif textbelt_configured():
        _send_textbelt(to, body)
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


def _send_textbelt(to: str, body: str) -> None:
    data = urllib.parse.urlencode(
        {"phone": to, "message": body, "key": config.TEXTBELT_API_KEY}
    ).encode()
    request = urllib.request.Request(config.TEXTBELT_API_URL, data=data, method="POST")
    try:
        with urllib.request.urlopen(request, timeout=15) as response:
            result = json.loads(response.read().decode(errors="replace"))
    except (urllib.error.URLError, ValueError) as e:
        log.error("sms to %s failed: Textbelt unreachable: %s", to, e)
        raise SmsError(f"Textbelt unreachable: {e}") from e
    if not result.get("success"):
        error = result.get("error", "unknown error")
        log.error("sms to %s failed: Textbelt: %s", to, error)
        raise SmsError(f"Textbelt error: {error}")
    log.info(
        "sms to %s sent via Textbelt (id %s, %s credits left)",
        to,
        result.get("textId"),
        result.get("quotaRemaining"),
    )


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
