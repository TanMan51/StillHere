// A faint EKG trace behind the landing page (the sensor and the see-through sections), with a
// brighter pulse sweeping along it like a bedside monitor. Pure SVG and CSS; reduced motion leaves just the still trace.

// Two beats across the screen, each drawn in the middle of its own stretch of flat line.
const BEAT = 800;
const BEATS = 2;
const LEAD_IN = 250;
const BASELINE = 110;

/** One heartbeat: P wave, QRS spike, T wave, then flat until the next beat. */
function beat(start: number): string {
  const x = start + LEAD_IN;
  return [
    `L${x + 60} ${BASELINE}`,
    `Q${x + 80} ${BASELINE - 22} ${x + 100} ${BASELINE}`,
    `L${x + 140} ${BASELINE}`,
    `L${x + 150} ${BASELINE + 10}`,
    `L${x + 162} ${BASELINE - 84}`,
    `L${x + 175} ${BASELINE + 30}`,
    `L${x + 186} ${BASELINE}`,
    `L${x + 236} ${BASELINE}`,
    `Q${x + 268} ${BASELINE - 40} ${x + 300} ${BASELINE}`,
    `L${start + BEAT} ${BASELINE}`,
  ].join(" ");
}

const TRACE = `M0 ${BASELINE} ${Array.from({ length: BEATS }, (_, i) => beat(i * BEAT)).join(" ")}`;

export default function Heartbeat() {
  return (
    <svg
      className="heartbeat"
      viewBox={`0 0 ${BEAT * BEATS} 180`}
      preserveAspectRatio="none"
      aria-hidden="true"
    >
      <path className="heartbeat-trace" d={TRACE} pathLength={1000} />
      <path className="heartbeat-pulse" d={TRACE} pathLength={1000} />
    </svg>
  );
}
