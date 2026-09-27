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
- **Auth:** the device endpoint is authenticated with `X-Device-Token`. Dashboard endpoints
  accept an optional `Authorization: Bearer <token>` from `POST /api/auth/login` and then only
  return what that user may see (see Accounts and roles). Without a token they stay open for
  the hackathon, unless the server sets `AUTH_REQUIRED=true`, which makes them answer `401`.
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

**Device `motion_sensitivity`:** `low`, `medium`, `high`

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

Response `202`: `{"ok": true, "settings": {"sound_enabled": boolean, "motion_sensitivity": string}}`

The device applies `settings` after every post (heartbeats included), so changes from the
dashboard reach it within one heartbeat. `motion_sensitivity` picks its motion trigger (`low`
0.6 g, `medium` 0.35 g, `high` 0.2 g from rest). The device ignores `sound_enabled` and keeps
reporting loud sounds; the server drops them while it is false. Falls are always reported, at the
device's default fall trigger.

Example bodies: `fixtures/event_examples.json`

---

## Dashboard endpoints (used by the React app)

### `GET /api/devices`

Response: `{"server_now": timestamp, "devices": [Device]}` (see `fixtures/devices.json`)

**Device object**

| Field                 | Type               | Notes                                                                                                             |
| --------------------- | ------------------ | ----------------------------------------------------------------------------------------------------------------- |
| `id`                  | string             | e.g. `"fridge-1"`                                                                                                 |
| `name`                | string             | e.g. `"Mom's fridge"`                                                                                             |
| `object_type`         | object type        |                                                                                                                   |
| `status`              | status             |                                                                                                                   |
| `status_since`        | timestamp          | When the current status began.                                                                                    |
| `online`              | boolean            | False when no heartbeat for 2 hours.                                                                              |
| `last_motion_at`      | timestamp or null  |                                                                                                                   |
| `last_heartbeat_at`   | timestamp or null  |                                                                                                                   |
| `limit_minutes`       | integer            | Fixed inactivity limit (the hard ceiling).                                                                        |
| `next_alert_at`       | timestamp or null  | When an inactivity alert will fire if nothing moves. Null while an alert is active or the device is offline.      |
| `seconds_until_alert` | integer or null    | **Real** seconds until `next_alert_at`. Use this for the countdown and tick it down locally between polls.        |
| `routine_note`        | string or null     | Ready-to-display sentence from the learned routine. Null when there's nothing to say or the baseline isn't ready. |
| `active_alert`        | Alert or null      | The currently unresolved alert, if any.                                                                           |
| `sound_enabled`       | boolean            | Whether loud sounds start an "Are you okay?" check. Default `true`. `loud` events are ignored while false.        |
| `motion_sensitivity`  | motion sensitivity | Accelerometer sensitivity the device should use. Default `"medium"`.                                              |
| `resident_id`         | string or null     | The resident this device belongs to, e.g. `"mg-204"`.                                                             |

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

| Field              | Type                                                                 | Notes                                                           |
| ------------------ | -------------------------------------------------------------------- | --------------------------------------------------------------- |
| `id`               | integer                                                              |                                                                 |
| `device_id`        | string                                                               |                                                                 |
| `kind`             | alert kind                                                           |                                                                 |
| `message`          | string                                                               | The text that was sent (or would have been, for `false_alarm`). |
| `sms_sent`         | boolean                                                              | False for `false_alarm` and dashboard-only entries.             |
| `sent_at`          | timestamp                                                            |                                                                 |
| `resolved_at`      | timestamp or null                                                    |                                                                 |
| `resolved_by`      | `"motion"`, `"reply"`, `"family"`, `"staff"`, `"heartbeat"`, or null | `"staff"`: a healthcare provider marked the resident okay.      |
| `acknowledged_at`  | timestamp or null                                                    | When staff said "I'm on it".                                    |
| `acknowledged_by`  | string or null                                                       | Name of the staff member who acknowledged.                      |
| `escalation_level` | integer                                                              | 0, then +1 each time an unacknowledged urgent alert escalates.  |

**Baseline object**

| Field                      | Type          | Notes                                                                       |
| -------------------------- | ------------- | --------------------------------------------------------------------------- |
| `ready`                    | boolean       | False until about 5 days of data. Until then only the fixed limit applies.  |
| `days_of_data`             | integer       |                                                                             |
| `timezone`                 | string        | IANA name, e.g. `"America/New_York"`. Hour indexes below use this timezone. |
| `hourly_activity`          | [number] × 24 | Average motion events per hour of day, index 0 = midnight.                  |
| `hourly_threshold_minutes` | [number] × 24 | Gap that counts as unusual at each hour of day.                             |

### `PATCH /api/devices/{id}`

Body (all optional): `{"name": string, "limit_minutes": integer 1–2880, "sound_enabled": boolean,
"motion_sensitivity": motion sensitivity}`

Response: `{"server_now": timestamp, "device": Device}`

### `POST /api/alerts/{id}/resolve`

Family marks an alert as handled ("I called, she's fine"). Sets `resolved_by: "family"` and
returns the device to `ok` if nothing else is active. No body.

Response: `{"ok": true}`

### `POST /api/alerts/{id}/acknowledge`

Staff's "I'm on it" (provider token only; `403` for family). Records `acknowledged_at` and
`acknowledged_by` (the staff member's name) and stops escalation. Acknowledging again changes
nothing. No body.

Response: Alert

### Accounts and roles

Two roles: `family` (a caregiver who follows one resident) and `provider` (healthcare staff who
see every resident in their community). With a token, `GET /api/devices`, `GET/PATCH
/api/devices/{id}`, and `POST /api/alerts/{id}/resolve` only cover the user's residents;
anything else answers `404`, as if it didn't exist. For family caregivers, a resident who
doesn't share alerts shows `active_alert: null` and `alerts: []`, and one who doesn't share
activity shows `events: []`.

- `POST /api/auth/login`, body `{"email": string, "password": string}` →
  `{"token": string, "user": User}` (see `fixtures/auth_login.json`), or `401`.
  Tokens last 12 hours.
- `GET /api/auth/me` → `{"user": User}`, or `401` without a valid token.

**User object:** `id` (int), `email`, `name`, `role` (`"family"` or `"provider"`),
`community_id` (string or null), `community_name` (string or null), `resident_id` (string or
null; set for family caregivers).

### Residents

- `GET /api/residents` → `[Resident]`, the residents the caller may see, by floor then unit
  (see `fixtures/residents.json`).
- `PATCH /api/residents/{id}`, body (all optional) `{"share_alerts_with_family": boolean,
"share_activity_with_family": boolean, "family_notify": "immediately" | "if_unanswered"}` →
  Resident.
- `POST /api/residents/{id}/okay` → Resident. Someone visited or called and the resident is
  okay ("Mark as okay"). Records `marked_okay_at`/`marked_okay_by`, adds a motion event with
  `value: "check_in"` to each of the resident's devices (restarting the no-movement countdown,
  like resolving an alert does), and resolves open alerts except `offline` ones. Family
  caregivers can mark only their own resident. No body.
- `GET /api/residents/{id}/summary` → everything for the resident page and the printable visit
  summary (see `fixtures/resident_summary.json`, whose trend is cut to 5 days):
  `{"server_now", "resident": Resident, "community_name": string or null, "timezone": IANA name,
"unit": Unit or null,
"devices": [{"id", "name", "object_type", "status", "online"}], "trend": Trend or null,
"alerts": [Alert], "response_times": ResponseTimes}`. `alerts` covers the last 30 days, newest
  first. For family caregivers, `trend` is null and `alerts` empty when the resident doesn't
  share activity or alerts.

**Trend object:** `days` (30 × `{"date": "YYYY-MM-DD", "count": integer}`, oldest first, local
dates; the last is today, still in progress), `recent_daily_average` and
`prior_daily_average` (numbers or null: the last 7 full days and the 21 before),
`lower_than_usual` (boolean), `note` (string or null). The flag compares a resident only with
their own past, and its wording is never medical: "Activity lower than usual…".

**Resident object:** `id` (string), `community_id` (string or null), `first_name`,
`last_name`, `floor` (integer or null), `unit` (string or null), `share_alerts_with_family`
(boolean, default true), `share_activity_with_family` (boolean, default true), `family_notify`
(`"immediately"` or `"if_unanswered"`, default `"immediately"`: when family hears about urgent
alerts in a community with an on-call phone), `marked_okay_at` (timestamp or null),
`marked_okay_by` (string or null), `device_ids` ([string]).

### Community (healthcare providers)

Both endpoints need a provider token: `401` without a login, `403` for family caregivers.

- `GET /api/community` → `{"server_now": timestamp, "community": Community, "units": [Unit],
"checkin": Checkin, "weather": Weather or null, "conditions": Conditions or null,
"response_times": ResponseTimes}`, units by
  floor then unit (see
  `fixtures/community.json`, which shows one unit per state).
- `PATCH /api/community`, body (all optional) `{"watch_after_minutes": integer 1–10080,
"worry_after_minutes": integer 1–10080, "on_call_phone": E.164 string or "" to clear,
"escalate_after_minutes": integer 1–240, "checkin_time": "HH:MM", "latitude": number,
"longitude": number, "location_name": string}` → Community. Latitude and longitude change
  together; without `location_name`, the server names the place ("Macon, GA") from the
  coordinates, and it checks the new location's weather right away. `422` unless
  watch comes before worry.

**Community object:** `id`, `name`, `watch_after_minutes` (default 240), `worry_after_minutes`
(default 480), `on_call_phone` (string or null), `escalate_after_minutes` (default 10),
`checkin_time` (local `"HH:MM"`, default `"10:00"`), `latitude` and `longitude` (numbers or
null: where weather advisories are looked up), `location_name` (string or null, e.g.
`"Atlanta, GA"`).

**Checkin object** (who to call or visit): `time` (`"HH:MM"`), `reason` (`"morning"` or
`"weather"`), `since` (timestamp), `resident_ids` ([string]: residents with no movement
since then, longest inactivity first). Normally `since` is the latest occurrence of the local
check-in time (today's once it has passed, otherwise yesterday's). During a weather advisory
the reason is `"weather"` and `since` is now minus the tightened watch threshold.

**Weather object** (a heat or cold advisory in effect, else `null`): `id`, `event` (the NWS
event, e.g. `"Heat Advisory"`), `kind` (`"heat"` or `"cold"`), `headline` (string or null),
`ends_at` (timestamp or null), `source` (`"nws"` or `"simulated"`), `watch_after_minutes` and
`worry_after_minutes` (the tightened thresholds the grid is using). Advisories come from the
National Weather Service (api.weather.gov) every 15 minutes. While one is in effect, grid
thresholds are halved and each quiet resident with a real, online sensor has their family
texted once: "StillHere: Heat Advisory in effect. Rosa's apartment has been quiet since
11:05 AM. You may want to check in."

**Conditions object** (current weather from Open-Meteo, refreshed with the advisories):
`temperature_f` and `feels_like_f` (numbers or null), `description` (string or null, e.g.
`"Partly cloudy"`), `observed_at` (timestamp or null).

- `GET /api/places?query=string` → `[{"name": string, "latitude": number, "longitude":
number}]`, up to 6 US cities and towns matching the query (e.g. `"Decatur, Georgia"`), for
  choosing the community's location. `422` for fewer than 2 letters, `502` when the search
  service is down. Provider token only.
- `POST /api/community/weather/simulate`, body `{"kind": "heat" | "cold" | null}` →
  `{"weather": Weather or null}`. Demo control: starts a 6-hour simulated advisory, or clears
  it (`null`). Provider token only.

**ResponseTimes object:** `alerts` (integer, alerts in the last 30 days), `acknowledged`
(integer), `average_acknowledge_seconds` (integer or null: sent to "I'm on it"),
`average_resolve_seconds` (integer or null: sent to resolved, over acknowledged alerts).

**Unit object** (one apartment and its resident):

| Field                       | Type                                          | Notes                                                                                 |
| --------------------------- | --------------------------------------------- | ------------------------------------------------------------------------------------- |
| `resident_id`               | string                                        |                                                                                       |
| `first_name`                | string                                        |                                                                                       |
| `last_name`                 | string                                        |                                                                                       |
| `floor`                     | integer or null                               |                                                                                       |
| `unit`                      | string or null                                | Apartment number, e.g. `"204"`.                                                       |
| `state`                     | `fine`, `watch`, `worry`, `offline`, `urgent` | See below. The dashboard displays it and never recomputes it.                         |
| `minutes_since_motion`      | integer or null                               | Demo-clock minutes since any of the resident's devices last moved.                    |
| `last_motion_at`            | timestamp or null                             |                                                                                       |
| `last_event`                | `{"type", "value", "ts"}` or null             | Newest non-heartbeat event from any of the resident's devices.                        |
| `online`                    | boolean                                       | True when any of the resident's devices is online.                                    |
| `last_heartbeat_at`         | timestamp or null                             |                                                                                       |
| `device_id`                 | string or null                                | The device to open for details: the one with the alert, else the one that moved last. |
| `device_status`             | status or null                                | That device's status.                                                                 |
| `active_alert`              | Alert or null                                 | The resident's open alert, urgent ones first.                                         |
| `activity_lower_than_usual` | boolean                                       | The resident's wellness trend flag (see Trend).                                       |

**Unit `state`**, most severe first: `urgent` (an open `urgent` or `no_reply` alert), `offline`
(no device online, so a dead battery never looks like safety), `worry` (no movement for
`worry_after_minutes`, or none recorded), `watch` (no movement for `watch_after_minutes`),
`fine`.

### Contacts

- `GET /api/contacts` → `[Contact]` (see `fixtures/contacts.json`)
- `POST /api/contacts`, body `{"name": string, "phone": string, "resident_id": string
(optional)}` → `201` with the new Contact. Phone must be E.164 format (`+14045550123`),
  otherwise `422`. A family caregiver's contacts always follow their own resident.
- `DELETE /api/contacts/{id}` → `204`, no body
- `POST /api/contacts/{id}/test` → sends a test text. Response `{"ok": true, "channel": "sms" | "email"}`

**Contact object:** `id` (int), `name`, `phone`, `created_at` (timestamp), `resident_id`
(string or null)

**Who gets alerts.** A resident's family contacts (those with their `resident_id`, plus
unassigned contacts, which get every alert as before accounts existed) receive the resident's
alerts, unless the resident doesn't share alerts with family. In a community with an
`on_call_phone`, urgent alerts (`urgent`, `no_reply`) text the on-call phone first, with family
at the same time when `family_notify` is `"immediately"`. If staff don't acknowledge within
`escalate_after_minutes` (real minutes), the alert escalates: first to family who were waiting
(`"if_unanswered"`), otherwise to the on-call phone again, up to 3 times. Each escalation text
starts with "StillHere: not yet acknowledged after N minutes".

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

- Offline detection uses real time, so heartbeats don't look hours apart. The server setting
  `OFFLINE_AFTER_SECONDS` (default 7200) can shorten the 2-hour window for a live demo.
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
- `no_reply` after a fall: "StillHere: Possible fall detected at Mom's, and no reply when asked if she's okay. You may want to call."
- `offline`: "StillHere: Mom's front door sensor is offline. Its battery or Wi-Fi may need a check."
- `all_clear`: "StillHere: Activity detected at Mom's fridge since the alert. She's likely okay."

---

## Changelog

- v1: initial contract.
- Add `sound_enabled` and `motion_sensitivity` to Device, `PATCH /api/devices/{id}`, and the
  `POST /api/events` response.
- Lower the `limit_minutes` minimum from 60 to 1 so a check-in time can be minutes only.
- Add accounts and roles: `POST /api/auth/login`, `GET /api/auth/me`, optional bearer tokens
  on dashboard endpoints, `GET/PATCH /api/residents`, and `resident_id` on Device.
- Add the community housing grid: `GET/PATCH /api/community`.
- Add staff alert handling and community views: `POST /api/alerts/{id}/acknowledge`,
  `acknowledged_at`/`acknowledged_by`/`escalation_level` and `resolved_by: "staff"` on Alert,
  on-call routing and escalation, community `on_call_phone`/`escalate_after_minutes`/
  `checkin_time`, `checkin` and `response_times` on `GET /api/community`,
  `activity_lower_than_usual` on Unit, `family_notify` on Resident, `resident_id` on Contact,
  and `GET /api/residents/{id}/summary`.
- Add weather-aware check-ins: `weather` on `GET /api/community`, `reason` on Checkin,
  community `latitude`/`longitude`, and `POST /api/community/weather/simulate`.
- Add weather location and conditions: community `location_name`, `conditions` on
  `GET /api/community`, and `GET /api/places`.
- Add "Mark as okay": `POST /api/residents/{id}/okay`, `marked_okay_at`/`marked_okay_by` on
  Resident, and `value: "check_in"` on the motion events it records.
