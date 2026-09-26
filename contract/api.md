# StillHere API contract (v1)

This file is the single agreement between the backend (Person A), the dashboard (Person B),
and the firmware (hardware person). Example responses live in `contract/fixtures/`.

**Change rules:** additive only. You may add a field or an endpoint. Never rename, remove, or
change the type of anything. Each change is its own small commit titled `contract: ...`, both
software people look at it, and it gets a line in the changelog at the bottom.

---

## Conventions

- **Base URL:** `/api` on the deployed host. Locally: `http://localhost:8000/api`.
- **Format:** JSON everywhere. Keys are `snake_case` (the frontend uses them as-is, no renaming).
- **Timestamps:** ISO 8601 in UTC with a `Z`, e.g. `"2026-09-26T14:15:00Z"`. The frontend
  converts to the household timezone for display.
- **`server_now`:** every response the dashboard polls includes the server's current time.
  Compute "12 minutes ago" as `server_now - timestamp`, never with the browser clock, because
  the demo clock can run fast (see Demo clock).
- **Nullable fields are always present** with the value `null`. Never omitted.
- **Errors:** FastAPI's default shape, `{"detail": "human-readable message"}`.
  - `401` bad or missing device token
  - `404` unknown device, alert, or contact id
  - `422` invalid request body
- **Auth:** only the device endpoint is authenticated (`X-Device-Token` header). Dashboard
  endpoints are open for the hackathon.
- **Devices are defined in backend config** (id, name, object type, token). There is no
  endpoint to register a device.

---

## Enums

**Device `status`** (if several apply, the most severe wins, in this order):

| Value            | Meaning                                                                           |
| ---------------- | --------------------------------------------------------------------------------- |
| `urgent`         | Heard "help" or "I fell". Urgent text sent.                                       |
| `no_reply_alert` | Loud sound or fall, no reply within 30 s. Gentle text sent.                       |
| `inactive_alert` | No movement past the learned or fixed limit. Check-in text sent.                  |
| `offline`        | No heartbeat for 2 hours. "Device offline" text sent.                             |
| `awaiting_reply` | Loud sound or fall just happened; speaker is asking "Are you okay?" (up to 30 s). |
| `ok`             | Nothing wrong.                                                                    |

**Alert `kind`:** `inactivity`, `urgent`, `no_reply`, `false_alarm`, `offline`, `all_clear`

**Event `type`:** `motion`, `loud`, `reply`, `fall`, `heartbeat`

**Reply `value`:** `ok_button`, `ok_voice`, `help`

**Device `object_type`:** `fridge`, `walker`, `door`, `other`

---

## Device endpoint (used by the Pico W)

### `POST /api/events`

Headers: `Content-Type: application/json`, `X-Device-Token: <token from backend config>`

| Field       | Type           | Required    | Notes                                               |
| ----------- | -------------- | ----------- | --------------------------------------------------- |
| `device_id` | string         | yes         | Must match the token.                               |
| `type`      | event type     | yes         |                                                     |
| `value`     | string or null | for `reply` | One of the reply values.                            |
| `level`     | number or null | no          | Loudness for `loud`, jolt size for `motion`/`fall`. |

The device does **not** send a timestamp. The Pico W has no reliable clock, so the server
stamps each event when it arrives.

Heartbeat: send `{"device_id": "...", "type": "heartbeat"}` every hour in normal mode,
every 30 s in demo mode.

Response `202`: `{"ok": true}`

Example bodies: `fixtures/event_examples.json`

---

## Dashboard endpoints (used by the React app)

### `GET /api/devices`

Response: `{"server_now": timestamp, "devices": [Device]}` (see `fixtures/devices.json`)

**Device object**

| Field                 | Type              | Notes                                                                                                             |
| --------------------- | ----------------- | ----------------------------------------------------------------------------------------------------------------- |
| `id`                  | string            | e.g. `"fridge-1"`                                                                                                 |
| `name`                | string            | e.g. `"Mom's fridge"`                                                                                             |
| `object_type`         | object type       |                                                                                                                   |
| `status`              | status            |                                                                                                                   |
| `status_since`        | timestamp         | When the current status began.                                                                                    |
| `online`              | boolean           | False when no heartbeat for 2 hours.                                                                              |
| `last_motion_at`      | timestamp or null |                                                                                                                   |
| `last_heartbeat_at`   | timestamp or null |                                                                                                                   |
| `limit_minutes`       | integer           | Fixed inactivity limit (the hard ceiling).                                                                        |
| `next_alert_at`       | timestamp or null | When an inactivity alert will fire if nothing moves. Null while an alert is active or the device is offline.      |
| `seconds_until_alert` | integer or null   | **Real** seconds until `next_alert_at`. Use this for the countdown and tick it down locally between polls.        |
| `routine_note`        | string or null    | Ready-to-display sentence from the learned routine. Null when there's nothing to say or the baseline isn't ready. |
| `active_alert`        | Alert or null     | The currently unresolved alert, if any.                                                                           |

### `GET /api/devices/{id}`

Response: `{"server_now": timestamp, "device": DeviceDetail}` (see `fixtures/device_detail.json`)

DeviceDetail is the Device object plus:

| Field      | Type     | Notes                                      |
| ---------- | -------- | ------------------------------------------ |
| `events`   | [Event]  | Newest first, max 50, heartbeats excluded. |
| `alerts`   | [Alert]  | Newest first, max 50.                      |
| `baseline` | Baseline |                                            |

**Event object:** `id` (int), `type`, `value` (string or null), `level` (number or null), `ts` (timestamp)

**Alert object**

| Field         | Type                                                      | Notes                                                           |
| ------------- | --------------------------------------------------------- | --------------------------------------------------------------- |
| `id`          | integer                                                   |                                                                 |
| `device_id`   | string                                                    |                                                                 |
| `kind`        | alert kind                                                |                                                                 |
| `message`     | string                                                    | The text that was sent (or would have been, for `false_alarm`). |
| `sms_sent`    | boolean                                                   | False for `false_alarm` and dashboard-only entries.             |
| `sent_at`     | timestamp                                                 |                                                                 |
| `resolved_at` | timestamp or null                                         |                                                                 |
| `resolved_by` | `"motion"`, `"reply"`, `"family"`, `"heartbeat"`, or null |                                                                 |

**Baseline object**

| Field                      | Type          | Notes                                                                       |
| -------------------------- | ------------- | --------------------------------------------------------------------------- |
| `ready`                    | boolean       | False until about 5 days of data. Until then only the fixed limit applies.  |
| `days_of_data`             | integer       |                                                                             |
| `timezone`                 | string        | IANA name, e.g. `"America/New_York"`. Hour indexes below use this timezone. |
| `hourly_activity`          | [number] × 24 | Average motion events per hour of day, index 0 = midnight.                  |
| `hourly_threshold_minutes` | [number] × 24 | Gap that counts as unusual at each hour of day.                             |

### `PATCH /api/devices/{id}`

Body (all optional): `{"name": string, "limit_minutes": integer 60–2880}`

Response: `{"server_now": timestamp, "device": Device}`

### `POST /api/alerts/{id}/resolve`

Family marks an alert as handled ("I called, she's fine"). Sets `resolved_by: "family"` and
returns the device to `ok` if nothing else is active. No body.

Response: `{"ok": true}`

### Contacts

- `GET /api/contacts` → `[Contact]` (see `fixtures/contacts.json`)
- `POST /api/contacts`, body `{"name": string, "phone": string}` → `201` with the new Contact.
  Phone must be E.164 format (`+14045550123`), otherwise `422`.
- `DELETE /api/contacts/{id}` → `204`, no body
- `POST /api/contacts/{id}/test` → sends a test text. Response
  `{"ok": true, "channel": "sms" | "email", "sms_error": string | null}`. When the text fails and
  the test falls back to email, `sms_error` says why (for example the SMS provider's error);
  otherwise it is `null`.

**Contact object:** `id` (int), `name`, `phone`, `created_at` (timestamp)

All alerts go to every contact.

### Demo controls

- `GET /api/demo` → Demo object (see `fixtures/demo.json`)
- `POST /api/demo`, body `{"enabled": boolean, "time_scale": number (optional, default 1440),
"start_clock_at": timestamp (optional)}` → Demo object
- `POST /api/demo/seed`, body `{"device_id": string, "days": integer (optional, default 7)}`
  → `{"ok": true, "events_created": integer}`
- `POST /api/demo/reset` → `{"ok": true}`. Clears events and alerts and sets every device to
  `ok`. Keeps devices and contacts.

**Demo object:** `enabled` (bool), `time_scale` (number), `clock_started_at` (timestamp or null),
`server_now` (timestamp)

---

## Demo clock

When demo mode is on, server time runs fast:
`now = start_clock_at + (real seconds since enabling × time_scale)`.
At the default `time_scale` of 1440, one real second is 24 simulated minutes, so a 12-hour
limit passes in 30 real seconds. `start_clock_at` lets you jump to a moment such as 7:00 AM to
demo the learned-routine alert.

Everything uses the demo clock (timestamps, alert checks, the baseline) **except**:

- Offline detection uses real time, so heartbeats don't look hours apart.
- The 30-second reply window uses real time, so a person has a fair chance to answer.
- `seconds_until_alert` is always in real seconds.

`seed` creates the synthetic history ending at the current demo-clock time.

---

## Alert text examples

Wording lives in `backend/app/messages.py`. These are examples, not a fixed format.

- `inactivity` (learned): "StillHere: No activity from Mom's fridge since 11:10 PM. It's usually opened by 8:30 AM. You may want to call her."
- `inactivity` (fixed): "StillHere: No activity from Mom's fridge since 8:15 PM. You may want to call her."
- `urgent`: "URGENT from StillHere: Mom asked for help near the fridge. Please call her now."
- `no_reply`: "StillHere: Loud sound at Mom's, and no reply when asked if she's okay. You may want to call."
- `offline`: "StillHere: Mom's front door sensor is offline. Its battery or Wi-Fi may need a check."
- `all_clear`: "StillHere: Activity detected at Mom's fridge since the alert. She's likely okay."

---

## Changelog

- v1: initial contract.
- v1.1: `POST /api/contacts/{id}/test` response adds `sms_error`.
