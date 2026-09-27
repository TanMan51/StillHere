import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import {
  Link,
  Navigate,
  NavLink,
  Route,
  Routes,
  useLocation,
  useNavigate,
  useParams,
} from "react-router-dom";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { QRCodeSVG } from "qrcode.react";
import { localHour, todayByHour } from "./activity";
import { api, useMock } from "./api";
import { usePoll, useTick } from "./hooks";
import type { Device, MotionSensitivity, Status } from "./types";
import PlacementGuide, { DeviceSetup, SetupPrompt } from "./PlacementGuide";
import { LOGOUT_EVENT, loadSession, saveSession, type Session } from "./session";
import LandingPage from "./LandingPage";
import ModelSwarm from "./ModelSwarm";
import CommunityPage, { ResidentTable } from "./Community";
import ResidentPage, { VisitSummary } from "./Resident";
import { useReveal, useSmoothScroll } from "./motion";

const labels: Record<Status, string> = {
  ok: "Activity looks normal",
  inactive_alert: "Inactivity alert",
  urgent: "Help requested",
  awaiting_reply: "Waiting for a reply",
  offline: "Sensor offline",
  no_reply_alert: "No reply received",
};
const icons = { fridge: "▤", walker: "♧", door: "▥", other: "◈" };
const date = (value: string, timezone?: string) =>
  new Date(value).toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: timezone,
  });
// Rounded for people: 675 minutes reads as "about 11 hours".
function roughDuration(seconds: number) {
  if (seconds < 60) return `${seconds} second${seconds === 1 ? "" : "s"}`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? "" : "s"}`;
  const hours = Math.round(minutes / 60);
  if (hours < 2) return "about an hour";
  if (hours < 36) return `about ${hours} hours`;
  return `about ${Math.round(hours / 24)} days`;
}
function ago(value: string | null, server: string) {
  if (!value) return "No activity recorded";
  const seconds = Math.max(0, Math.floor((Date.parse(server) - Date.parse(value)) / 1000));
  return seconds < 60 ? "Just now" : `${roughDuration(seconds)} ago`;
}
function Badge({ status }: { status: Status }) {
  return (
    <span className={`badge ${status}`}>
      <span aria-hidden="true">●</span> {labels[status]}
    </span>
  );
}
function Countdown({ device, receivedAt }: { device: Device; receivedAt: number }) {
  const now = useTick();
  if (device.seconds_until_alert === null)
    return (
      <span>
        {device.active_alert
          ? "Check-in is active"
          : device.online
            ? "Waiting for activity"
            : "Waiting for connection"}
      </span>
    );
  const seconds = Math.max(
    0,
    device.seconds_until_alert - Math.floor(Math.max(0, now - receivedAt) / 1000),
  );
  return (
    <span>{seconds === 0 ? "Checking activity…" : `Check-in in ${roughDuration(seconds)}`}</span>
  );
}
function Feedback({ error }: { error: string }) {
  return error ? (
    <p className="error" role="alert">
      {error} · Displayed data may be out of date.
    </p>
  ) : null;
}
function Heading({
  eyebrow,
  title,
  children,
}: {
  eyebrow: string;
  title: string;
  children?: ReactNode;
}) {
  return (
    <header className="page-heading">
      <div>
        <p className="eyebrow">{eyebrow}</p>
        <h1>{title}</h1>
      </div>
      {children}
    </header>
  );
}
function Action({
  children,
  run,
  onDone,
  secondary = false,
  doneText = "Done",
}: {
  children: ReactNode;
  run: () => Promise<unknown>;
  onDone?: () => void;
  secondary?: boolean;
  doneText?: string;
}) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  return (
    <span className="action">
      <button
        className={secondary ? "secondary" : ""}
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          setMessage("");
          try {
            await run();
            setMessage(doneText);
            onDone?.();
          } catch (e) {
            setMessage(e instanceof Error ? e.message : "Could not save");
          } finally {
            setBusy(false);
          }
        }}
      >
        {busy ? "Working…" : children}
      </button>
      <small role="status">{message}</small>
    </span>
  );
}
function Overview() {
  const { data, error, receivedAt } = usePoll(api.devices);
  const seen = useRef<Set<number> | null>(null);
  const [notice, setNotice] = useState("");
  useEffect(() => {
    if (!data) return;
    const alerts = data.devices.flatMap((d) => (d.active_alert ? [d.active_alert] : []));
    const fresh = alerts.find((a) => seen.current && !seen.current.has(a.id));
    if (fresh) setNotice(fresh.message);
    seen.current = new Set([...(seen.current ?? []), ...alerts.map((a) => a.id)]);
  }, [data]);
  return (
    <>
      <section className="overview-hero">
        <Heading eyebrow="01 / MONITORING" title="Your products">
          <span className="live">
            <i /> Updates every 2 seconds
          </span>
        </Heading>
        <a className="hero-scroll" href="#devices">
          View your devices <span aria-hidden="true">↓</span>
        </a>
      </section>
      <Feedback error={error} />
      {notice && (
        <div className="notice" role="status">
          {notice}
          <button className="secondary" onClick={() => setNotice("")}>
            Dismiss
          </button>
        </div>
      )}
      <div className="section-heading" id="devices">
        <h2>Devices</h2>
        <span>{data?.devices.length ?? 0} devices</span>
      </div>
      <div className="cards">
        {data?.devices.map((d) => (
          <Link to={`/devices/${d.id}`} className="device-card" key={d.id}>
            <div className="card-top">
              <span className="object-icon">{icons[d.object_type]}</span>
              <span className="arrow">↗</span>
            </div>
            <h2>{d.name}</h2>
            <Badge status={d.status} />
            <div className="activity">
              <span>Last activity</span>
              <strong>{ago(d.last_motion_at, data.server_now)}</strong>
            </div>
            <p className="routine">
              {d.routine_note ??
                (d.online
                  ? "Monitoring activity."
                  : "Check the sensor’s power and Wi-Fi connection.")}
            </p>
            <div className="card-bottom">
              <Countdown device={d} receivedAt={receivedAt} />
            </div>
          </Link>
        ))}
      </div>
      {data && !data.devices.length && <div className="panel">No sensors are configured yet.</div>}
      <SetupPrompt />
      <div className="footnote">
        <p>
          <small>
            Activity is a signal to check in, not a confirmation of someone’s wellbeing.
          </small>
        </p>
      </div>
    </>
  );
}
// Long logs start with the newest few entries; the rest are one click away.
const SHORT_LIST_SIZE = 3;
function ShortList<T>({ items, children }: { items: T[]; children: (item: T) => ReactNode }) {
  const [expanded, setExpanded] = useState(false);
  const shown = expanded ? items : items.slice(0, SHORT_LIST_SIZE);
  const hidden = items.length - SHORT_LIST_SIZE;
  return (
    <>
      {shown.map(children)}
      {hidden > 0 && (
        <button
          className="secondary show-more"
          onClick={() => setExpanded((value) => !value)}
          aria-expanded={expanded}
        >
          {expanded ? "Show less" : `Show ${hidden} more`}
        </button>
      )}
    </>
  );
}
function clockHour(hour: number) {
  return `${hour % 12 || 12} ${hour < 12 ? "AM" : "PM"}`;
}
function DevicePage() {
  const { id = "" } = useParams();
  const load = useCallback(() => api.device(id), [id]);
  const { data, error, receivedAt, refresh } = usePoll(load);
  if (!data)
    return (
      <>
        <Feedback error={error} />
        <p>{error ? "Device unavailable." : "Loading device…"}</p>
      </>
    );
  const d = data.device;
  // Today from 12 AM to 11 PM, each hour beside the typical amount for that hour. The day starts
  // fresh at local midnight; hours after now stay empty.
  const today = todayByHour(d.events, data.server_now, d.baseline.timezone);
  const chartData = today.map((count, hour) => ({
    hour,
    recent: count,
    usual: d.baseline.hourly_activity[hour],
  }));
  const nowHour = localHour(data.server_now, d.baseline.timezone);
  // Until the routine is learned the average is all zeros; hide it so recent bars get the room.
  const hasUsual = d.baseline.hourly_activity.some((count) => count > 0);
  const tick = { fontSize: 11, fill: "#65756d" };
  return (
    <>
      <Link className="back" to="/dashboard">
        ← All devices
      </Link>
      <Heading eyebrow={d.object_type.toUpperCase()} title={d.name}>
        <Badge status={d.status} />
      </Heading>
      <Feedback error={error} />
      <section className="summary">
        <div>
          <h2>{d.routine_note ?? labels[d.status]}</h2>
          <p>
            Last activity: {ago(d.last_motion_at, data.server_now)} ·{" "}
            {d.online ? "Sensor connected" : "Sensor disconnected"}
          </p>
          <p>
            <Countdown device={d} receivedAt={receivedAt} />
          </p>
        </div>
        {d.active_alert && (
          <Action run={() => api.resolve(d.active_alert!.id)} onDone={refresh}>
            I checked in · mark handled
          </Action>
        )}
      </section>
      <div className="detail-grid">
        <section className="panel">
          <h2>Activity today</h2>
          <p className="muted">
            {d.baseline.ready
              ? `Each bar is one hour, starting at 12 AM. Light bars show a typical day (${d.baseline.days_of_data} days observed).`
              : `Each bar is one hour, starting at 12 AM. A typical day appears after 5 days of data (${d.baseline.days_of_data} so far).`}
          </p>
          <div
            className="chart"
            role="img"
            aria-label={`Activity each hour today, in ${d.baseline.timezone}`}
          >
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={chartData}
                barGap={1}
                barCategoryGap="8%"
                margin={{ top: 22, right: 8, bottom: 0, left: 0 }}
              >
                <defs>
                  <linearGradient id="bar-recent" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#2c7a60" />
                    <stop offset="100%" stopColor="#184e42" />
                  </linearGradient>
                  <linearGradient id="bar-usual" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#c2d3b8" />
                    <stop offset="100%" stopColor="#a5b99a" />
                  </linearGradient>
                </defs>
                <CartesianGrid vertical={false} stroke="#e3ebe0" strokeDasharray="3 4" />
                <XAxis
                  dataKey="hour"
                  ticks={[0, 6, 12, 18, 23]}
                  interval={0}
                  tickFormatter={clockHour}
                  axisLine={{ stroke: "#d5dfd5" }}
                  tickLine={false}
                  tick={tick}
                />
                <YAxis
                  allowDecimals={false}
                  width={28}
                  axisLine={false}
                  tickLine={false}
                  tick={tick}
                />
                <Tooltip
                  labelFormatter={(label) =>
                    Number(label) === nowHour
                      ? `${clockHour(nowHour)} hour, so far`
                      : `${clockHour(Number(label))} hour`
                  }
                  contentStyle={{
                    background: "#ffffff",
                    borderColor: "#d5dfd5",
                    borderRadius: 12,
                    color: "#253e36",
                  }}
                  cursor={{ fill: "#253e360a", radius: 6 }}
                />
                <Legend iconType="circle" iconSize={9} wrapperStyle={{ fontSize: 12 }} />
                <ReferenceLine
                  x={nowHour}
                  stroke="#253e36"
                  strokeDasharray="3 3"
                  label={{ value: "Now", position: "top", fontSize: 11, fill: "#253e36" }}
                />
                {hasUsual && (
                  <Bar
                    isAnimationActive={false}
                    dataKey="usual"
                    name="Typical day"
                    fill="url(#bar-usual)"
                    radius={[6, 6, 2, 2]}
                    maxBarSize={22}
                  />
                )}
                <Bar
                  isAnimationActive={false}
                  dataKey="recent"
                  name="Movements"
                  fill="url(#bar-recent)"
                  radius={[6, 6, 2, 2]}
                  maxBarSize={22}
                />
              </BarChart>
            </ResponsiveContainer>
          </div>
          <small>
            Times in {d.baseline.timezone}. The dashed line marks now; later hours fill in as the
            day goes. Bars count movement and loud sounds.
          </small>
        </section>
        <Settings key={d.id} device={d} onDone={refresh} />
      </div>
      <div className="detail-grid logs">
        <section className="panel">
          <h2>Recent activity</h2>
          {!d.events.length && <p>No activity recorded yet.</p>}
          <ShortList items={d.events}>
            {(e) => (
              <div className="timeline" key={e.id}>
                <span className="event-dot" />
                <div>
                  <strong>
                    {e.type === "reply"
                      ? `Reply: ${e.value?.replaceAll("_", " ")}`
                      : e.type === "motion"
                        ? "Movement detected"
                        : `${e.type} detected`}
                  </strong>
                  <p>{date(e.ts, d.baseline.timezone)}</p>
                </div>
              </div>
            )}
          </ShortList>
        </section>
        <section className="panel">
          <h2>Check-in history</h2>
          {!d.alerts.length && <p>No alerts yet.</p>}
          <ShortList items={d.alerts}>
            {(a) => (
              <article className="alert-item" key={a.id}>
                <strong>{a.kind.replaceAll("_", " ")}</strong>
                <p>{a.message}</p>
                <small>
                  {date(a.sent_at, d.baseline.timezone)} · {a.resolved_at ? "Resolved" : "Open"} ·{" "}
                  {a.sms_sent ? "Text sent" : "No text sent"}
                </small>
              </article>
            )}
          </ShortList>
        </section>
      </div>
    </>
  );
}
// The API accepts a fixed check-in limit of 1 minute to 48 hours (contract: 1-2880 minutes).
const MIN_LIMIT = 1;
const MAX_LIMIT = 2880;
const sensitivities: { value: MotionSensitivity; label: string }[] = [
  { value: "low", label: "Low: only firm movement" },
  { value: "medium", label: "Medium: everyday use, like opening a door" },
  { value: "high", label: "High: the lightest touch" },
];
// The sensor fetches its settings with every heartbeat (contract: POST /api/events), and
// heartbeats are at most this many seconds apart.
const SENSOR_SYNC_SECONDS = 30;
function newer(ts: string | null, than: string) {
  return ts !== null && Date.parse(ts) > Date.parse(than);
}
/** A progress bar from saving until the sensor has had its chance to fetch the new settings. */
function SensorSync({
  device,
  savedAt,
  startedAt,
}: {
  device: Device;
  savedAt: string;
  startedAt: number;
}) {
  const [now, setNow] = useState(Date.now());
  // Any post from the sensor after the save carried the new settings back to it.
  const heard = newer(device.last_heartbeat_at, savedAt) || newer(device.last_motion_at, savedAt);
  const seconds = (now - startedAt) / 1000;
  const done = heard || seconds >= SENSOR_SYNC_SECONDS;
  useEffect(() => {
    if (done) return;
    const timer = setInterval(() => setNow(Date.now()), 200);
    return () => clearInterval(timer);
  }, [done]);
  const progress = done ? 1 : seconds / SENSOR_SYNC_SECONDS;
  const ready = heard || device.online;
  const message = heard
    ? "Sensor updated. It’s ready to use."
    : device.online
      ? "Ready to use. The sensor picks up new settings every 30 seconds."
      : "Saved. The sensor is offline and will pick up these settings when it reconnects.";
  return (
    <div className="sensor-sync">
      <div
        className="sync-bar"
        role="progressbar"
        aria-label="Sending settings to the sensor"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(progress * 100)}
      >
        <span
          className={done ? (ready ? "ready" : "waiting") : ""}
          style={{ width: `${progress * 100}%` }}
        />
      </div>
      {!done && (
        <small aria-hidden="true">
          Sending settings to the sensor… about {Math.ceil(SENSOR_SYNC_SECONDS - seconds)} s left
        </small>
      )}
      <small aria-live="polite">{done ? message : ""}</small>
    </div>
  );
}
function Settings({ device, onDone }: { device: Device; onDone: () => void }) {
  const [name, setName] = useState(device.name);
  const [hours, setHours] = useState(String(Math.floor(device.limit_minutes / 60)));
  const [minutes, setMinutes] = useState(String(device.limit_minutes % 60));
  const [soundEnabled, setSoundEnabled] = useState(device.sound_enabled);
  const [sensitivity, setSensitivity] = useState(device.motion_sensitivity);
  const [sync, setSync] = useState<{ savedAt: string; startedAt: number } | null>(null);
  const limit = Number(hours || 0) * 60 + Number(minutes || 0);
  return (
    <section className="panel">
      <h2>Device settings</h2>
      <label>
        Device name
        <input value={name} maxLength={100} onChange={(e) => setName(e.target.value)} />
      </label>
      <fieldset className="duration">
        <legend>Check in after no activity for</legend>
        <label>
          <input
            type="number"
            inputMode="numeric"
            min={0}
            max={MAX_LIMIT / 60}
            value={hours}
            onChange={(e) => setHours(e.target.value)}
          />
          hours
        </label>
        <label>
          <input
            type="number"
            inputMode="numeric"
            min={0}
            max={59}
            value={minutes}
            onChange={(e) => setMinutes(e.target.value)}
          />
          minutes
        </label>
      </fieldset>
      <p className="muted">
        Anywhere from 1 minute to 48 hours. A learned routine may suggest a check-in sooner.
      </p>
      <label className="toggle">
        <input
          type="checkbox"
          checked={soundEnabled}
          onChange={(e) => setSoundEnabled(e.target.checked)}
        />
        Alert on loud sounds
      </label>
      <p className="muted">
        When off, a loud sound with no reply no longer texts your contacts. Falls always do.
      </p>
      <label>
        Accelerometer sensitivity
        <select
          value={sensitivity}
          onChange={(e) => setSensitivity(e.target.value as MotionSensitivity)}
        >
          {sensitivities.map((s) => (
            <option key={s.value} value={s.value}>
              {s.label}
            </option>
          ))}
        </select>
      </label>
      <p className="muted">
        How much movement counts as activity. The sensor picks up changes within 30 seconds.
      </p>
      <Action
        run={() => {
          if (!name.trim()) return Promise.reject(new Error("Enter a device name"));
          const whole = [hours, minutes].every((value) => /^\d*$/.test(value));
          if (!whole || Number(minutes || 0) > 59)
            return Promise.reject(new Error("Enter whole hours and 0-59 minutes"));
          if (limit < MIN_LIMIT || limit > MAX_LIMIT)
            return Promise.reject(
              new Error("Choose a check-in time between 1 minute and 48 hours"),
            );
          // Name and check-in time live on the server; only these travel to the sensor.
          const reachesSensor =
            soundEnabled !== device.sound_enabled || sensitivity !== device.motion_sensitivity;
          return api
            .updateDevice(device.id, {
              name: name.trim(),
              limit_minutes: limit,
              sound_enabled: soundEnabled,
              motion_sensitivity: sensitivity,
            })
            .then((saved) =>
              setSync(reachesSensor ? { savedAt: saved.server_now, startedAt: Date.now() } : null),
            );
        }}
        onDone={onDone}
        doneText="Saved"
      >
        Save settings
      </Action>
      {sync && <SensorSync key={sync.startedAt} device={device} {...sync} />}
    </section>
  );
}
function Contacts() {
  const { data, error, refresh } = usePoll(api.contacts);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMessage("");
    try {
      await api.addContact({ name: name.trim(), phone: phone.trim() });
      setName("");
      setPhone("");
      setMessage("Contact added");
      refresh();
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Could not add contact");
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <Heading eyebrow="ALERT RECIPIENTS" title="Contacts" />
      <Feedback error={error} />
      <div className="detail-grid">
        <section className="panel">
          <h2>Alert contacts</h2>
          <p className="muted">Every contact receives check-in alerts.</p>
          {data?.map((c) => (
            <div className="contact" key={c.id}>
              <div>
                <strong>{c.name}</strong>
                <p>{c.phone}</p>
              </div>
              <div className="button-row">
                <Action
                  secondary
                  run={() =>
                    api.testContact(c.id).then((result) => {
                      setMessage(
                        useMock
                          ? "Mock test completed. No message was sent."
                          : `Test sent via ${result.channel}.`,
                      );
                    })
                  }
                >
                  Test text
                </Action>
                <Action secondary run={() => api.deleteContact(c.id)} onDone={refresh}>
                  Remove
                </Action>
              </div>
            </div>
          ))}
          {data?.length === 0 && <p>Add someone to receive alerts.</p>}
        </section>
        <form className="panel" onSubmit={submit}>
          <h2>Add a contact</h2>
          <label>
            Name
            <input
              required
              maxLength={100}
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </label>
          <label>
            Phone number
            <input
              required
              type="tel"
              pattern="\+[1-9][0-9]{7,14}"
              placeholder="+14045550123"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
            />
          </label>
          <p className="muted">Include + and the country code.</p>
          <button disabled={busy || !name.trim()}>{busy ? "Adding…" : "Add contact"}</button>
          <p role="status">{message}</p>
        </form>
      </div>
    </>
  );
}
// A phone treats "localhost" as itself, so local dev points the QR code at the deployed site.
const DEPLOYED_URL = "https://stillhere-production-8652.up.railway.app";
function phoneReachableUrl() {
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(window.location.hostname);
  return local ? DEPLOYED_URL : window.location.origin;
}
function Setup() {
  const [url, setUrl] = useState(phoneReachableUrl);
  let setupUrl = "";
  try {
    const site = new URL(url);
    if (["http:", "https:"].includes(site.protocol)) setupUrl = new URL("/setup-device", site).href;
  } catch {
    /* Display validation below. */
  }
  return (
    <>
      <Heading eyebrow="CONFIGURATION" title="Setup" />
      <section className="panel setup">
        <h2>Set up on your phone</h2>
        <p>
          Scan this next to the object you want to monitor. It opens the placement guide on your
          phone so you can pick the best spot for the sensor.
        </p>
        <label>
          Site address
          <input type="url" value={url} onChange={(e) => setUrl(e.target.value)} />
        </label>
        {setupUrl ? (
          <QRCodeSVG
            value={setupUrl}
            size={200}
            marginSize={4}
            title="Scan to set up your device"
          />
        ) : (
          <p role="alert">Enter a complete http or https address.</p>
        )}
        {setupUrl && <small>Opens {setupUrl}</small>}
        <small>A localhost address only works on this computer.</small>
      </section>
    </>
  );
}
function DemoPage() {
  const demo = usePoll(api.demo);
  const devices = usePoll(api.devices);
  const [id, setId] = useState("");
  const [clock, setClock] = useState("");
  const [confirmReset, setConfirmReset] = useState(false);
  const [seedMessage, setSeedMessage] = useState("");
  const selected = id || devices.data?.devices[0]?.id || "";
  return (
    <>
      <Heading eyebrow="TESTING" title="Demo controls" />
      <Feedback error={demo.error || devices.error} />
      <section className="panel">
        <p>
          {useMock
            ? "Mock controls change local fixtures only. They do not run the backend alert engine or send texts."
            : "These controls change the connected backend demo."}
        </p>
        <p>Server clock: {demo.data ? date(demo.data.server_now) : "Loading…"}</p>
        {demo.data && (
          <Action run={() => api.setDemo({ enabled: !demo.data!.enabled })} onDone={demo.refresh}>
            {demo.data.enabled ? "Disable fast clock" : "Enable fast clock (1440×)"}
          </Action>
        )}
        <label>
          Device
          <select value={selected} onChange={(e) => setId(e.target.value)}>
            {devices.data?.devices.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
        </label>
        <Action
          run={async () => {
            if (!selected) throw new Error("Select a device first");
            const result = await api.seed(selected);
            setSeedMessage(`${result.events_created} events loaded`);
          }}
        >
          Load a normal week
        </Action>
        <p role="status">{seedMessage}</p>
        <label>
          Jump to a time (this browser’s timezone)
          <input type="datetime-local" value={clock} onChange={(e) => setClock(e.target.value)} />
        </label>
        <Action
          run={() => {
            if (!clock) return Promise.reject(new Error("Choose a date and time"));
            return api.setDemo({
              enabled: true,
              start_clock_at: new Date(clock).toISOString(),
            });
          }}
          onDone={demo.refresh}
        >
          Jump and start fast clock
        </Action>
        <hr />
        <p>Reset removes all event and alert history, keeping devices and contacts.</p>
        {confirmReset ? (
          <div className="button-row">
            <Action
              run={api.reset}
              onDone={() => {
                setConfirmReset(false);
                demo.refresh();
              }}
            >
              Confirm reset history
            </Action>
            <button className="secondary" onClick={() => setConfirmReset(false)}>
              Cancel
            </button>
          </div>
        ) : (
          <button className="secondary" onClick={() => setConfirmReset(true)}>
            Reset demo history
          </button>
        )}
      </section>
    </>
  );
}
export default function App() {
  const [session, setSession] = useState(loadSession);
  const [loggingOut, setLoggingOut] = useState(false);
  const location = useLocation();
  const navigate = useNavigate();
  const isLanding = location.pathname === "/" || location.pathname === "/login";
  useEffect(() => {
    if (isLanding) setLoggingOut(false);
  }, [isLanding]);
  useEffect(() => {
    window.scrollTo({ top: 0, behavior: "instant" });
  }, [location.pathname]);
  useEffect(() => {
    // api.ts announces an expired or rejected login; drop back to the login page.
    const expired = () => setSession(null);
    window.addEventListener(LOGOUT_EVENT, expired);
    return () => window.removeEventListener(LOGOUT_EVENT, expired);
  }, []);
  useSmoothScroll();
  useReveal(location.pathname);
  if (!session && !isLanding) {
    return (
      <Navigate
        to="/login"
        replace
        state={loggingOut ? null : { from: location.pathname + location.search }}
      />
    );
  }
  function login(next: Session) {
    setSession(next);
    const from: unknown = location.state?.from;
    navigate(
      typeof from === "string" &&
        from.startsWith("/") &&
        !from.startsWith("//") &&
        !from.startsWith("/login") &&
        from !== "/"
        ? from
        : next.user.role === "provider"
          ? "/community"
          : "/dashboard",
      { replace: true },
    );
    window.scrollTo(0, 0);
  }
  function logout() {
    setLoggingOut(true);
    saveSession(null);
    setSession(null);
    navigate("/login", { replace: true, state: null });
    window.scrollTo(0, 0);
  }
  if (isLanding || !session)
    return <LandingPage key={location.key} onLogin={login} loggedIn={session !== null} />;
  const { user } = session;
  const onCommunity = location.pathname === "/community";
  return (
    <>
      {!onCommunity && <ModelSwarm />}
      <header className="topbar">
        <Link className="brand" to="/">
          <img src="/icon.svg" alt="" />
          StillHere<span className="brand-dot">.</span>
        </Link>
        <nav aria-label="Main navigation">
          {user.role === "provider" && <NavLink to="/community">Community</NavLink>}
          <NavLink to="/dashboard" end>
            Overview
          </NavLink>
          <NavLink to="/contacts">Contacts</NavLink>
          <NavLink to="/setup">Setup</NavLink>
        </nav>
        <div className="account">
          <span className="account-name">
            {user.role === "provider" ? (user.community_name ?? user.name) : user.name}
            <small>{user.role === "provider" ? "Healthcare provider" : "Family caregiver"}</small>
          </span>
          <button className="secondary logout-button" onClick={logout}>
            Log out
          </button>
        </div>
      </header>
      {useMock && (
        <div className="mock-banner">
          Preview mode · sample household · changes reset on reload · no texts sent
        </div>
      )}
      <main
        className={
          location.pathname === "/dashboard" && user.role === "family"
            ? "overview-layout"
            : "application-layout"
        }
      >
        {/* Centered behind the community page. It lives inside main so it draws above main's own
            background layer; the page's panels are see-through enough to show it. */}
        {onCommunity && <ModelSwarm placement="center" />}
        {/* Keyed so each page plays the enter transition. */}
        <div className="route-view" key={location.pathname}>
          <Routes>
            <Route
              path="/dashboard"
              element={user.role === "provider" ? <ResidentTable /> : <Overview />}
            />
            <Route
              path="/community"
              element={
                user.role === "provider" ? <CommunityPage /> : <Navigate to="/dashboard" replace />
              }
            />
            <Route path="/devices/:id" element={<DevicePage />} />
            <Route path="/residents/:id" element={<ResidentPage />} />
            <Route path="/residents/:id/summary" element={<VisitSummary />} />
            <Route path="/contacts" element={<Contacts />} />
            <Route path="/setup" element={<Setup />} />
            <Route path="/setup-device" element={<DeviceSetup />} />
            <Route path="/placement" element={<PlacementGuide />} />
            <Route path="/demo" element={<DemoPage />} />
            <Route
              path="*"
              element={
                <>
                  <h1>Page not found</h1>
                  <Link to="/dashboard">Back to overview</Link>
                </>
              }
            />
          </Routes>
        </div>
      </main>
      <footer>
        STILLHERE <span>Activity monitoring</span>
      </footer>
    </>
  );
}
