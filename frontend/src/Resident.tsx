import { useCallback, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { api } from "./api";
import {
  AlertActions,
  duration,
  elapsed,
  eventText,
  LOWER_ACTIVITY,
  ResponseStats,
  StateChip,
} from "./Community";
import { usePoll } from "./hooks";
import { loadSession } from "./session";
import type { Alert, FamilyNotify, Resident, ResidentSummary, Trend } from "./types";

const KIND_LABELS: Record<Alert["kind"], string> = {
  inactivity: "Inactivity check-in",
  urgent: "Help requested",
  no_reply: "No reply after a loud sound or fall",
  false_alarm: "False alarm",
  offline: "Sensor offline",
  all_clear: "All clear",
};

function when(value: string | null, timezone: string) {
  return value
    ? new Date(value).toLocaleString([], {
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
        timeZone: timezone,
      })
    : "—";
}
function secondsBetween(from: string, to: string | null) {
  return to ? (Date.parse(to) - Date.parse(from)) / 1000 : null;
}
function dayLabel(iso: string) {
  // Local calendar dates from the server: read them as dates, not as UTC instants.
  const [year, month, day] = iso.split("-").map(Number);
  return new Date(year, month - 1, day).toLocaleDateString([], { month: "short", day: "numeric" });
}

function useSummary() {
  const { id = "" } = useParams();
  const load = useCallback(() => api.residentSummary(id), [id]);
  return usePoll(load);
}

function TrendChart({ trend, height = 220 }: { trend: Trend; height?: number }) {
  const data = trend.days.map((d) => ({ day: dayLabel(d.date), movements: d.count }));
  return (
    <div className="trend-chart" style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: -20 }}>
          <CartesianGrid vertical={false} stroke="#d5dfd5" />
          <XAxis dataKey="day" tickLine={false} interval={4} fontSize={12} />
          <YAxis allowDecimals={false} tickLine={false} axisLine={false} fontSize={12} />
          <Tooltip cursor={{ fill: "#e3ebdd" }} />
          <Bar
            dataKey="movements"
            name="Movements"
            fill="#2e8b62"
            radius={[4, 4, 0, 0]}
            isAnimationActive={false}
          />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

function WellnessNote({ trend }: { trend: Trend }) {
  if (trend.lower_than_usual)
    return (
      <div className="wellness-flag" role="status">
        <strong>
          <span aria-hidden="true">↘</span> Suggest wellness visit
        </strong>
        <p>{trend.note}</p>
      </div>
    );
  return (
    <p className="muted">
      {trend.recent_daily_average === null
        ? "Not enough history yet to compare with the usual pattern."
        : `About ${trend.recent_daily_average} movements a day this week, in line with the ${trend.prior_daily_average} a day before.`}
    </p>
  );
}

function Sharing({ resident, onSaved }: { resident: Resident; onSaved: () => void }) {
  const [alerts, setAlerts] = useState(resident.share_alerts_with_family);
  const [activity, setActivity] = useState(resident.share_activity_with_family);
  const [notify, setNotify] = useState<FamilyNotify>(resident.family_notify);
  const [message, setMessage] = useState("");
  async function save() {
    setMessage("");
    try {
      await api.updateResident(resident.id, {
        share_alerts_with_family: alerts,
        share_activity_with_family: activity,
        family_notify: notify,
      });
      setMessage("Saved");
      onSaved();
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Could not save");
    }
  }
  return (
    <section className="panel">
      <h2>Sharing with family</h2>
      <p className="muted">Staff always see everything for residents in their community.</p>
      <label className="toggle">
        <input type="checkbox" checked={alerts} onChange={(e) => setAlerts(e.target.checked)} />
        Family sees and receives alerts
      </label>
      <label className="toggle">
        <input type="checkbox" checked={activity} onChange={(e) => setActivity(e.target.checked)} />
        Family sees activity and trends
      </label>
      <label>
        When staff are paged for an urgent alert, family hears
        <select value={notify} onChange={(e) => setNotify(e.target.value as FamilyNotify)}>
          <option value="immediately">At the same time as staff</option>
          <option value="if_unanswered">Only if staff haven’t responded in time</option>
        </select>
      </label>
      <div className="settings-save">
        <button onClick={save}>Save sharing</button>
        {message && <small role="status">{message}</small>}
      </div>
    </section>
  );
}

function AlertHistory({
  summary,
  staff,
  onDone,
}: {
  summary: ResidentSummary;
  staff: boolean;
  onDone: () => void;
}) {
  const tz = summary.timezone;
  return (
    <section className="panel">
      <h2>Alerts, last 30 days</h2>
      {!summary.alerts.length && <p className="muted">No alerts in the last 30 days.</p>}
      <ul className="staff-list">
        {summary.alerts.map((a) => (
          <li key={a.id}>
            <div className="staff-row">
              <strong>{KIND_LABELS[a.kind]}</strong>
              <small>{when(a.sent_at, tz)}</small>
              <small>{a.resolved_at ? "Resolved" : "Open"}</small>
            </div>
            <p>{a.message}</p>
            <small className="muted">
              {a.acknowledged_at
                ? `${a.acknowledged_by ?? "Staff"} responded in ${duration(secondsBetween(a.sent_at, a.acknowledged_at))}`
                : "Not acknowledged"}
              {a.resolved_at &&
                ` · resolved after ${duration(secondsBetween(a.sent_at, a.resolved_at))}`}
            </small>
            <AlertActions alert={a} staff={staff} onDone={onDone} />
          </li>
        ))}
      </ul>
    </section>
  );
}

export default function ResidentPage() {
  const { data, error, refresh } = useSummary();
  const staff = loadSession()?.user.role === "provider";
  if (!data)
    return error ? (
      <p className="error" role="alert">
        {error}
      </p>
    ) : null;
  const { resident, unit } = data;
  return (
    <>
      <header className="page-heading">
        <div>
          <p className="eyebrow">
            {resident.unit ? `APARTMENT ${resident.unit}` : "RESIDENT"}
            {data.community_name ? ` · ${data.community_name.toUpperCase()}` : ""}
          </p>
          <h1>
            {resident.first_name} {resident.last_name}
          </h1>
        </div>
        <Link className="button-link" to={`/residents/${resident.id}/summary`}>
          Printable visit summary
        </Link>
      </header>
      {error && (
        <p className="error" role="alert">
          {error} · Displayed data may be out of date.
        </p>
      )}
      {unit && (
        <section className="panel resident-status">
          <StateChip state={unit.state} />
          <dl>
            <div>
              <dt>No movement for</dt>
              <dd>{elapsed(unit.minutes_since_motion)}</dd>
            </div>
            <div>
              <dt>Last event</dt>
              <dd>{eventText(unit, data.server_now)}</dd>
            </div>
            <div>
              <dt>Sensors</dt>
              <dd>
                {data.devices.map((d, i) => (
                  <span key={d.id}>
                    {i > 0 && ", "}
                    <Link to={`/devices/${d.id}`}>{d.name}</Link> ({d.online ? "online" : "offline"}
                    )
                  </span>
                ))}
              </dd>
            </div>
          </dl>
        </section>
      )}
      <div className="detail-grid">
        <section className="panel">
          <h2>Daily movement, last 30 days</h2>
          {data.trend ? (
            <>
              <WellnessNote trend={data.trend} />
              <TrendChart trend={data.trend} />
              <small className="muted">
                Compares this resident with their own recent weeks. {LOWER_ACTIVITY} is a prompt to
                visit, not a health finding.
              </small>
            </>
          ) : (
            <p className="muted">This resident doesn’t share activity with family.</p>
          )}
        </section>
        <AlertHistory summary={data} staff={staff} onDone={refresh} />
      </div>
      {staff && <ResponseStats stats={data.response_times} label="Response times" />}
      <Sharing key={resident.id} resident={resident} onSaved={refresh} />
    </>
  );
}

/** A one-page summary to print before a wellness visit. */
export function VisitSummary() {
  const { data, error } = useSummary();
  if (!data)
    return error ? (
      <p className="error" role="alert">
        {error}
      </p>
    ) : null;
  const { resident, trend, timezone } = data;
  return (
    <article className="visit-summary">
      <div className="print-actions">
        <Link to={`/residents/${resident.id}`}>← Back to {resident.first_name}</Link>
        <button onClick={() => window.print()}>Print</button>
      </div>
      <header>
        <p className="eyebrow">VISIT SUMMARY · {when(data.server_now, timezone)}</p>
        <h1>
          {resident.first_name} {resident.last_name}
        </h1>
        <p>
          {resident.unit ? `Apartment ${resident.unit}` : ""}
          {data.community_name ? ` · ${data.community_name}` : ""}
        </p>
      </header>
      <section>
        <h2>Activity, last 30 days</h2>
        {trend ? (
          <>
            <WellnessNote trend={trend} />
            <TrendChart trend={trend} height={180} />
          </>
        ) : (
          <p>Activity isn’t shared.</p>
        )}
      </section>
      <section>
        <h2>Response times</h2>
        <ResponseStats stats={data.response_times} label="Response times" />
      </section>
      <section>
        <h2>Alerts, last 30 days</h2>
        {!data.alerts.length ? (
          <p>No alerts in the last 30 days.</p>
        ) : (
          <div className="table-scroll">
            <table className="resident-table">
              <thead>
                <tr>
                  <th scope="col">Alert</th>
                  <th scope="col">Created</th>
                  <th scope="col">Acknowledged</th>
                  <th scope="col">Resolved</th>
                  <th scope="col">Response</th>
                </tr>
              </thead>
              <tbody>
                {data.alerts.map((a) => (
                  <tr key={a.id}>
                    <td>{KIND_LABELS[a.kind]}</td>
                    <td>{when(a.sent_at, timezone)}</td>
                    <td>
                      {when(a.acknowledged_at, timezone)}
                      {a.acknowledged_by ? ` · ${a.acknowledged_by}` : ""}
                    </td>
                    <td>{when(a.resolved_at, timezone)}</td>
                    <td>{duration(secondsBetween(a.sent_at, a.acknowledged_at))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
      <footer>
        <small>
          StillHere measures movement near everyday objects. It is a prompt to check in, not a
          medical record or assessment.
        </small>
      </footer>
    </article>
  );
}
