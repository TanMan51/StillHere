# Person B: running and understanding StillHere

You own this entire frontend, `backend/app/routine/`, and
`backend/tests/test_routine.py`. The shared API contract and Person A's files
have not been edited.

## Run it

From the repository root in PowerShell:

```powershell
cd frontend
npm.cmd install
npm.cmd run dev
```

Open http://localhost:5173. Mock mode is on by default. It uses the team's
fixtures, sends no texts, and resets changes on reload. Try a device card,
save a new name, mark the fridge alert handled, then add/remove a contact.
The demo controls live at http://localhost:5173/demo, outside the main menu.

To connect to Person A's server at localhost:8000:

```powershell
$env:VITE_USE_MOCK = 'false'
npm.cmd run dev
```

Restart Vite after changing the flag. Requests to `/api` are forwarded to port
8000 by `vite.config.ts`. For production, set the same flag **before** running
`npm.cmd run build`; it is baked into the build. Give Person A `frontend/dist`.
Their server must serve `index.html` for frontend routes such as `/contacts`
and `/devices/fridge-1`, while keeping API routes separate.

```powershell
npm.cmd test
npm.cmd run build
```

With the dev server running, `node scripts/check-browser.mjs` exercises the
main flows in headless Chrome and writes desktop/mobile screenshots to
`frontend/screenshots/`. Set `BROWSER_CHANNEL=msedge` to use Edge instead.
Format frontend changes with `npm.cmd run format`; verify with `npm.cmd run format:check`.
Generated output, local environments, and dependency caches are excluded in `.prettierignore`.

## The big picture

```text
React page -> api.ts -> mock.ts -> shared JSON fixtures (preview)
                    -> /api   -> Person A's FastAPI server (live)

Person A's checker -> compute_baseline(history, now, timezone)
                   -> evaluate(baseline, last_motion, now, limit, name)
                   -> sends alerts and returns dashboard data
```

The dashboard displays decisions. The server owns decisions and sends texts.
The browser never needs the device token or Twilio credentials.

## Read the code in this order

### 1. `src/types.ts`: the shape of our data

An `interface` is a checklist for an object. `Device` says every device has a
name, status, last-motion timestamp, and so on. A union such as
`'ok' | 'offline'` limits a value to known strings. `string | null` means the
server can explicitly say there is no value. These types mirror `contract/api.md`.

`DeviceDetail extends Device` means the detail page gets all the summary
fields **plus** events, alert history, and a baseline.

### 2. `src/api.ts`: the only door to the server

Each public function represents one endpoint. For example:

```ts
await api.updateDevice("fridge-1", { name: "Kitchen fridge" });
```

`await` pauses that function until the request finishes; it does not freeze
the page. The shared `request()` helper serializes JSON, handles HTTP errors,
sets a 10-second timeout, and accepts empty 204 responses. Mock mode imports
the mock adapter instead of making a network request. Live failures are shown
as failures; they never silently switch the household to sample data.

### 3. `src/mock.ts`: a tiny pretend server

It clones the checked-in fixtures and keeps them in memory. PATCH changes a
device; adding/removing contacts changes the local list; resolving an alert
updates its history. Cloning returned values prevents pages from accidentally
mutating the mock server. It intentionally does **not** simulate the safety
state machine or send messages. Its seed data is illustrative; the real demo
endpoint uses the Python generator.

### 4. `src/hooks.ts`: refreshing data without races

`usePoll()` is a reusable React hook. `useState` stores data and errors.
`useEffect` starts polling when a page mounts and cleans up when it leaves.
It waits two seconds **after** each request finishes, so slow requests cannot
pile up. A disposed request is prevented from updating the new page.
`refresh()` fetches again after an edit. Failed polls preserve the last data
and display a stale-data warning.

`useTick()` updates once per second for the countdown. The countdown starts
from the API's `seconds_until_alert`, subtracting only real seconds since the
last response. Relative activity labels use `server_now`. This distinction
matters because the demo server clock runs 1440 times faster.

### 5. `src/App.tsx`: the screens and small reusable pieces

- `App`: common header/footer and React Router's URL-to-page map.
- `Overview`: sensor cards, connected count, and new-alert banner.
- `DevicePage`: status, countdown, hourly chart, timeline, and alert history.
- `Settings`: local form state; changes reach the server only when saved.
- `Contacts`: phone validation, contact creation, removal, and a test-text action.
- `Setup`: a QR code for an editable dashboard URL.
- `DemoPage`: fast-clock controls, seeding, jumping time, and confirmed reset.
- `Action`: shared loading, success, and error feedback for mutations.

JSX is the HTML-like syntax returned by components. Curly braces insert
JavaScript values. `.map()` turns an array into cards or rows. `key={id}` gives
React a stable identity for each row. `useCallback` keeps the detail loader
stable between renders so polling only restarts when the device ID changes.

The chart's hour labels use the baseline's household timezone. The demo time
picker explicitly uses the browser's timezone, then converts the selected
time to UTC before submitting it.

### 6. `src/style.css`: presentation

The responsive grids become one column on small screens. Status badges use
text as well as color. Forms have labels, controls have keyboard focus rings,
and feedback uses live status regions. Tailwind is available; most visual
rules use named CSS classes so you can read and modify the design directly.

## The Python routine code

### `compute_baseline`: learn what is usual

1. Validate timezone-aware timestamps, remove duplicates/future events, and
   retain the latest 28 days.
2. Count events by local hour for the chart, including zero-activity days in
   the denominator. The current partial day is excluded from chart averages.
3. For each complete historical hour, measure the largest elapsed inactivity
   seen within that hour. This preserves the quiet overnight pattern.
4. Sort those daily samples and take the 90th percentile, multiplied by 1.5.
   The extra margin avoids treating small routine changes as unusual.
5. Mark learning ready after five complete local days with motion. The first
   and current partial days do not qualify. Unknown hours use a conservative
   fallback; the fixed limit always remains the ceiling during evaluation.

The interface does not take the fixed limit, so learned thresholds cannot be
clamped to that device-specific value here. `evaluate` does that instead.

### `evaluate`: decide whether to suggest a check-in

It calculates minutes since motion and compares them with the smaller of
the current hour's learned threshold and the fixed limit. Before learning
is ready, only the fixed limit applies. It returns a `Verdict`, with no network
or database effects. Example: a 150-minute learned threshold and a 720-minute
fixed limit produce a learned alert after 150 minutes without movement.

No last motion means no inactivity verdict yet. Person A must separately
handle devices that have never reported and devices that are offline.
Equality triggers the verdict, matching the countdown deadline.

### `next_alert_time`: keep the countdown honest

The threshold can change when the local hour changes. A device may be normal
at 8:59 but unusual at 9:00. This function searches forward to find the first
crossing, not just `last_motion + this_hour_threshold`. It walks in UTC to
handle daylight-saving transitions. Person A converts that server-clock
deadline to real countdown seconds using the demo scale.

### `synthetic.generate_week`: create repeatable history

Each object type has a daily schedule. A private seeded random generator adds
small timing differences. A fixed seed returns identical data for repeatable
demos. Events are placed in local time, returned in UTC, sorted, and bounded
by the requested date window. There is no database access.

## Python checks and handoff notes

A local test environment was created in `frontend/.venv` so Person A's
dependency file stays untouched. From the repo root:

```powershell
cd backend
../frontend/.venv/Scripts/python.exe -m pytest tests/test_routine.py -q
```

For a fresh machine, create that environment with `python -m venv frontend/.venv`
from the root, then install `pytest tzdata` with its Python's `-m pip install`.
The routine implementation uses the standard library, but Windows typically
needs the `tzdata` package to supply the IANA timezone database. It is now included
in Person A's `backend/requirements.txt`.

Tests cover normal mornings, missed breakfast, overnight gaps, readiness,
duplicate/future events, deterministic synthetic history, a threshold drop at
the next hour, the fixed ceiling, naive timestamp rejection, and DST.

The manifest supplies standalone display and a vector icon. Native installation
behavior depends on the browser; there is no offline cache of household data.
Live backend, hardware, SMS, deployed deep links, and phone testing still need
the team's integration checkpoints. This is a heuristic demo baseline, not a
validated wellbeing predictor.
