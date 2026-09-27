import time

import config
import network

print("Configured hotspot:", repr(config.WIFI_SSID))

wifi = network.WLAN(network.STA_IF)
wifi.active(False)
time.sleep(1)
wifi.active(True)
try:
    wifi.config(pm=0xA11140)  # disable power-save; known to cause Pico W connect flakiness
except (ValueError, OSError):
    pass

print("Scanning for nearby 2.4GHz networks (Pico W's radio cannot see 5GHz-only networks)...")
results = wifi.scan()
target = config.WIFI_SSID.encode("utf-8")
found = False
for ssid, bssid, channel, rssi, security, hidden in results:
    name = ssid.decode("utf-8", "replace")
    is_match = ssid == target
    found = found or is_match
    print(
        "  {!r}  ch={} rssi={} security={} hidden={}{}".format(
            name, channel, rssi, security, hidden, "  <-- MATCH" if is_match else ""
        )
    )
print("Exact hotspot name found:", found)

if not found:
    print("Hotspot not visible to the Pico. Common causes:")
    print("  - It's broadcasting 5GHz-only (phone hotspots often default to this;")
    print("    on iPhone enable 'Maximize Compatibility' under Personal Hotspot,")
    print("    on Android force the hotspot band to 2.4GHz).")
    print("  - It's out of range or the phone's screen is locked (hotspot sleeps).")
    print("  - config.WIFI_SSID has a typo, extra space, or wrong case.")
    raise SystemExit

wifi.connect(config.WIFI_SSID, config.WIFI_PASSWORD)

for attempt in range(30):
    if wifi.isconnected():
        break
    print("Connecting... status:", wifi.status())
    time.sleep(1)

if wifi.isconnected():
    print("CONNECTED! IP address:", wifi.ifconfig()[0])
else:
    status = wifi.status()
    names = {}
    for n in (
        "STAT_IDLE",
        "STAT_CONNECTING",
        "STAT_WRONG_PASSWORD",
        "STAT_NO_AP_FOUND",
        "STAT_CONNECT_FAIL",
        "STAT_GOT_IP",
    ):
        v = getattr(network, n, None)
        if v is not None:
            names[v] = n
    print("FAILED. Final status:", status, "(" + names.get(status, "unknown") + ")")
