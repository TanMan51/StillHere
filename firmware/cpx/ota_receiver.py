import os
import time

import supervisor


def receive(uart, data, n, c, pixels):
    pixels.fill((0, 0, 60))
    print("OTA: receiving", n, "bytes")
    ok = False
    try:
        f = open("/ota_new.py", "wb")
        f.write(data)
        s = sum(data)
        left = n - len(data)
        t = time.monotonic() + 30
        while left > 0 and time.monotonic() < t:
            k = uart.in_waiting
            d = uart.read(min(k, left)) if k else None
            if d:
                f.write(d)
                s += sum(d)
                left -= len(d)
                t = time.monotonic() + 30
        f.close()
        ok = left <= 0 and (s & 0xFFFF) == c
        if ok:
            # Payload is precompiled app.mpy; code.py is just "import app".
            try:
                os.remove("/app.mpy")
            except OSError:
                pass
            os.rename("/ota_new.py", "/app.mpy")
    except OSError as e:
        print("OTA: write failed", e)
    print("OTA:", "ok" if ok else "failed", "- reloading")
    pixels.fill((0, 60, 0) if ok else (60, 0, 0))
    time.sleep(1)
    supervisor.reload()
