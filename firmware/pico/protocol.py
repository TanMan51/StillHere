"""Only these fields cross the HTTP API boundary; no client timestamps."""

import math


def api_payload(frame, device_id):
    kind = frame.get("type")
    if kind not in ("motion", "loud", "fall", "heartbeat", "reply"):
        raise ValueError("Unknown event type")
    body = {"device_id": device_id, "type": kind}
    if kind == "reply":
        value = frame.get("value")
        if value not in ("ok_button", "ok_voice", "help"):
            raise ValueError("Unknown reply value")
        body["value"] = value
    elif kind in ("motion", "loud", "fall"):
        level = float(frame["level"])
        if not math.isfinite(level) or level < 0:
            raise ValueError("Invalid level")
        body["level"] = level
    return body
