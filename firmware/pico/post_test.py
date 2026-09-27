"""One-shot smoke test: Wi-Fi + backend connectivity, no CPX required.
Run with: python -m mpremote connect COM3 run post_test.py"""

import gc
import json
import time

import config
import network
import requests

wlan = network.WLAN(network.STA_IF)
wlan.active(True)
if not wlan.isconnected():
    print("Connecting Wi-Fi...")
    wlan.connect(config.WIFI_SSID, config.WIFI_PASSWORD)
    for _ in range(30):
        if wlan.isconnected():
            break
        time.sleep(1)

if not wlan.isconnected():
    print("Wi-Fi FAILED, status:", wlan.status())
else:
    print("Wi-Fi OK, IP:", wlan.ifconfig()[0])
    body = {"device_id": config.DEVICE_ID, "type": "motion", "level": 1.8}
    gc.collect()
    response = requests.post(
        config.API_URL,
        headers={"Content-Type": "application/json", "X-Device-Token": config.DEVICE_TOKEN},
        data=json.dumps(body),
        timeout=config.HTTP_TIMEOUT_SECONDS,
    )
    print("HTTP", response.status_code, response.text[:160])
    response.close()
