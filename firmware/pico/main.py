"""MicroPython on Pico W. HTTPS transport for CPX events."""

import gc
import json
import socket
import time

import config
import network
from machine import UART, Pin
from protocol import api_payload

# Install via: python -m mpremote connect COM3 mip install requests
if not config.DRY_RUN:
    import requests

uart = UART(0, baudrate=9600, tx=Pin(0), rx=Pin(1), rxbuf=4096)
led = Pin("LED", Pin.OUT)
led.off()
wlan = network.WLAN(network.STA_IF)
wlan.active(True)

# --- OTA relay -------------------------------------------------------------
# Dumb pipe only: whatever bytes arrive over this TCP port get forwarded
# straight onto the UART, unparsed. The CPX's own receiver (in cpx_code.py)
# is what understands the "OTA <len> <checksum>\n" + payload framing; the
# Pico doesn't need to know anything about it.
OTA_PORT = 8080
ota_server = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
ota_server.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
ota_server.bind(("0.0.0.0", OTA_PORT))
ota_server.listen(1)
ota_server.setblocking(False)
ota_client = None
ota_last_data = None


def pump_ota():
    global ota_client, ota_last_data
    if ota_client is None:
        try:
            ota_client, addr = ota_server.accept()
            ota_client.settimeout(0.1)
            ota_last_data = time.ticks_ms()
            print("OTA: connection from", addr)
        except OSError:
            return  # no pending connection, normal case
    try:
        # Smaller reads -> smaller UART bursts, easing pressure on the
        # CPX's small receive buffer (large bursts were overflowing it and
        # silently corrupting/dropping bytes).
        chunk = ota_client.recv(64)
    except OSError:
        chunk = b""  # timed out waiting for data; try again next loop
    if chunk:
        # uart.write() returns early with a short count when its TX buffer
        # is full; ignoring that silently dropped bytes mid-transfer.
        while chunk:
            n = uart.write(chunk)
            chunk = chunk[n or 0 :]
        ota_last_data = time.ticks_ms()
    elif time.ticks_diff(time.ticks_ms(), ota_last_data) > 5000:
        ota_client.close()
        ota_client = None
        print("OTA: connection idle, closing")


buffer = b""
queue = []
last_sensor = None
last_wifi_try = time.ticks_add(time.ticks_ms(), -15000)
last_heartbeat = time.ticks_add(time.ticks_ms(), -config.HEARTBEAT_SECONDS * 1000)
last_success = None
auth_failed = False


def sensor_fresh():
    return last_sensor is not None and time.ticks_diff(time.ticks_ms(), last_sensor) < 6000


def enqueue(body, received_at, retried):
    # Posts block for seconds on a weak hotspot, so a fall stuck behind
    # motion posts used to expire before it was sent.
    if body["type"] == "motion":
        # Backend only needs "person is active"; one pending is enough.
        if any(item[0]["type"] == "motion" for item in queue):
            return
        if len(queue) >= 16:
            print("QUEUE FULL: event lost motion")
            return
        queue.append((body, received_at, retried))
        return
    # Alarms and replies go ahead of motion, in arrival order.
    i = 0
    while i < len(queue) and queue[i][0]["type"] != "motion":
        i += 1
    queue.insert(i, (body, received_at, retried))
    if len(queue) > 16 and queue[-1][0]["type"] == "motion":
        queue.pop()


def ingest():
    global buffer, last_sensor
    data = uart.read() if uart.any() else None
    if data:
        buffer += data
    while b"\n" in buffer:
        raw, buffer = buffer.split(b"\n", 1)
        try:
            frame = json.loads(raw.decode("utf-8"))
            if frame.get("type") == "sensor_alive":
                last_sensor = time.ticks_ms()
                continue
            body = api_payload(frame, config.DEVICE_ID)
            last_sensor = time.ticks_ms()
            enqueue(body, time.ticks_ms(), False)
        except (ValueError, KeyError, TypeError, AttributeError, UnicodeError):
            print("Bad UART frame; check wire contacts")
    if len(buffer) > 512:
        buffer = b""
        print("Discarded incomplete UART frame")


# Backend sensitivity -> CPX (motion, fall) thresholds, in m/s^2 of movement.
# Higher sensitivity = lower threshold. "medium" matches cpx_code.py defaults.
THRESHOLDS = {"low": (0.6, 5.0), "medium": (0.35, 3.5), "high": (0.2, 2.5)}
last_settings_line = None


def forward_settings(settings):
    global last_settings_line
    if isinstance(settings, str):
        settings = {"sensitivity": settings}
    if not isinstance(settings, dict):
        return
    default = settings.get("sensitivity")
    motion = settings.get("motion_sensitivity", default)
    fall = settings.get("fall_sensitivity", default)
    sound = settings.get("sound_enabled")
    if motion is None and fall is None and sound is None:
        return
    motion = THRESHOLDS.get(str(motion or "medium").lower())
    fall = THRESHOLDS.get(str(fall or "medium").lower())
    if motion is None or fall is None:
        print("Unknown settings value:", settings)
        return
    # A line injected mid-transfer would corrupt the OTA file; the next reply
    # (heartbeat is every 30 s) resends it.
    if ota_client is not None:
        return
    # Last field: 1 = loud alerts on, 0 = off. Missing means on.
    line = "SET {} {} {}\n".format(motion[0], fall[1], 0 if sound is False else 1)
    # Resent on every reply, not just on change, so a CPX that rebooted
    # (OTA, power blip) picks the settings back up.
    uart.write(line)
    if line != last_settings_line:
        print("Settings -> CPX:", line.strip())
        last_settings_line = line


def post(body):
    """Returns False only on a network failure (worth retrying)."""
    global auth_failed, last_success
    if config.DRY_RUN:
        print("DRY RUN:", json.dumps(body))
        last_success = time.ticks_ms()
        return True
    response = None
    try:
        gc.collect()
        response = requests.post(
            config.API_URL,
            headers={"Content-Type": "application/json", "X-Device-Token": config.DEVICE_TOKEN},
            data=json.dumps(body),
            timeout=config.HTTP_TIMEOUT_SECONDS,
        )
        status = response.status_code
        print("HTTP", status, body["type"])
        if status == 202:
            reply = response.json()
            if reply.get("ok") is True:
                last_success = time.ticks_ms()
            else:
                print("Unexpected 202 body; inspect backend")
            forward_settings(reply.get("settings"))
        elif status == 401:
            auth_failed = True
            print("TOKEN REJECTED: fix DEVICE_ID / DEVICE_TOKEN, then reboot")
        elif status == 404:
            print("DEVICE ID REJECTED: check DEVICE_ID in config.py")
        elif status == 422:
            print("BODY REJECTED:", response.text[:160])
        else:
            print("Event not accepted:", response.text[:160])
    except Exception as exc:
        print("POST failed:", body["type"], repr(exc))
        return False
    finally:
        if response is not None:
            response.close()
        gc.collect()
    return True


print("StillHere:", config.DEVICE_ID, "DRY_RUN =", config.DRY_RUN)
if not config.DRY_RUN and config.WIFI_SSID == "YOUR_2_4_GHZ_WIFI_NAME":
    raise ValueError("Edit config.py with Wi-Fi details first")
_ip_printed = False

while True:
    ingest()
    now = time.ticks_ms()
    if not config.DRY_RUN and not wlan.isconnected():
        if time.ticks_diff(now, last_wifi_try) >= 15000:
            last_wifi_try = now
            try:
                wlan.disconnect()
                wlan.connect(config.WIFI_SSID, config.WIFI_PASSWORD)
                print("Connecting Wi-Fi...")
            except OSError as exc:
                print("Wi-Fi error:", exc)
    elif wlan.isconnected() and not _ip_printed:
        print("OTA relay listening on", wlan.ifconfig()[0] + ":" + str(OTA_PORT))
        _ip_printed = True

    pump_ota()

    # No client timestamps means old alarms cannot be safely backdated.
    # Bound local queue age; do not silently replay after a long outage.
    # Alarms get longer than motion, which is stale within seconds anyway.
    for item in queue[:]:
        limit = 8000 if item[0]["type"] == "motion" else 30000
        if time.ticks_diff(now, item[1]) > limit:
            queue.remove(item)
            print("Expired unsent event:", item[0]["type"])

    ready = config.DRY_RUN or wlan.isconnected()
    # A blocking POST mid-OTA lets TCP data pile up, then it bursts onto the
    # UART faster than the CPX can write flash and bytes get dropped.
    if ready and not auth_failed and ota_client is None:
        if queue:
            body, received_at, retried = queue.pop(0)
            # One retry for alarms/replies: a duplicate fall beats a lost one.
            if not post(body) and not retried and body["type"] != "motion":
                print("Retrying", body["type"])
                enqueue(body, received_at, True)
        elif (
            sensor_fresh()
            and time.ticks_diff(now, last_heartbeat) >= config.HEARTBEAT_SECONDS * 1000
        ):
            last_heartbeat = now
            post(api_payload({"type": "heartbeat"}, config.DEVICE_ID))

    # Green requires fresh CPX data and a recent successful post (or dry run).
    healthy = (
        sensor_fresh()
        and ready
        and not auth_failed
        and last_success is not None
        and time.ticks_diff(time.ticks_ms(), last_success) < 45000
    )
    led.value(healthy)
    time.sleep(0.01)
