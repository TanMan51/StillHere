import array
import math
import time

import audiobusio
import board
import busio
from adafruit_circuitplayground import cp

LOUD_THRESHOLD = 1000
MOTION_THRESHOLD = 0.35
FALL_THRESHOLD = 3.5
MOTION_COOLDOWN = 5
REPLY_WAIT_SECONDS = 30
ALARM_COOLDOWN = 45
BEEP_PERIOD = 1
FALL_NOISE = 1000
FALL_WINDOW = 1

uart = busio.UART(board.TX, board.RX, baudrate=9600, timeout=0, receiver_buffer_size=256)
mic = audiobusio.PDMIn(
    board.MICROPHONE_CLOCK, board.MICROPHONE_DATA, sample_rate=16000, bit_depth=16
)
samples = array.array("H", bytes(1024))
cp.pixels.brightness = 0.06
cp.pixels.fill((0, 0, 20))
baseline = list(cp.acceleration)
last_motion = -MOTION_COOLDOWN
next_alarm = 0
pending_until = 0
last_ping = -2
last_log = -1
previous_a = False
b_started = None
b_sent = False
motion_hits = 0
quiet_since = None
loud_rearmed = True
beeping = False
last_beep = 0
_ota_buf = b""
move_at = noise_at = None
move_peak = noise_peak = 0


def _check_uart():
    global _ota_buf, mic, samples, MOTION_THRESHOLD, FALL_THRESHOLD, LOUD_THRESHOLD
    if uart.in_waiting:
        _ota_buf += uart.read(uart.in_waiting) or b""
    if not _ota_buf:
        return False
    i = _ota_buf.find(b"OTA ")
    if i < 0:
        i = _ota_buf.find(b"SET ")
    if i < 0:
        _ota_buf = _ota_buf[-3:]
        return False
    _ota_buf = _ota_buf[i:]
    if b"\n" not in _ota_buf:
        return True
    line, rest = _ota_buf.split(b"\n", 1)
    _ota_buf = b""
    try:
        p = line.decode().split(" ")
        if p[0] == "SET":
            MOTION_THRESHOLD = float(p[1])
            FALL_THRESHOLD = float(p[2])
            LOUD_THRESHOLD = 1000 if p[3] == "1" else 1e9
            print("Settings:", p)
            _ota_buf = rest
            return False
        n = int(p[1])
        c = int(p[2])
    except (ValueError, IndexError):
        return False
    mic.deinit()
    mic = samples = None
    import gc

    gc.collect()
    import ota_receiver

    ota_receiver.receive(uart, rest, n, c, cp.pixels)


def send(event):
    parts = []
    for k, v in event.items():
        parts.append('"{}": "{}"'.format(k, v) if isinstance(v, str) else '"{}": {}'.format(k, v))
    uart.write(("{" + ", ".join(parts) + "}\n").encode("utf-8"))
    if event["type"] != "sensor_alive":
        print("UART:", event)


print("code.py v11, LOUD_THRESHOLD", LOUD_THRESHOLD, "REPLY_WAIT", REPLY_WAIT_SECONDS)

while True:
    if _check_uart():
        continue
    mic.record(samples, len(samples))
    mean = sum(samples) / len(samples)
    level = math.sqrt(sum((v - mean) ** 2 for v in samples) / len(samples))
    now = time.monotonic()
    acceleration = cp.acceleration
    movement = math.sqrt(sum((acceleration[i] - baseline[i]) ** 2 for i in range(3)))
    for i in range(3):
        baseline[i] += 0.15 * (acceleration[i] - baseline[i])

    if movement > FALL_THRESHOLD and move_at is None:
        move_at = now
        move_peak = movement
    if level > FALL_NOISE and noise_at is None:
        noise_at = now
        noise_peak = 0
    if noise_at is not None:
        noise_peak = max(noise_peak, level)

    if level < LOUD_THRESHOLD * 0.6:
        if quiet_since is None:
            quiet_since = now
        if now - quiet_since > 1:
            loud_rearmed = True
    else:
        quiet_since = None

    if move_at is not None and noise_at is not None and now >= next_alarm:
        send({"type": "fall", "level": round(move_peak, 2)})
        pending_until = now + REPLY_WAIT_SECONDS
        next_alarm = now + ALARM_COOLDOWN
        last_motion = now
        move_at = noise_at = None
        loud_rearmed = False
    if move_at is not None and now - move_at > FALL_WINDOW:
        if now - last_motion >= MOTION_COOLDOWN:
            send({"type": "motion", "level": round(move_peak, 2)})
            last_motion = now
        move_at = None
    if noise_at is not None and now - noise_at > FALL_WINDOW:
        if noise_peak > LOUD_THRESHOLD and loud_rearmed and now >= next_alarm:
            send({"type": "loud", "level": round(noise_peak, 1)})
            pending_until = now + REPLY_WAIT_SECONDS
            next_alarm = now + ALARM_COOLDOWN
            loud_rearmed = False
        noise_at = None

    motion_hits = motion_hits + 1 if movement > MOTION_THRESHOLD else 0
    if move_at is None and motion_hits >= 2 and now - last_motion >= MOTION_COOLDOWN:
        send({"type": "motion", "level": round(movement, 2)})
        last_motion = now
        motion_hits = 0

    a = cp.button_a
    b = cp.button_b
    if b:
        if b_started is None:
            b_started = now
        if not b_sent and now - b_started >= 1:
            send({"type": "reply", "value": "help"})
            b_sent = True
            pending_until = 0
    else:
        b_started = None
        b_sent = False
    if a and not previous_a and not b and now < pending_until:
        send({"type": "reply", "value": "ok_button"})
        pending_until = 0
    previous_a = a

    cp.pixels.fill((30, 10, 0) if now < pending_until else (0, 0, 20))

    if now < pending_until:
        if now - last_beep >= BEEP_PERIOD:
            cp.start_tone(1046)
            beeping = True
            last_beep = now
        elif beeping and now - last_beep >= 0.15:
            cp.stop_tone()
            beeping = False
    elif beeping:
        cp.stop_tone()
        beeping = False

    if now - last_ping >= 2:
        send({"type": "sensor_alive"})
        last_ping = now
    if now - last_log >= 1:
        print("Sound:", round(level), "Movement:", round(movement, 2))
        last_log = now
    time.sleep(0.02)
