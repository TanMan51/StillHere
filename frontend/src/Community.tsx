import { useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { api } from "./api";
import { usePoll } from "./hooks";
import type {
  Alert,
  Community,
  CommunityResponse,
  ResponseTimes,
  Unit,
  Place,
  UnitState,
  Weather,
} from "./types";

// Every state pairs its color with an icon and a word, so the grid never relies on color alone.
export const STATES: Record<UnitState, { icon: string; label: string; meaning: string }> = {
  fine: { icon: "✓", label: "Fine", meaning: "Moved recently" },
  watch: { icon: "◔", label: "Watch", meaning: "Keep an eye on" },
  worry: { icon: "!", label: "Check on", meaning: "Visit or call" },
  offline: { icon: "⏻", label: "Offline", meaning: "No heartbeat: check the sensor" },
  urgent: { icon: "⚠", label: "Urgent", meaning: "Help requested or no reply" },
};
const ORDER: UnitState[] = ["urgent", "worry", "watch", "offline", "fine"];
const EVENT_LABELS: Record<string, string> = {
  motion: "Movement",
  loud: "Loud sound",
  fall: "Possible fall",
  reply: "Reply",
  heartbeat: "Heartbeat",
};
// Demo speed for judges: one hour of resident time passes every real second.
const DEMO_SCALE = 3600;
export const LOWER_ACTIVITY = "Activity lower than usual";

/** "3h 12m", "45m", or "2d 4h" for long gaps. */
export function elapsed(minutes: number | null): string {
  if (minutes === null) return "No movement yet";
  const total = Math.max(0, Math.round(minutes));
  if (total < 60) return `${total}m`;
  const hours = Math.floor(total / 60);
  if (hours < 48) return `${hours}h ${total % 60}m`;
  return `${Math.floor(hours / 24)}d ${hours % 24}h`;
}
/** Response times: "45s", "4m 15s", or "1h 5m". */
export function duration(seconds: number | null): string {
  if (seconds === null) return "—";
  const total = Math.max(0, Math.round(seconds));
  if (total < 60) return `${total}s`;
  if (total < 3600) return `${Math.floor(total / 60)}m ${total % 60}s`;
  return elapsed(total / 60);
}
function since(ts: string, serverNow: string) {
  return elapsed((Date.parse(serverNow) - Date.parse(ts)) / 60000);
}
export function eventText(unit: Unit, serverNow: string) {
  const event = unit.last_event;
  if (!event) return "None recorded";
  const label =
    event.value === "check_in"
      ? "Marked okay"
      : event.type === "reply" && event.value
        ? `Reply: ${event.value.replaceAll("_", " ")}`
        : (EVENT_LABELS[event.type] ?? event.type);
  return `${label}, ${since(event.ts, serverNow)} ago`;
}
export function StateChip({ state }: { state: UnitState }) {
  return (
    <span className={`state-chip state-${state}`}>
      <span aria-hidden="true">{STATES[state].icon}</span> {STATES[state].label}
    </span>
  );
}

/** "They're okay": after a visit or call, restart the resident's countdown. */
export function MarkOkay({
  residentId,
  name,
  onDone,
  compact = false,
}: {
  residentId: string;
  name: string;
  onDone: () => void;
  compact?: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function mark() {
    setBusy(true);
    setError("");
    try {
      await api.markOkay(residentId);
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not mark okay");
    } finally {
      setBusy(false);
    }
  }
  return (
    <span className="mark-okay">
      <button className={compact ? "secondary" : ""} disabled={busy} onClick={mark}>
        <span aria-hidden="true">✓</span> {compact ? "Okay" : `Mark ${name} as okay`}
      </button>
      {error && <small role="alert">{error}</small>}
    </span>
  );
}

/** Staff: "I'm on it" then "Resident okay". Family: mark the alert handled. */
export function AlertActions({
  alert,
  staff,
  onDone,
}: {
  alert: Alert;
  staff: boolean;
  onDone: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function act(run: () => Promise<unknown>) {
    setBusy(true);
    setError("");
    try {
      await run();
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not update the alert");
    } finally {
      setBusy(false);
    }
  }
  if (alert.resolved_at) return null;
  return (
    <div className="alert-actions">
      {staff && !alert.acknowledged_at && (
        <button disabled={busy} onClick={() => act(() => api.acknowledge(alert.id))}>
          I’m on it
        </button>
      )}
      <button
        className={staff && !alert.acknowledged_at ? "secondary" : ""}
        disabled={busy}
        onClick={() => act(() => api.resolve(alert.id))}
      >
        {staff ? "Resident okay" : "Mark handled"}
      </button>
      {alert.acknowledged_by && (
        <small>
          {alert.acknowledged_by} is on it
          {alert.escalation_level > 0 && ` · escalated ${alert.escalation_level}×`}
        </small>
      )}
      {!alert.acknowledged_by && alert.escalation_level > 0 && (
        <small>Not yet acknowledged · escalated {alert.escalation_level}×</small>
      )}
      {error && <small role="alert">{error}</small>}
    </div>
  );
}

function Cell({ unit, serverNow }: { unit: Unit; serverNow: string }) {
  const state = STATES[unit.state];
  const summary =
    `Apartment ${unit.unit}, ${unit.first_name} ${unit.last_name}: ${state.label}. ` +
    `No movement for ${elapsed(unit.minutes_since_motion)}.` +
    (unit.activity_lower_than_usual ? ` ${LOWER_ACTIVITY}.` : "");
  return (
    <Link
      className={`unit state-${unit.state}`}
      to={`/residents/${unit.resident_id}`}
      aria-label={summary}
    >
      <span className="unit-number">
        {unit.unit}
        {unit.activity_lower_than_usual && (
          <span className="unit-trend" aria-hidden="true" title={LOWER_ACTIVITY}>
            ↘
          </span>
        )}
      </span>
      <span className="unit-name">{unit.first_name}</span>
      <span className="unit-elapsed">{elapsed(unit.minutes_since_motion)}</span>
      <span className="unit-state">
        <span aria-hidden="true">{state.icon}</span> {state.label}
      </span>
      <span className="unit-tooltip" role="tooltip">
        <strong>
          {unit.first_name} {unit.last_name}
        </strong>
        <span>Apartment {unit.unit}</span>
        <span>
          {unit.minutes_since_motion === null
            ? "No movement recorded"
            : `No movement for ${elapsed(unit.minutes_since_motion)}`}
        </span>
        <span>Last event: {eventText(unit, serverNow)}</span>
        <span>
          Device: {unit.online ? "Online" : "Offline"}
          {unit.device_status && unit.device_status !== "ok"
            ? ` · ${unit.device_status.replaceAll("_", " ")}`
            : ""}
        </span>
        {unit.activity_lower_than_usual && (
          <span>↘ {LOWER_ACTIVITY}: suggest a wellness visit</span>
        )}
        {unit.active_alert && <span className="unit-alert">{unit.active_alert.message}</span>}
      </span>
    </Link>
  );
}

function DemoControls({ onChange }: { onChange: () => void }) {
  const [error, setError] = useState("");
  const { data, refresh } = usePoll(api.demo);
  const enabled = !!data && data.enabled && data.time_scale === DEMO_SCALE;
  async function toggle() {
    setError("");
    try {
      await api.setDemo(enabled ? { enabled: false } : { enabled: true, time_scale: DEMO_SCALE });
      refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not change the demo clock");
    }
  }
  async function reset() {
    setError("");
    try {
      await api.reset();
      onChange();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not reset the demo");
    }
  }
  return (
    <div className="demo-speed">
      <div className="demo-buttons">
        <button className={enabled ? "" : "secondary"} aria-pressed={enabled} onClick={toggle}>
          {enabled ? "Demo speed on: 1 hour per second" : "Demo speed: 1 hour per second"}
        </button>
        <button
          className="secondary"
          onClick={reset}
          title="Restores the starting mix of apartment states and clears demo alerts and activity"
        >
          Reset apartments
        </button>
      </div>
      {error && <small role="alert">{error}</small>}
    </div>
  );
}

export function ResponseStats({ stats, label }: { stats: ResponseTimes; label: string }) {
  return (
    <dl className="response-stats" aria-label={label}>
      <div>
        <dt>Average time to “I’m on it”</dt>
        <dd>{duration(stats.average_acknowledge_seconds)}</dd>
      </div>
      <div>
        <dt>Average time to resolved</dt>
        <dd>{duration(stats.average_resolve_seconds)}</dd>
      </div>
      <div>
        <dt>Alerts, last 30 days</dt>
        <dd>
          {stats.alerts}
          <small> · {stats.acknowledged} answered by staff</small>
        </dd>
      </div>
    </dl>
  );
}

function OpenAlerts({ data, onDone }: { data: CommunityResponse; onDone: () => void }) {
  const open = data.units
    .filter((u) => u.active_alert)
    .sort((a, b) => Number(b.state === "urgent") - Number(a.state === "urgent"));
  return (
    <section className="panel staff-panel" aria-labelledby="open-alerts">
      <h2 id="open-alerts">Open alerts</h2>
      {!open.length && <p className="muted">No open alerts.</p>}
      <ul className="staff-list">
        {open.map((u) => (
          <li key={u.resident_id}>
            <div className="staff-row">
              <StateChip state={u.state} />
              <Link to={`/residents/${u.resident_id}`}>
                Apt {u.unit} · {u.first_name} {u.last_name}
              </Link>
              <small>{u.active_alert && since(u.active_alert.sent_at, data.server_now)} ago</small>
            </div>
            <p>{u.active_alert?.message}</p>
            {u.active_alert && <AlertActions alert={u.active_alert} staff onDone={onDone} />}
          </li>
        ))}
      </ul>
    </section>
  );
}

const KIND_LABEL = { heat: "Heat", cold: "Cold" } as const;
/** "2 hours" for whole hours, otherwise "1h 30m". */
function hoursText(minutes: number) {
  if (minutes % 60) return elapsed(minutes);
  return minutes === 60 ? "1 hour" : `${minutes / 60} hours`;
}

function WeatherBanner({ weather }: { weather: Weather }) {
  const until = weather.ends_at
    ? new Date(weather.ends_at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })
    : null;
  return (
    <section className={`weather-banner weather-${weather.kind}`} role="status">
      <span className="weather-icon" aria-hidden="true">
        {weather.kind === "heat" ? "☀" : "❄"}
      </span>
      <div>
        <strong>
          {weather.event} in effect{until ? ` until ${until}` : ""}
          {weather.source === "simulated" ? " (simulated for this demo)" : ""}
        </strong>
        <p>
          Older adults living alone are most at risk in extreme {weather.kind}. Apartments now turn
          yellow after {hoursText(weather.watch_after_minutes)} and red after{" "}
          {hoursText(weather.worry_after_minutes)} without movement, the check-in list shows
          everyone quiet that long, and families of quiet residents get one text.
        </p>
        {weather.source === "nws" && <small>Source: National Weather Service</small>}
      </div>
    </section>
  );
}

function LocationPicker({ onPicked, onCancel }: { onPicked: () => void; onCancel: () => void }) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Place[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  async function run(task: () => Promise<void>) {
    setBusy(true);
    setMessage("");
    try {
      await task();
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  }
  const search = (e: FormEvent) => {
    e.preventDefault();
    void run(async () => {
      const found = await api.places(query.trim());
      setResults(found);
      if (!found.length) setMessage("No US city or town by that name. Try adding the state.");
    });
  };
  const choose = (place: Place) =>
    run(async () => {
      await api.updateCommunity({
        latitude: place.latitude,
        longitude: place.longitude,
        location_name: place.name,
      });
      onPicked();
    });
  const useMyLocation = () =>
    run(async () => {
      const position = await new Promise<GeolocationPosition>((resolve, reject) => {
        if (!navigator.geolocation) reject(new Error("This browser can’t share its location."));
        else
          navigator.geolocation.getCurrentPosition(resolve, () =>
            reject(new Error("Location access was blocked. Type a city or town instead.")),
          );
      });
      await api.updateCommunity({
        latitude: Math.round(position.coords.latitude * 10000) / 10000,
        longitude: Math.round(position.coords.longitude * 10000) / 10000,
      });
      onPicked();
    });
  return (
    <div className="location-picker">
      <form onSubmit={search} className="location-search">
        <label>
          City or town
          <input
            value={query}
            placeholder="e.g. Decatur"
            minLength={2}
            required
            onChange={(e) => setQuery(e.target.value)}
          />
        </label>
        <button type="submit" disabled={busy}>
          Search
        </button>
      </form>
      {results && results.length > 0 && (
        <ul className="place-results" aria-label="Matching places">
          {results.map((place) => (
            <li key={`${place.latitude},${place.longitude}`}>
              <button className="secondary" disabled={busy} onClick={() => choose(place)}>
                {place.name}
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="demo-buttons">
        <button className="secondary" disabled={busy} onClick={useMyLocation}>
          Use my current location
        </button>
        <button className="secondary" disabled={busy} onClick={onCancel}>
          Cancel
        </button>
      </div>
      {message && <small role="status">{message}</small>}
      <small className="muted">
        US locations only: advisories come from the National Weather Service.
      </small>
    </div>
  );
}

function WeatherPanel({ data, onChange }: { data: CommunityResponse; onChange: () => void }) {
  const [picking, setPicking] = useState(false);
  const [error, setError] = useState("");
  const { weather, conditions, community } = data;
  async function simulate(kind: Weather["kind"] | null) {
    setError("");
    try {
      await api.simulateWeather(kind);
      onChange();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not change the weather");
    }
  }
  const real = weather?.source === "nws";
  return (
    <section className="panel weather-panel" aria-labelledby="weather-title">
      <div className="weather-summary">
        <div>
          <h2 id="weather-title">Weather · {community.location_name ?? "No location set"}</h2>
          <p>
            {conditions?.temperature_f != null
              ? `${Math.round(conditions.temperature_f)}°F` +
                (conditions.feels_like_f != null
                  ? `, feels like ${Math.round(conditions.feels_like_f)}°F`
                  : "") +
                (conditions.description ? ` · ${conditions.description}` : "")
              : "Current conditions not available yet."}
          </p>
          <p className="muted">
            {weather
              ? `${weather.event} in effect${weather.source === "simulated" ? " (simulated)" : ""}.`
              : "No heat or cold advisories right now."}
          </p>
        </div>
        {!picking && (
          <button className="secondary" onClick={() => setPicking(true)}>
            Change location
          </button>
        )}
      </div>
      {picking && (
        <LocationPicker
          onPicked={() => {
            setPicking(false);
            onChange();
          }}
          onCancel={() => setPicking(false)}
        />
      )}
      <div className="demo-buttons weather-simulate">
        {weather?.source === "simulated" ? (
          <button onClick={() => simulate(null)}>End simulated advisory</button>
        ) : (
          <>
            <button className="secondary" disabled={real} onClick={() => simulate("heat")}>
              ☀ Simulate heat advisory
            </button>
            <button className="secondary" disabled={real} onClick={() => simulate("cold")}>
              ❄ Simulate cold advisory
            </button>
          </>
        )}
        {real && <small>A real advisory is in effect, so simulation is off.</small>}
        {error && <small role="alert">{error}</small>}
      </div>
    </section>
  );
}

function clockTime(hhmm: string) {
  const [hours, minutes] = hhmm.split(":").map(Number);
  const suffix = hours < 12 ? "AM" : "PM";
  return `${hours % 12 || 12}:${String(minutes).padStart(2, "0")} ${suffix}`;
}

function Checkin({ data, onDone }: { data: CommunityResponse; onDone: () => void }) {
  const byId = new Map(data.units.map((u) => [u.resident_id, u]));
  const quiet = data.checkin.resident_ids.flatMap((id) => byId.get(id) ?? []);
  const weather = data.checkin.reason === "weather" ? data.weather : null;
  const span = weather
    ? `No movement in the last ${hoursText(weather.watch_after_minutes)}`
    : `No movement since ${clockTime(data.checkin.time)}`;
  return (
    <section className="panel staff-panel" aria-labelledby="morning-checkin">
      <h2 id="morning-checkin">
        {weather ? `${KIND_LABEL[weather.kind]} check-in` : "Morning check-in"}
      </h2>
      <p className="muted">
        {span}, longest first. Call or visit these residents, then tap ✓ Okay once they’re fine.
      </p>
      {!quiet.length && <p>Nobody is on the list right now.</p>}
      <ol className="staff-list checkin-list">
        {quiet.map((u) => (
          <li key={u.resident_id} className="staff-row">
            <StateChip state={u.state} />
            <Link to={`/residents/${u.resident_id}`}>
              Apt {u.unit} · {u.first_name} {u.last_name}
            </Link>
            <span className="numeric">{elapsed(u.minutes_since_motion)}</span>
            <MarkOkay residentId={u.resident_id} name={u.first_name} onDone={onDone} compact />
          </li>
        ))}
      </ol>
    </section>
  );
}

function CommunitySettings({ community, onSaved }: { community: Community; onSaved: () => void }) {
  const [watch, setWatch] = useState(String(community.watch_after_minutes / 60));
  const [worry, setWorry] = useState(String(community.worry_after_minutes / 60));
  const [onCall, setOnCall] = useState(community.on_call_phone ?? "");
  const [escalate, setEscalate] = useState(String(community.escalate_after_minutes));
  // The check-in time is stored as 24-hour "HH:MM" but edited as a 12-hour clock.
  const [savedHour, savedMinute] = community.checkin_time.split(":").map(Number);
  const [checkinHour, setCheckinHour] = useState(String(savedHour % 12 || 12));
  const [checkinMinute, setCheckinMinute] = useState(String(savedMinute).padStart(2, "0"));
  const [meridiem, setMeridiem] = useState(savedHour < 12 ? "AM" : "PM");
  const [message, setMessage] = useState("");
  async function save() {
    setMessage("");
    const hour = Number(checkinHour);
    const minute = Number(checkinMinute);
    if (!Number.isInteger(hour) || hour < 1 || hour > 12) {
      setMessage("Enter a check-in hour from 1 to 12.");
      return;
    }
    if (!Number.isInteger(minute) || minute < 0 || minute > 59) {
      setMessage("Enter check-in minutes from 0 to 59.");
      return;
    }
    const hour24 = (hour % 12) + (meridiem === "PM" ? 12 : 0);
    const checkin = `${String(hour24).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
    const watchMinutes = Math.round(Number(watch) * 60);
    const worryMinutes = Math.round(Number(worry) * 60);
    if (!(watchMinutes > 0 && worryMinutes > watchMinutes)) {
      setMessage("Yellow must start before red, and both after 0 hours.");
      return;
    }
    if (onCall.trim() && !/^\+[1-9]\d{6,14}$/.test(onCall.trim())) {
      setMessage("Enter the on-call phone in international format, like +14045550123.");
      return;
    }
    try {
      await api.updateCommunity({
        watch_after_minutes: watchMinutes,
        worry_after_minutes: worryMinutes,
        on_call_phone: onCall.trim(),
        escalate_after_minutes: Number(escalate),
        checkin_time: checkin,
      });
      setMessage("Saved");
      onSaved();
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Could not save");
    }
  }
  return (
    <section className="panel thresholds">
      <h2>Community settings</h2>
      <div className="settings-groups">
        <fieldset>
          <legend>Grid colors: hours without movement</legend>
          <div className="threshold-fields">
            <label>
              <span>
                <span className="swatch state-watch" aria-hidden="true" /> Yellow after
              </span>
              <input
                type="number"
                inputMode="decimal"
                min={0.1}
                step={0.5}
                value={watch}
                onChange={(e) => setWatch(e.target.value)}
              />
              hours
            </label>
            <label>
              <span>
                <span className="swatch state-worry" aria-hidden="true" /> Red after
              </span>
              <input
                type="number"
                inputMode="decimal"
                min={0.1}
                step={0.5}
                value={worry}
                onChange={(e) => setWorry(e.target.value)}
              />
              hours
            </label>
          </div>
        </fieldset>
        <fieldset>
          <legend>Urgent alerts</legend>
          <div className="threshold-fields">
            <label>
              <span>On-call phone</span>
              <input
                className="wide-input"
                type="tel"
                placeholder="+14045550123"
                value={onCall}
                onChange={(e) => setOnCall(e.target.value)}
              />
            </label>
            <label>
              <span>Escalate after</span>
              <input
                type="number"
                inputMode="numeric"
                min={1}
                max={240}
                value={escalate}
                onChange={(e) => setEscalate(e.target.value)}
              />
              minutes
            </label>
          </div>
          <p className="muted">
            Urgent alerts text the on-call phone first. If nobody taps “I’m on it” in time, they
            escalate to the resident’s family, then to the on-call phone again.
          </p>
        </fieldset>
        <fieldset>
          <legend>Morning check-in</legend>
          {/* Written like a clock: [10] : [00] [AM]. */}
          <fieldset className="duration clock-time">
            <legend>List residents with no movement since</legend>
            <input
              type="text"
              inputMode="numeric"
              maxLength={2}
              aria-label="Check-in hour"
              value={checkinHour}
              onChange={(e) => setCheckinHour(e.target.value.replace(/\D/g, ""))}
            />
            <span className="clock-colon" aria-hidden="true">
              :
            </span>
            <input
              type="text"
              inputMode="numeric"
              maxLength={2}
              aria-label="Check-in minutes"
              value={checkinMinute}
              onChange={(e) => setCheckinMinute(e.target.value.replace(/\D/g, ""))}
              onBlur={() => checkinMinute && setCheckinMinute(checkinMinute.padStart(2, "0"))}
            />
            <select
              className="meridiem"
              aria-label="AM or PM"
              value={meridiem}
              onChange={(e) => setMeridiem(e.target.value)}
            >
              <option>AM</option>
              <option>PM</option>
            </select>
          </fieldset>
        </fieldset>
      </div>
      <div className="settings-save">
        <button onClick={save}>Save settings</button>
        {message && <small role="status">{message}</small>}
      </div>
    </section>
  );
}

export default function CommunityPage() {
  const { data, error, refresh } = usePoll(api.community);
  const floors = [...new Set(data?.units.map((u) => u.floor ?? 0))].sort((a, b) => b - a);
  const counts = ORDER.map((state) => ({
    state,
    count: data?.units.filter((u) => u.state === state).length ?? 0,
  }));
  return (
    <>
      <header className="page-heading">
        <div>
          <p className="eyebrow">01 / COMMUNITY</p>
          <h1>{data?.community.name ?? "Community"}</h1>
        </div>
        <span className="live">
          <i /> Updates every 2 seconds
        </span>
      </header>
      {error && (
        <p className="error" role="alert">
          {error} · Displayed data may be out of date.
        </p>
      )}
      {data?.weather && <WeatherBanner weather={data.weather} />}
      {data && <WeatherPanel data={data} onChange={refresh} />}
      {data && <ResponseStats stats={data.response_times} label="Staff response times" />}
      <div className="grid-toolbar">
        <ul className="grid-legend" aria-label="Apartment states">
          {counts.map(({ state, count }) => (
            <li key={state} className={`legend-${state}`}>
              <span className={`swatch state-${state}`} aria-hidden="true">
                {STATES[state].icon}
              </span>
              <span>
                <strong>
                  {STATES[state].label} · {count}
                </strong>
                <small>{STATES[state].meaning}</small>
              </span>
            </li>
          ))}
          <li>
            <span className="swatch swatch-trend" aria-hidden="true">
              ↘
            </span>
            <span>
              <strong>Lower activity</strong>
              <small>Suggest a wellness visit</small>
            </span>
          </li>
        </ul>
        <DemoControls onChange={refresh} />
      </div>
      <section className="housing-grid" aria-label="Apartments by floor">
        {data &&
          floors.map((floor) => (
            <div className="floor" key={floor}>
              <h2 className="floor-label">Floor {floor}</h2>
              <div className="floor-units">
                {data.units
                  .filter((u) => (u.floor ?? 0) === floor)
                  .map((u) => (
                    <Cell key={u.resident_id} unit={u} serverNow={data.server_now} />
                  ))}
              </div>
            </div>
          ))}
      </section>
      {data && (
        <div className="staff-panels">
          <OpenAlerts data={data} onDone={refresh} />
          <Checkin data={data} onDone={refresh} />
        </div>
      )}
      {data && (
        <CommunitySettings key={data.community.id} community={data.community} onSaved={refresh} />
      )}
      <div className="footnote">
        <p>
          <small>
            Colors show time since movement, a signal to check in, not a measure of anyone’s health.
          </small>
        </p>
      </div>
    </>
  );
}

type Sort = "unit" | "inactive";

/** The provider's overview: every resident in apartment order, from the same data as the grid. */
export function ResidentTable() {
  const { data, error } = usePoll(api.community);
  const [sort, setSort] = useState<Sort>("unit");
  const units = [...(data?.units ?? [])];
  if (sort === "inactive")
    units.sort(
      (a, b) => (b.minutes_since_motion ?? Infinity) - (a.minutes_since_motion ?? Infinity),
    );
  return (
    <>
      <header className="page-heading">
        <div>
          <p className="eyebrow">02 / RESIDENTS</p>
          <h1>All residents</h1>
        </div>
        <span className="live">
          <i /> Updates every 2 seconds
        </span>
      </header>
      {error && (
        <p className="error" role="alert">
          {error} · Displayed data may be out of date.
        </p>
      )}
      <div className="section-heading">
        <h2>{data?.community.name ?? "Community"}</h2>
        <div className="sort-toggle" role="group" aria-label="Sort residents">
          {(
            [
              ["unit", "By apartment"],
              ["inactive", "Longest without movement"],
            ] as const
          ).map(([value, label]) => (
            <button
              key={value}
              className={sort === value ? "" : "secondary"}
              aria-pressed={sort === value}
              onClick={() => setSort(value)}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
      <div className="panel resident-table-wrap">
        <table className="resident-table">
          <thead>
            <tr>
              <th scope="col">Apt</th>
              <th scope="col">Resident</th>
              <th scope="col">Status</th>
              <th scope="col">No movement for</th>
              <th scope="col">Last event</th>
              <th scope="col">Sensor</th>
              <th scope="col">Trend</th>
              <th scope="col">Alert</th>
            </tr>
          </thead>
          <tbody>
            {data &&
              units.map((u) => (
                <tr key={u.resident_id}>
                  <td className="numeric">{u.unit}</td>
                  <th scope="row">
                    <Link to={`/residents/${u.resident_id}`}>
                      {u.first_name} {u.last_name}
                    </Link>
                  </th>
                  <td>
                    <StateChip state={u.state} />
                  </td>
                  <td className="numeric">{elapsed(u.minutes_since_motion)}</td>
                  <td>{eventText(u, data.server_now)}</td>
                  <td>{u.online ? "Online" : "Offline"}</td>
                  <td>{u.activity_lower_than_usual ? "↘ Lower than usual" : "Usual"}</td>
                  <td className="alert-cell">{u.active_alert?.message ?? "None"}</td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>
      <div className="footnote">
        <p>
          <small>
            Status uses the same thresholds as the community grid. Time since movement is a signal
            to check in, not a measure of anyone’s health.
          </small>
        </p>
      </div>
    </>
  );
}
