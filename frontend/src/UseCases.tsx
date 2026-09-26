// "Best use cases" section of the landing page: where the sensor works well, drawn as
// isometric CAD views (shaded solids with edge lines, a grid, an axis triad, and dimensions).

const EDGE = "#33423b";
const TONES = {
  part: ["#f3f5f3", "#dde3de", "#c6cfc8"],
  sensor: ["#ffffff", "#eef1ee", "#d9dfda"],
  glass: ["#eaf2f6", "#d9e7ee", "#c7d8e1"],
};
// Real outside size of the assembled sensor, from the CAD model.
const SENSOR_SIZE = "60 × 62 × 28 mm";

type Tone = keyof typeof TONES;
interface Box {
  x: number;
  y: number;
  z: number;
  w: number;
  d: number;
  h: number;
  tone?: Tone;
}
type Point = [number, number];

/** Isometric projection: +x runs down-right, +y down-left, +z up. */
function iso(x: number, y: number, z: number): Point {
  return [(x - y) * 0.866, (x + y) * 0.5 - z];
}
const path = (points: Point[]) =>
  `M${points.map(([x, y]) => `${x.toFixed(1)} ${y.toFixed(1)}`).join("L")}Z`;

/** The three faces a viewer at (+x, +y, +z) can see. */
function boxFaces({ x, y, z, w, d, h }: Box): Point[][] {
  return [
    [iso(x, y, z + h), iso(x + w, y, z + h), iso(x + w, y + d, z + h), iso(x, y + d, z + h)],
    [iso(x, y + d, z), iso(x + w, y + d, z), iso(x + w, y + d, z + h), iso(x, y + d, z + h)],
    [iso(x + w, y, z), iso(x + w, y + d, z), iso(x + w, y + d, z + h), iso(x + w, y, z + h)],
  ];
}

/** A circle drawn on a face that faces +y (the viewer's left side). */
function disc(cx: number, y: number, cz: number, r: number): Point[] {
  return Array.from({ length: 28 }, (_, i) => {
    const a = (i / 28) * Math.PI * 2;
    return iso(cx + r * Math.cos(a), y, cz + r * Math.sin(a));
  });
}

/** The sensor mounted flat against a +y face, with the Circuit Playground in its lid. */
function sensor(x: number, y: number, z: number, size = 12): Box[] {
  return [{ x, y, z, w: size, d: size * 0.45, h: size * 1.03, tone: "sensor" }];
}

interface Figure {
  title: string;
  body: string;
  boxes: Box[];
  /** Where the mounted sensor sits: [x, front y, z, size]. */
  mount: [number, number, number, number];
}

const FIGURES: Figure[] = [
  {
    title: "Fridge door",
    body: "Opened several times a day, mostly around meals, so a missed breakfast stands out.",
    boxes: [
      { x: 0, y: 0, z: 4, w: 70, d: 66, h: 176 },
      { x: 2, y: 66, z: 118, w: 66, d: 4, h: 60 },
      { x: 2, y: 66, z: 6, w: 66, d: 4, h: 110 },
      { x: 58, y: 70, z: 128, w: 4, d: 4, h: 40 },
      { x: 58, y: 70, z: 50, w: 4, d: 4, h: 56 },
    ],
    mount: [34, 70, 84, 14],
  },
  {
    title: "Front door",
    body: "Shows comings and goings. Mount it on the door itself, not the frame, so it moves.",
    boxes: [
      { x: 0, y: 0, z: 0, w: 110, d: 8, h: 210 },
      { x: 27, y: 8, z: 0, w: 56, d: 4, h: 184 },
      { x: 74, y: 12, z: 88, w: 5, d: 5, h: 5 },
    ],
    mount: [60, 12, 156, 14],
  },
  {
    title: "Walker",
    body: "Moves whenever someone is up and about. Attach it to the frame, clear of the hand grips.",
    boxes: [
      { x: 0, y: 0, z: 0, w: 4, d: 4, h: 84 },
      { x: 52, y: 0, z: 0, w: 4, d: 4, h: 84 },
      { x: 0, y: 0, z: 80, w: 56, d: 4, h: 4 },
      { x: 0, y: 0, z: 80, w: 4, d: 44, h: 4 },
      { x: 52, y: 0, z: 80, w: 4, d: 44, h: 4 },
      { x: 0, y: 40, z: 0, w: 4, d: 4, h: 84 },
      { x: 52, y: 40, z: 0, w: 4, d: 4, h: 84 },
      { x: 0, y: 40, z: 46, w: 56, d: 4, h: 4 },
      { x: -2, y: 6, z: 84, w: 8, d: 16, h: 5 },
      { x: 50, y: 6, z: 84, w: 8, d: 16, h: 5 },
    ],
    mount: [22, 44, 42, 12],
  },
  {
    title: "Medicine cabinet",
    body: "Opened at about the same times each day, which makes the routine quick to learn.",
    boxes: [
      { x: 0, y: 0, z: 40, w: 110, d: 6, h: 150 },
      { x: 30, y: 6, z: 70, w: 50, d: 34, h: 12 },
      { x: 28, y: 6, z: 110, w: 54, d: 14, h: 64 },
      { x: 32, y: 20, z: 114, w: 46, d: 1, h: 56, tone: "glass" },
    ],
    mount: [62, 21, 118, 12],
  },
];

function CadFigure({ figure, index }: { figure: Figure; index: number }) {
  const [mx, my, mz, size] = figure.mount;
  const mounted = sensor(mx, my, mz, size);
  const solids = [...figure.boxes, ...mounted];
  const lid = disc(mx + size / 2, my + size * 0.45, mz + size * 0.52, size * 0.36);
  // Fit every projected corner into the drawing area above the title block.
  const corners = solids.flatMap((box) => boxFaces(box).flat());
  const xs = corners.map(([x]) => x);
  const ys = corners.map(([, y]) => y);
  const [minX, maxX, minY, maxY] = [
    Math.min(...xs),
    Math.max(...xs),
    Math.min(...ys),
    Math.max(...ys),
  ];
  const scale = Math.min(250 / (maxX - minX), 170 / (maxY - minY));
  const offsetX = 160 - ((minX + maxX) / 2) * scale;
  const offsetY = 104 - ((minY + maxY) / 2) * scale;
  const place = ([x, y]: Point): Point => [x * scale + offsetX, y * scale + offsetY];
  const [calloutX, calloutY] = place(iso(mx + size, my + size * 0.45, mz + size * 1.03));
  const label = `FIG. ${String(index + 1).padStart(2, "0")} — ${figure.title.toUpperCase()}`;
  const gridId = `cad-grid-${index}`;
  return (
    <svg
      viewBox="0 0 320 240"
      role="img"
      aria-label={`CAD view of the sensor on a ${figure.title.toLowerCase()}`}
    >
      <defs>
        <pattern id={gridId} width="16" height="16" patternUnits="userSpaceOnUse">
          <path d="M16 0H0V16" fill="none" stroke="#dfe6e1" strokeWidth="0.6" />
        </pattern>
      </defs>
      <rect width="320" height="240" rx="14" fill="#f7f9f7" />
      <rect x="6" y="6" width="308" height="228" rx="10" fill={`url(#${gridId})`} />
      {solids.map((box, b) =>
        boxFaces(box).map((face, f) => (
          <path
            key={`${b}-${f}`}
            d={path(face.map(place))}
            fill={TONES[box.tone ?? "part"][f]}
            stroke={EDGE}
            strokeWidth="0.9"
            strokeLinejoin="round"
          />
        )),
      )}
      <path d={path(lid.map(place))} fill="#c9b878" stroke="#7d6f3c" strokeWidth="0.7" />
      <g fontFamily="ui-monospace, Consolas, monospace" fontSize="7.5" fill={EDGE}>
        <path
          d={`M${calloutX} ${calloutY}l16 -16`}
          fill="none"
          stroke={EDGE}
          strokeWidth="0.7"
          strokeDasharray="3 2"
        />
        <circle cx={calloutX} cy={calloutY} r="1.6" />
        <rect
          x={calloutX + 16}
          y={calloutY - 31}
          width="80"
          height="24"
          rx="2"
          fill="#f7f9f7"
          stroke={EDGE}
          strokeWidth="0.6"
        />
        <text x={calloutX + 20} y={calloutY - 21}>
          STILLHERE SENSOR
        </text>
        <text x={calloutX + 20} y={calloutY - 12} opacity=".7">
          {SENSOR_SIZE}
        </text>
        <g transform="translate(24 206)" strokeWidth="1.2" fontSize="6">
          <line x2="12" y2="7" stroke="#c0392b" />
          <line x2="-12" y2="7" stroke="#2e8b57" />
          <line y2="-14" stroke="#2c6fbb" />
          <text x="13" y="12" fill="#c0392b">
            X
          </text>
          <text x="-18" y="12" fill="#2e8b57">
            Y
          </text>
          <text x="-2" y="-16" fill="#2c6fbb">
            Z
          </text>
        </g>
        <line x1="6" y1="216" x2="314" y2="216" stroke="#cfd8d2" />
        <text x="48" y="228">
          {label}
        </text>
        <text x="306" y="228" textAnchor="end" opacity=".7">
          ISO VIEW
        </text>
      </g>
    </svg>
  );
}

export default function UseCases() {
  return (
    <>
      <div className="use-cases">
        {FIGURES.map((figure, index) => (
          <article key={figure.title}>
            <CadFigure figure={figure} index={index} />
            <h3>{figure.title}</h3>
            <p>{figure.body}</p>
          </article>
        ))}
      </div>
      <p className="use-cases-avoid">
        Skip spots that get wet, hot, or move on their own, like the shower, the stove, or a door
        that swings in a draft. The placement guide checks for these.
      </p>
    </>
  );
}
