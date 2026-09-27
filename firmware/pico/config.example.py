# Copy to config.py on the Pico and fill in. config.py is gitignored; never commit
# the real Wi-Fi password or device token (the live token is in the DEVICES_JSON Railway var).
WIFI_SSID = "YOUR_2_4_GHZ_WIFI_NAME"
WIFI_PASSWORD = "YOUR_WIFI_PASSWORD"
# True prints the exact JSON without sending requests or triggering texts.
DRY_RUN = False
DEVICE_ID = "fridge-1"
# The header is just this device's own token, not the whole DEVICES_JSON map.
DEVICE_TOKEN = "YOUR_DEVICE_TOKEN"
API_URL = "https://stillhere-production-8652.up.railway.app/api/events"

HEARTBEAT_SECONDS = 30
HTTP_TIMEOUT_SECONDS = 6
