import { useState } from "react";
import { Link } from "react-router-dom";
import { api } from "./api";
import { usePoll } from "./hooks";
import type { Community, Unit, UnitState } from "./types";

// Every state pairs its color with an icon and a word, so the grid never relies on color alone.
const STATES: Record<UnitState, { icon: string; label: string; meaning: string }> = {
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

/** "3h 12m", "45m", or "2d 4h" for long gaps. */
export function elapsed(minutes: number | null): string {
  if (minutes === null) return "No movement yet";
  const total = Math.max(0, Math.round(minutes));
  if (total < 60) return `${total}m`;
  const hours = Math.floor(total / 60);
  if (hours < 48) return `${hours}h ${total % 60}m`;
  return `${Math.floor(hours / 24)}d ${hours % 24}h`;
}
function since(ts: string, serverNow: string) {
  return elapsed((Date.parse(serverNow) - Date.parse(ts)) / 60000);
}
function eventText(unit: Unit, serverNow: string) {
  const event = unit.last_event;
  if (!event) return "None recorded";
  const label =
    event.type === "reply" && event.value
      ? `Reply: ${event.value.replaceAll("_", " ")}`
      : (EVENT_LABELS[event.type] ?? event.type);
  return `${label}, ${since(event.ts, serverNow)} ago`;
}

function Cell({ unit, serverNow }: { unit: Unit; serverNow: string }) {
  const state = STATES[unit.state];
  const summary =
    `Apartment ${unit.unit}, ${unit.first_name} ${unit.last_name}: ${state.label}. ` +
    `No movement for ${elapsed(unit.minutes_since_motion)}.`;
  const body = (
    <>
      <span className="unit-number">{unit.unit}</span>
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
        <span>No movement for {elapsed(unit.minutes_since_motion)}</span>
        <span>Last event: {eventText(unit, serverNow)}</span>
        <span>
          Device: {unit.online ? "Online" : "Offline"}
          {unit.device_status && unit.device_status !== "ok"
            ? ` · ${unit.device_status.replaceAll("_", " ")}`
            : ""}
        </span>
        {unit.active_alert && <span className="unit-alert">{unit.active_alert.message}</span>}
      </span>
    </>
  );
  const className = `unit state-${unit.state}`;
  return unit.device_id ? (
    <Link className={className} to={`/devices/${unit.device_id}`} aria-label={summary}>
      {body}
    </Link>
  ) : (
    <div className={className} aria-label={summary}>
      {body}
    </div>
  );
}

function DemoControls({ onReset }: { onReset: () => void }) {
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
      onReset();
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

function Thresholds({ community, onSaved }: { community: Community; onSaved: () => void }) {
  const [watch, setWatch] = useState(String(community.watch_after_minutes / 60));
  const [worry, setWorry] = useState(String(community.worry_after_minutes / 60));
  const [message, setMessage] = useState("");
  async function save() {
    setMessage("");
    const watchMinutes = Math.round(Number(watch) * 60);
    const worryMinutes = Math.round(Number(worry) * 60);
    if (!(watchMinutes > 0 && worryMinutes > watchMinutes)) {
      setMessage("Yellow must start before red, and both after 0 hours.");
      return;
    }
    try {
      await api.updateCommunity({
        watch_after_minutes: watchMinutes,
        worry_after_minutes: worryMinutes,
      });
      setMessage("Saved");
      onSaved();
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Could not save");
    }
  }
  return (
    <section className="panel thresholds">
      <h2>Color thresholds</h2>
      <p className="muted">Hours without movement before an apartment changes color.</p>
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
        <button onClick={save}>Save thresholds</button>
      </div>
      {message && <small role="status">{message}</small>}
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
        </ul>
        <DemoControls onReset={refresh} />
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
      {data && <Thresholds key={data.community.id} community={data.community} onSaved={refresh} />}
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
