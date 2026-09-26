# Agent guidelines for StillHere

Rules for AI coding agents (Claude Code, Codex) and humans working in this repo. StillHere is a
HackGT 13 project: sensors on everyday objects report activity, and the server texts family
contacts when a routine breaks. Read `contract/api.md` before changing anything that crosses the
backend/frontend line.

## Stack

- **Backend:** Python 3.11+, FastAPI, SQLModel on SQLite, APScheduler (check loop inside the
  FastAPI process), Twilio for SMS. Pinned in `backend/requirements.txt`.
- **Frontend:** React, Vite, TypeScript, Tailwind, React Router, Recharts. Polls the API every
  2 seconds; no WebSockets. The build is served by FastAPI so everything lives at one URL.
- **Firmware:** CircuitPython on a Circuit Playground Express, bridged over UART to a Pico W.

Do not add a new framework, database, or state library. Prefer the standard library and what is
already installed.

## Ownership (stay in your lane)

Work is split by folder so two people never edit the same file. Only change files owned by the
person you are working for. If a task needs a change in someone else's file, stop and say what
change is needed instead of making it.

| Path                                                                                               | Owner                             |
| -------------------------------------------------------------------------------------------------- | --------------------------------- |
| `contract/`                                                                                        | Shared, additive-only (see below) |
| `backend/` (everything except `routine/`), `requirements.txt`, `.env.example`, `tests/test_api.py` | Person A (backend, infra)         |
| `backend/app/routine/`, `backend/tests/test_routine.py`                                            | Person B                          |
| `frontend/` (including `package.json` and the lockfile)                                            | Person B (dashboard)              |
| `firmware/`                                                                                        | Hardware person                   |

- Only Person A edits `requirements.txt` and `.env.example`. `routine/` uses only the standard
  library, so it never needs a new dependency.
- Only Person B edits `package.json` and the lockfile.
- Don't reorganize folders, rename files, or remove imports from `main.py`. Restructuring is the
  main source of merge conflicts.

## The API contract

- `contract/api.md` and `contract/fixtures/` are the single source of truth for every endpoint
  and response shape. Code must match them exactly.
- Changes are **additive only**: add a field or an endpoint; never rename, remove, or change the
  type of anything. Put each change in its own small commit titled `contract: add X`, and add a
  line to the changelog at the bottom of `api.md`. Update the matching fixture in the same commit.
- JSON keys are `snake_case`. Timestamps are ISO 8601 UTC with a `Z`. Nullable fields are always
  present as `null`, never omitted. Errors use FastAPI's `{"detail": "..."}`.
- The backend computes `status`, `next_alert_at`, and `routine_note`. The frontend only displays
  them and never reimplements alert logic or demo time scaling.

## Time and the demo clock

- In backend code, **always get the time from `clock.now()`** (`backend/app/clock.py`). Never call
  `datetime.now()`, `datetime.utcnow()`, or `time.time()` directly. Use `clock.real_now()` only
  for what the contract keeps in real time: offline detection, the 30-second reply window, and
  `seconds_until_alert`.
- Demo speed comes from one setting, `DEMO_TIME_SCALE` in `config.py` (1440 means 12 hours pass in
  30 seconds). Convert spans with the helpers in `clock.py` (`to_real_seconds`, `time_scale()`).
  Never scatter `if demo:` checks or hard-coded demo durations through the code.
- Datetimes are always timezone-aware UTC (`clock.as_utc`); SQLModel rejects naive ones. Format
  for the API with `clock.iso`. Convert to the household timezone (`HOUSEHOLD_TZ`) only for
  display text and hour-of-day routine buckets.
- `routine/` functions are pure: data in, answer out. They take `now` and the timezone as
  arguments and never read the clock, database, or environment themselves.

## Secrets and config

- Never put secrets in code, commits, tests, fixtures, or logs: Twilio credentials, device
  tokens for real hardware, phone numbers of real people. They go in `backend/.env` (gitignored)
  locally and in the host's environment variables when deployed.
- Every new setting is read in `backend/app/config.py` and documented with a placeholder in
  `backend/.env.example`. Other modules import from `config`, not `os.getenv`.
- Without Twilio credentials, `notify.py` logs texts instead of sending them. Keep that dry-run
  path working.

## Code style

- **Python:** format and lint with ruff (`ruff.toml`: line length 100, rules E, F, I). Type-hint
  function signatures. Keep route handlers thin; put logic in plain functions. All SMS wording
  lives in `messages.py`.
- **Frontend:** format with prettier (`.prettierc`: double quotes, semicolons, width 100,
  trailing commas). TypeScript strict, no `any`. Types in `src/types.ts` mirror the contract;
  every API call goes through `src/api.ts` (which honors `VITE_USE_MOCK`). Status badges use
  color plus text, never color alone.
- Small, focused functions and files. Names say what things are; comments say why, not what.
- No dead code, commented-out blocks, or stray `print`/`console.log` left behind (the checker's
  alert-decision logging is intentional).
- One bad device must never stop the check loop: wrap each device's check in its own
  `try/except` and log the error.

## Before you finish a change

Run these and fix anything they report:

```bash
# Backend (from backend/)
python -m pytest                        # all backend tests
python -m pytest tests/test_routine.py  # routine only, no database or server needed
ruff format . && ruff check --fix .

# Frontend (from frontend/)
npx prettier --write .
npm run build                           # type-checks and builds
```

Add or update tests with behavior changes: API and alert state machine in `test_api.py`, learned
routine in `test_routine.py`. Run the backend locally with `uvicorn app.main:app --reload` from
`backend/`.

## Git

- Short-lived branches named by owner and task (`a/check-loop`, `b/device-page`); merge to
  `main` every few hours. `git pull --rebase` before starting a new task.
- Small commits with a clear subject in the imperative (`add offline alert`), prefixed by area
  when useful (`contract:`, `routine:`, `frontend:`).
- Never commit `.env`, `*.db`, `node_modules/`, `dist/`, or build output.
