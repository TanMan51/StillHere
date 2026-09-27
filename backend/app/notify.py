"""Outgoing texts and the email fallback. Owner: Person A.

send_sms() texts through Textbelt when TEXTBELT_API_KEY is set. Without it, it only logs
the text (dry run), so local dev and tests never send real messages.

send_email() goes to ALERT_EMAILS through Resend's HTTPS API when RESEND_API_KEY is
set, otherwise over SMTP. Callers use it when no SMS provider is
set up or every text failed.
"""

from __future__ import annotations

import json
import logging
import re
import smtplib
import urllib.error
import urllib.parse
import urllib.request
from email.message import EmailMessage

from . import config

log = logging.getLogger("stillhere.notify")

# Some providers sit behind bot filters that reject urllib's default User-Agent.
USER_AGENT = "StillHere/1.0"

# A period and the space after it. When the next word is capitalized like "You'll", its first
# letter is captured so it can be lowercased; words like "AM" or "I'm" are left as they are.
SENTENCE_BREAK = re.compile(r"\.\s+(\w)(?=[a-z])|\.\s+(?=\w)")


class SmsError(Exception):
    """The provider refused or failed to send. The message is safe to show (no credentials)."""


class EmailError(Exception):
    """SMTP failed. The message is safe to show (no credentials)."""


def sms_configured() -> bool:
    return textbelt_configured()


def textbelt_configured() -> bool:
    return bool(config.TEXTBELT_API_KEY)


def email_configured() -> bool:
    smtp = bool(config.SMTP_USER and config.SMTP_PASSWORD)
    return bool(config.ALERT_EMAILS) and (bool(config.RESEND_API_KEY) or smtp)


def send_email(subject: str, body: str) -> str:
    """Email every address in ALERT_EMAILS. Returns the channel used ("email")."""
    if config.RESEND_API_KEY:
        _send_resend(subject, body)
    else:
        _send_smtp(subject, body)
    log.info("email to %s sent: %s", ", ".join(config.ALERT_EMAILS), subject)
    return "email"


def _send_resend(subject: str, body: str) -> None:
    payload = {
        "from": config.EMAIL_FROM,
        "to": config.ALERT_EMAILS,
        "subject": subject,
        "text": body,
    }
    request = urllib.request.Request(
        config.RESEND_API_URL,
        data=json.dumps(payload).encode(),
        headers={
            "Authorization": f"Bearer {config.RESEND_API_KEY}",
            "Content-Type": "application/json",
            "User-Agent": USER_AGENT,
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=15) as response:
            response.read()
    except urllib.error.HTTPError as e:
        detail = e.read().decode(errors="replace")[:300]
        log.error("email failed: Resend HTTP %s: %s", e.code, detail)
        raise EmailError(f"Resend error {e.code}: {detail}") from e
    except urllib.error.URLError as e:
        log.error("email failed: Resend unreachable: %s", e.reason)
        raise EmailError(f"Resend unreachable: {e.reason}") from e


def _send_smtp(subject: str, body: str) -> None:
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


def send_sms(to: str, body: str) -> str:
    """Send one text to an E.164 number. Returns the channel used ("sms").

    Raises SmsError when the provider rejects the message.
    """
    if textbelt_configured():
        _send_textbelt(to, body)
    else:
        log.warning("DRY RUN sms to %s: %s", to, body)
    return "sms"


def textbelt_text(body: str) -> str:
    """Join sentences with semicolons: "a test. You'll get" -> "a test; you'll get".

    Unverified Textbelt keys refuse anything that looks like a link, and Textbelt reads a
    sentence break like "test. You'll" as the address "test.you" (.you is a real domain).
    """
    return SENTENCE_BREAK.sub(lambda m: "; " + (m.group(1) or "").lower(), body)


def _send_textbelt(to: str, body: str) -> None:
    data = urllib.parse.urlencode(
        {"phone": to, "message": textbelt_text(body), "key": config.TEXTBELT_API_KEY}
    ).encode()
    request = urllib.request.Request(
        config.TEXTBELT_API_URL, data=data, headers={"User-Agent": USER_AGENT}, method="POST"
    )
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
