import { verdict, type RankedPlacement } from "./placement";
import { boxFaces, iso, path, type Box, type Point } from "./UseCases";

// The placement ranking drawn as a 3D podium in the site's isometric CAD style: one block per
// idea, as tall as its score, with the tracker sitting on the winner. Ruled-out ideas lie flat.

// Top, left, and right face shades for each verdict. The verdict is also written under each
// block, so color is never the only signal.
const SHADES = {
  best: ["#8fd1a8", "#5fb382", "#3f8f61"],
  good: ["#cfe8d7", "#aed3ba", "#8ebd9e"],
  out: ["#e6e9e7", "#cfd4d1", "#b9bfbb"],
  tracker: ["#ffffff", "#eef1ee", "#d9dfda"],
};
const EDGE = "#33423b";
const SPACING = 92;
const SIZE = 46;
const FLAT = 6;
const PER_POINT = 6.5;

type Shade = keyof typeof SHADES;

function Solid({ box, shade }: { box: Box; shade: Shade }) {
  return (
    <g stroke={EDGE} strokeWidth={0.8} strokeLinejoin="round">
      {boxFaces(box).map((face, i) => (
        <path key={i} d={path(face)} fill={SHADES[shade][i]} />
      ))}
    </g>
  );
}

function shortName(name: string) {
  return name.length > 16 ? `${name.slice(0, 15)}…` : name;
}

export default function PlacementPodium({
  results,
  best,
}: {
  results: RankedPlacement[];
  best: RankedPlacement | undefined;
}) {
  const blocks = results.map((result, index) => {
    const shade: Shade = result.excluded
      ? "out"
      : result === best || (best && result.score === best.score)
        ? "best"
        : "good";
    const h = result.excluded ? FLAT : Math.max(FLAT * 2, result.score * PER_POINT);
    return { result, index, shade, box: { x: index * SPACING, y: 0, z: 0, w: SIZE, d: SIZE, h } };
  });
  const winner = blocks.find((block) => block.result === best);
  const tracker: Box | null = winner
    ? { x: winner.box.x + 13, y: 13, z: winner.box.h, w: 20, d: 20, h: 9 }
    : null;
  const ground: Box = {
    x: -12,
    y: -12,
    z: -4,
    w: (results.length - 1) * SPACING + SIZE + 24,
    d: SIZE + 24,
    h: 4,
  };
  // Labels sit under each block's front corner.
  const labels = blocks.map((block) => {
    // Under the block's front-left face, clear of the base.
    const [x, y] = iso(block.box.x + SIZE / 2, SIZE + 30, 0);
    return { block, x, y: y + 18 };
  });
  const corners: Point[] = [
    ...boxFaces(ground).flat(),
    ...blocks.flatMap((block) => boxFaces(block.box).flat()),
    ...(tracker ? boxFaces(tracker).flat() : []),
    ...labels.map(({ x, y }): Point => [x, y + 30]),
  ];
  const xs = corners.map(([x]) => x);
  const ys = corners.map(([, y]) => y);
  const pad = 18;
  const minX = Math.min(...xs) - pad - 40;
  const minY = Math.min(...ys) - pad;
  const width = Math.max(...xs) - minX + pad + 40;
  const height = Math.max(...ys) - minY + pad;
  const summary = results
    .map(
      (result, index) =>
        `${index + 1}. ${result.idea.name}: ${result.excluded ? "not a good spot" : result === best ? "best choice" : "also works"}`,
    )
    .join("; ");
  const lid = tracker ? iso(tracker.x + 10, tracker.y + 10, tracker.z + tracker.h) : null;
  return (
    <figure className="placement-podium">
      <svg
        viewBox={`${minX.toFixed(1)} ${minY.toFixed(1)} ${width.toFixed(1)} ${height.toFixed(1)}`}
        role="img"
        aria-label={`Placement ranking: ${summary}`}
      >
        <Solid box={ground} shade="out" />
        {/* Back to front, so nearer blocks overlap farther ones correctly. */}
        {blocks.map((block) => (
          <g
            key={block.result.idea.name}
            className="podium-block"
            style={{ animationDelay: `${block.index * 90}ms` }}
          >
            <Solid box={block.box} shade={block.shade} />
          </g>
        ))}
        {tracker && lid && (
          <g className="podium-tracker">
            <Solid box={tracker} shade="tracker" />
            <ellipse
              cx={lid[0]}
              cy={lid[1]}
              rx={7}
              ry={4}
              fill="#c8b98a"
              stroke={EDGE}
              strokeWidth={0.6}
            />
          </g>
        )}
        {labels.map(({ block, x, y }) => (
          <text
            key={block.result.idea.name}
            x={x}
            y={y}
            textAnchor="middle"
            className="podium-label"
          >
            <tspan x={x} className="podium-name">
              {block.index + 1}. {shortName(block.result.idea.name)}
            </tspan>
            <tspan x={x} dy={15} className={`podium-verdict podium-${block.shade}`}>
              {block.shade === "best" ? "★ " : ""}
              {verdict(block.result, best)}
            </tspan>
          </text>
        ))}
      </svg>
    </figure>
  );
}
