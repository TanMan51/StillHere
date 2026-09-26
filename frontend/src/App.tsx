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
import { Bar, BarChart, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { QRCodeSVG } from "qrcode.react";
import { api, useMock } from "./api";
import { usePoll, useTick } from "./hooks";
import type { Device, Status } from "./types";
import PlacementGuide, { PlacementHelp, SetupPrompt } from "./PlacementGuide";
import { hasDemoSession, saveDemoSession } from "./Login";
import LandingPage from "./LandingPage";

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
function ago(value: string | null, server: string) {
  if (!value) return "No activity recorded";
  const minutes = Math.max(0, Math.floor((Date.parse(server) - Date.parse(value)) / 60000));
  return minutes < 1
    ? "Just now"
    : minutes < 60
      ? `${minutes} min ago`
      : `${Math.floor(minutes / 60)}h ${minutes % 60}m ago`;
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
    <span>
      {seconds === 0
        ? "Checking activity…"
        : `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m ${seconds % 60}s until check-in`}
    </span>
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
}: {
  children: ReactNode;
  run: () => Promise<unknown>;
  onDone?: () => void;
  secondary?: boolean;
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
            setMessage("Done");
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
  const hour = Number(
    new Intl.DateTimeFormat("en-US", {
      hour: "numeric",
      hourCycle: "h23",
      timeZone: d.baseline.timezone,
    }).format(new Date(data.server_now)),
  );
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
          <h2>Activity by hour</h2>
          <p className="muted">
            {d.baseline.ready
              ? `Average activity by hour · ${d.baseline.days_of_data} days observed`
              : `Learning the routine · ${d.baseline.days_of_data} of 5 days observed`}
          </p>
          <div
            className="chart"
            role="img"
            aria-label={`Hourly activity chart in ${d.baseline.timezone}`}
          >
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={d.baseline.hourly_activity.map((count, h) => ({
                  hour: h,
                  count,
                }))}
              >
                <XAxis dataKey="hour" tickFormatter={(h) => `${h}:00`} interval={5} />
                <YAxis allowDecimals={false} width={28} />
                <Tooltip
                  labelFormatter={(h) => `${h}:00`}
                  contentStyle={{
                    background: "#ffffff",
                    borderColor: "#d5dfd5",
                    color: "#253e36",
                  }}
                  itemStyle={{ color: "#4e7460" }}
                  cursor={{ fill: "#ffffff0a" }}
                />
                <Bar
                  isAnimationActive={false}
                  dataKey="count"
                  name="Average events"
                  radius={[4, 4, 0, 0]}
                >
                  {d.baseline.hourly_activity.map((_, h) => (
                    <Cell key={h} fill={h === hour ? "#184e42" : "#a5b99a"} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
          <small>Hours shown in {d.baseline.timezone}. Dark blue marks the current hour.</small>
        </section>
        <Settings key={d.id} device={d} onDone={refresh} />
      </div>
      <div className="detail-grid">
        <section className="panel">
          <h2>Recent activity</h2>
          {!d.events.length && <p>No activity recorded yet.</p>}
          {d.events.map((e) => (
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
          ))}
        </section>
        <section className="panel">
          <h2>Check-in history</h2>
          {!d.alerts.length && <p>No alerts yet.</p>}
          {d.alerts.map((a) => (
            <article className="alert-item" key={a.id}>
              <strong>{a.kind.replaceAll("_", " ")}</strong>
              <p>{a.message}</p>
              <small>
                {date(a.sent_at, d.baseline.timezone)} · {a.resolved_at ? "Resolved" : "Open"} ·{" "}
                {a.sms_sent ? "Text sent" : "No text sent"}
              </small>
            </article>
          ))}
        </section>
      </div>
    </>
  );
}
function Settings({ device, onDone }: { device: Device; onDone: () => void }) {
  const [name, setName] = useState(device.name);
  const [limit, setLimit] = useState(device.limit_minutes);
  return (
    <section className="panel">
      <h2>Device settings</h2>
      <label>
        Device name
        <input value={name} maxLength={100} onChange={(e) => setName(e.target.value)} />
      </label>
      <label>
        Check in after no activity for
        <select value={limit} onChange={(e) => setLimit(Number(e.target.value))}>
          {![360, 720, 1440].includes(limit) && <option value={limit}>{limit} minutes</option>}
          <option value={360}>6 hours</option>
          <option value={720}>12 hours</option>
          <option value={1440}>24 hours</option>
        </select>
      </label>
      <p className="muted">A learned routine may suggest a check-in sooner.</p>
      <Action
        run={() => {
          if (!name.trim()) return Promise.reject(new Error("Enter a device name"));
          return api.updateDevice(device.id, {
            name: name.trim(),
            limit_minutes: limit,
          });
        }}
        onDone={onDone}
      >
        Save settings
      </Action>
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
function Setup() {
  const [url, setUrl] = useState(window.location.origin);
  let valid = false;
  try {
    valid = ["http:", "https:"].includes(new URL(url).protocol);
  } catch {
    /* Display validation below. */
  }
  return (
    <>
      <Heading eyebrow="CONFIGURATION" title="Setup" />
      <PlacementHelp />
      <section className="panel setup">
        <h2>Dashboard QR code</h2>
        <p>Use the deployed dashboard address so another phone can reach it.</p>
        <label>
          Dashboard URL
          <input type="url" value={url} onChange={(e) => setUrl(e.target.value)} />
        </label>
        {valid ? (
          <QRCodeSVG value={url} size={200} marginSize={4} title="Scan to open StillHere" />
        ) : (
          <p role="alert">Enter a complete http or https address.</p>
        )}
        <p>Scan with a phone camera, then choose “Add to Home Screen” in the browser menu.</p>
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
  const [loggedIn, setLoggedIn] = useState(hasDemoSession);
  const [loggingOut, setLoggingOut] = useState(false);
  const location = useLocation();
  const navigate = useNavigate();
  const isLanding = location.pathname === "/" || location.pathname === "/login";
  useEffect(() => {
    if (isLanding) setLoggingOut(false);
  }, [isLanding]);
  if (useMock && !loggedIn && !isLanding) {
    return (
      <Navigate
        to="/login"
        replace
        state={loggingOut ? null : { from: location.pathname + location.search }}
      />
    );
  }
  function login() {
    saveDemoSession(true);
    setLoggedIn(true);
    const from: unknown = location.state?.from;
    navigate(
      typeof from === "string" &&
        from.startsWith("/") &&
        !from.startsWith("//") &&
        !from.startsWith("/login") &&
        from !== "/"
        ? from
        : "/dashboard",
      { replace: true },
    );
    window.scrollTo(0, 0);
  }
  function logout() {
    setLoggingOut(true);
    saveDemoSession(false);
    setLoggedIn(false);
    navigate("/login", { replace: true, state: null });
    window.scrollTo(0, 0);
  }
  if (isLanding) return <LandingPage key={location.key} onLogin={login} loggedIn={loggedIn} />;
  return (
    <>
      <header className="topbar">
        <Link className="brand" to="/">
          <img src="/icon.svg" alt="" />
          StillHere<span className="brand-dot">.</span>
        </Link>
        <nav aria-label="Main navigation">
          <NavLink to="/dashboard" end>
            Overview
          </NavLink>
          <NavLink to="/contacts">Contacts</NavLink>
          <NavLink to="/setup">Setup</NavLink>
        </nav>
        {useMock ? (
          <button className="secondary logout-button" onClick={logout}>
            Log out
          </button>
        ) : (
          <Link to="/login">Log in</Link>
        )}
      </header>
      {useMock && (
        <div className="mock-banner">
          Preview mode · sample household · changes reset on reload · no texts sent
        </div>
      )}
      <main
        className={location.pathname === "/dashboard" ? "overview-layout" : "application-layout"}
      >
        <Routes>
          <Route path="/dashboard" element={<Overview />} />
          <Route path="/devices/:id" element={<DevicePage />} />
          <Route path="/contacts" element={<Contacts />} />
          <Route path="/setup" element={<Setup />} />
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
      </main>
      <footer>
        STILLHERE <span>Activity monitoring</span>
      </footer>
    </>
  );
}
