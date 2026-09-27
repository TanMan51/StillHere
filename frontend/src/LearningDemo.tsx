import { useCallback, useEffect, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { api } from "./api";
import type { DeviceLearning, LearningFrame } from "./types";

// "Watch it learn": replays the routine model one day at a time, straight from the server's
// real model (GET /api/devices/{id}/learning), so what's on screen is what the app learned.

const FRAME_MS = 650;
const HOURS = Array.from({ length: 24 }, (_, hour) => hour);

function hourLabel(hour: number) {
  return hour === 0 ? "12a" : hour === 12 ? "12p" : hour < 12 ? `${hour}a` : `${hour - 12}p`;
}
function dayLabel(iso: string) {
  // Server dates are local calendar dates: read them as dates, not UTC instants.
  const [year, month, day] = iso.split("-").map(Number);
  return new Date(year, month - 1, day).toLocaleDateString([], {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}
function span(minutes: number) {
  if (minutes < 60) return `${Math.round(minutes)} minutes`;
  const hours = Math.floor(minutes / 60);
  const rest = Math.round(minutes % 60);
  return rest ? `${hours}h ${rest}m` : `${hours} hour${hours === 1 ? "" : "s"}`;
}
function percent(chance: number) {
  const value = chance * 100;
  return value < 1 ? "under 1%" : `about ${Math.round(value)}%`;
}

/** The day's visits as dots on a 24-hour line: the new evidence the model learns from. */
function DayStrip({ frame }: { frame: LearningFrame }) {
  return (
    <div className="day-strip">
      <svg
        viewBox="0 0 1000 44"
        preserveAspectRatio="none"
        role="img"
        aria-label={`${frame.visits.length} visits recorded on ${dayLabel(frame.date)}`}
      >
        <line x1="0" y1="20" x2="1000" y2="20" className="day-strip-axis" />
        {[0, 6, 12, 18, 24].map((hour) => (
          <line
            key={hour}
            x1={(hour / 24) * 1000}
            y1="12"
            x2={(hour / 24) * 1000}
            y2="28"
            className="day-strip-tick"
          />
        ))}
        {frame.visits.map((minute, i) => (
          <circle
            key={`${minute}-${i}`}
            cx={(minute / 1440) * 1000}
            cy="20"
            r="7"
            className="day-strip-dot"
          />
        ))}
      </svg>
      <div className="day-strip-labels" aria-hidden="true">
        <span>12 AM</span>
        <span>6 AM</span>
        <span>12 PM</span>
        <span>6 PM</span>
        <span>12 AM</span>
      </div>
    </div>
  );
}

/** Drag a quiet stretch from 30 minutes to 16 hours and see the model's call on it. Every
 * number comes from the server's model (what_if); nothing is recomputed here. */
function WhatIf({ data }: { data: DeviceLearning }) {
  const steps = data.what_if;
  const quiet = data.now.quiet_minutes;
  const nearest =
    quiet === null
      ? 0
      : steps.reduce(
          (best, step, i) =>
            Math.abs(step.quiet_minutes - quiet) < Math.abs(steps[best].quiet_minutes - quiet)
              ? i
              : best,
          0,
        );
  const [index, setIndex] = useState(nearest);
  if (!steps.length)
    return (
      <div className="learning-verdict" role="status">
        <h3>Not learned yet</h3>
        <p>
          Until {data.days_needed} days of routine are in, StillHere only uses the fixed check-in
          limit.
        </p>
      </div>
    );
  const step = steps[Math.min(index, steps.length - 1)];
  const firstUnusual = steps.find((item) => item.unusual);
  return (
    <div className={`learning-verdict ${step.unusual ? "unusual" : ""}`}>
      <h3>Try it: what if it’s been quiet for…</h3>
      <label className="what-if-slider">
        <strong>{span(step.quiet_minutes)}</strong>
        <input
          type="range"
          min={0}
          max={steps.length - 1}
          value={index}
          aria-label="Length of the quiet stretch"
          onChange={(e) => setIndex(Number(e.target.value))}
        />
      </label>
      <p role="status">
        A quiet stretch this long, ending now, happens <strong>{percent(step.chance)}</strong> of
        the time for this routine,{" "}
        {step.unusual ? (
          <strong>which is unusual: StillHere would send a check-in.</strong>
        ) : (
          "which is normal."
        )}
      </p>
      <div className="chance-bar" aria-hidden="true">
        <span className="chance-fill" style={{ width: `${Math.max(1, step.chance * 100)}%` }} />
        <span className="chance-line" style={{ left: `${data.alert_probability * 100}%` }} />
      </div>
      <small className="muted">
        Alerts start below {Math.round(data.alert_probability * 100)}% (the line), never before{" "}
        {data.min_gap_minutes} minutes of quiet.
        {firstUnusual && ` At this hour, that’s after about ${span(firstUnusual.quiet_minutes)}.`}
        {data.source === "real" &&
          quiet !== null &&
          ` Right now it’s been quiet for ${span(quiet)}.`}
      </small>
    </div>
  );
}

export default function LearningDemo({
  deviceId,
  name,
  autoStart = false,
}: {
  deviceId: string;
  name: string;
  autoStart?: boolean;
}) {
  const reducedMotion =
    typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const [data, setData] = useState<DeviceLearning | null>(null);
  const [index, setIndex] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  // The demo always asks to load 14 days of sample movement first, whatever the sensor's own
  // history, so every replay starts from nothing and learns the same way on stage.
  const [asking, setAsking] = useState(autoStart);

  const start = useCallback(async () => {
    setBusy(true);
    setError("");
    try {
      const replay = await api.learning(deviceId, "sample");
      setAsking(false);
      setData(replay);
      // With reduced motion, show the finished model and let the slider do the replaying.
      setIndex(reducedMotion ? Math.max(0, replay.frames.length - 1) : 0);
      setPlaying(!reducedMotion && replay.frames.length > 1);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load the learned routine");
    } finally {
      setBusy(false);
    }
  }, [deviceId, reducedMotion]);

  useEffect(() => {
    if (!playing || !data) return;
    const timer = setInterval(() => {
      setIndex((current) => {
        if (current >= data.frames.length - 1) {
          setPlaying(false);
          return current;
        }
        return current + 1;
      });
    }, FRAME_MS);
    return () => clearInterval(timer);
  }, [playing, data]);

  const frame = data?.frames[index];
  const finished = data !== null && !playing && index === data.frames.length - 1;
  const rates = frame ? HOURS.map((hour) => ({ hour, rate: frame.hourly_rate[hour] })) : [];
  const quiet = frame
    ? HOURS.map((hour) => ({ hour, hours: frame.hourly_threshold_minutes[hour] / 60 }))
    : [];
  const topRate = data ? Math.max(0.5, ...data.frames.flatMap((f) => f.hourly_rate)) : 1;

  return (
    <section className="panel learning-demo" aria-labelledby="learning-title">
      <div className="learning-head">
        <div>
          <h2 id="learning-title">Watch StillHere learn the routine at {name}</h2>
          <p className="muted">
            Replays the real model one day at a time: each day’s visits go in, and its sense of when
            this person is usually active sharpens.
          </p>
        </div>
        {!data && !asking && <button onClick={() => setAsking(true)}>▶ Watch it learn</button>}
      </div>
      {asking && (
        <div className="learning-prompt" role="dialog" aria-labelledby="learning-prompt-title">
          <h3 id="learning-prompt-title">Load 14 days of data to learn from</h3>
          <p>
            The model needs a history of movement to learn a routine. This loads 14 days of sample
            movement for {name} and replays the learning one day at a time. Nothing is saved, and
            the sensor’s real monitoring is unaffected.
          </p>
          <div className="button-row">
            <button onClick={start} disabled={busy}>
              {busy ? "Loading…" : "Load 14 days of data"}
            </button>
            <button className="secondary" onClick={() => setAsking(false)} disabled={busy}>
              Cancel
            </button>
          </div>
        </div>
      )}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {data?.source === "sample" && (
        <p className="learning-sample">
          <strong>14 days of sample data.</strong> A typical routine for this kind of object, loaded
          for this demo only. Nothing is saved, and the sensor’s real monitoring is unaffected.
        </p>
      )}
      {data && !data.frames.length && (
        <p className="muted">No movement history yet, so there’s nothing to learn from.</p>
      )}
      {data && frame && (
        <>
          <div className="learning-status">
            <strong>
              Day {index + 1} of {data.frames.length} · {dayLabel(frame.date)}
            </strong>
            <span className={`learning-pill ${frame.ready ? "learned" : ""}`}>
              {frame.ready
                ? "✓ Routine learned"
                : `Learning… ${frame.days_of_data} of ${data.days_needed} days`}
            </span>
          </div>
          <div
            className="learning-progress"
            role="progressbar"
            aria-label="Days learned"
            aria-valuemin={0}
            aria-valuemax={data.days_needed}
            aria-valuenow={Math.min(frame.days_of_data, data.days_needed)}
          >
            <span
              style={{ width: `${Math.min(1, frame.days_of_data / data.days_needed) * 100}%` }}
            />
          </div>

          <h3>New evidence: visits recorded that day ({frame.visits.length})</h3>
          <DayStrip frame={frame} />

          <div className="learning-charts">
            <figure>
              <figcaption>
                <strong>What it has learned</strong>
                <span>Usual visits per hour, at each hour of the day</span>
              </figcaption>
              <div className="learning-chart">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={rates} margin={{ top: 6, right: 6, bottom: 0, left: -18 }}>
                    <CartesianGrid vertical={false} stroke="#d5dfd5" />
                    <XAxis
                      dataKey="hour"
                      tickFormatter={hourLabel}
                      interval={2}
                      fontSize={11}
                      tickLine={false}
                    />
                    <YAxis
                      domain={[0, Math.ceil(topRate * 10) / 10]}
                      fontSize={11}
                      tickLine={false}
                      axisLine={false}
                    />
                    <Tooltip
                      labelFormatter={(hour) => `Around ${hourLabel(Number(hour))}`}
                      formatter={(value) => [`${Number(value).toFixed(2)} visits/hour`, "Usual"]}
                    />
                    <Bar
                      dataKey="rate"
                      fill="#2e8b62"
                      radius={[3, 3, 0, 0]}
                      animationDuration={350}
                    />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </figure>
            <figure className={frame.ready ? "" : "learning-waiting"}>
              <figcaption>
                <strong>When quiet becomes unusual</strong>
                <span>
                  {frame.ready
                    ? "Longest normal quiet spell ending at each hour"
                    : `Not used until ${data.days_needed} days are learned; the fixed check-in limit applies`}
                </span>
              </figcaption>
              <div className="learning-chart">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={quiet} margin={{ top: 6, right: 6, bottom: 0, left: -18 }}>
                    <CartesianGrid vertical={false} stroke="#d5dfd5" />
                    <XAxis
                      dataKey="hour"
                      tickFormatter={hourLabel}
                      interval={2}
                      fontSize={11}
                      tickLine={false}
                    />
                    <YAxis fontSize={11} tickLine={false} axisLine={false} unit="h" />
                    <Tooltip
                      labelFormatter={(hour) => `Ending around ${hourLabel(Number(hour))}`}
                      formatter={(value) => [span(Number(value) * 60), "Unusual after"]}
                    />
                    <Line
                      type="monotone"
                      dataKey="hours"
                      stroke="#c2940a"
                      strokeWidth={2.5}
                      dot={false}
                      animationDuration={350}
                    />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </figure>
          </div>

          <div className="learning-controls">
            <button
              className="secondary"
              onClick={() => {
                if (finished) setIndex(0);
                setPlaying(!playing);
              }}
            >
              {playing ? "❚❚ Pause" : finished ? "↺ Replay" : "▶ Play"}
            </button>
            <label>
              Day
              <input
                type="range"
                min={0}
                max={data.frames.length - 1}
                value={index}
                onChange={(e) => {
                  setPlaying(false);
                  setIndex(Number(e.target.value));
                }}
              />
            </label>
          </div>

          {finished && <WhatIf data={data} />}

          <details className="learning-how">
            <summary>How the learning works</summary>
            <ol>
              <li>Each movement is a visit; movement within 5 minutes of the last counts once.</li>
              <li>
                Visits are counted by hour of day over the last four weeks, and recent days count
                more: a day’s weight halves every 7 days, so the model follows changing habits.
              </li>
              <li>Each hour is blended a little with its neighbors, for habits that drift.</li>
              <li>
                For a quiet stretch, the model works out the chance of seeing no visits at all that
                long. Under {Math.round(data.alert_probability * 100)}% means unusual for this
                person, so a quiet night is fine but a missed breakfast is not.
              </li>
              <li>
                It needs {data.days_needed} days before it’s used; it never goes past the fixed
                check-in limit you set.
              </li>
            </ol>
          </details>
        </>
      )}
    </section>
  );
}
