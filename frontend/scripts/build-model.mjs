// Converts the StillHere CAD export (OBJ + MTL) into public/models/sensor.bin for the landing
// scene. Run from frontend/:  node scripts/build-model.mjs <folder with the OBJ files>
//
// The exploded OBJ shifts each part cluster along +X. We keep that order (base, battery, Pico,
// wires, Circuit Playground, lid) as a per-vertex "layer" and explode vertically in the shader.
//
// Layout (little endian): "SH3D", uint32 vertexCount, uint32 indexCount, float32 radius,
// then 16-byte vertices [int16 x,y,z,pad | int8 nx,ny,nz,material | uint8 r,g,b,layer], then uint32
// indices. Positions are Y-up, centered, and normalized to [-1, 1] (multiply by radius).
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const source = process.argv[2];
if (!source) {
  console.error("Usage: node scripts/build-model.mjs <folder with StillHere_Assembled.obj>");
  process.exit(1);
}

// Shading families the scene lights differently: 0 matte, 1 metal, 2 glossy
// (solder mask, chips, wire insulation), 3 the printed case.
function materialKind(name, [r, g, b]) {
  if (/Case|Nylon/.test(name)) return 3;
  if (/Foil|Steel/.test(name)) return 1;
  const grey = Math.abs(r - g) < 0.02 && Math.abs(g - b) < 0.02;
  if (grey && r >= 0.58 && r <= 0.81) return 1;
  if (/Kapton|Lead|wire/.test(name) || Math.max(r, g, b) < 0.43) return 2;
  return 0;
}

function parseMtl(text) {
  const colors = {};
  let name = "";
  for (const line of text.split("\n")) {
    const [key, ...rest] = line.trim().split(/\s+/);
    if (key === "newmtl") name = rest.join(" ");
    if (key === "Kd") colors[name] = rest.map(Number);
  }
  return colors;
}

function parseObj(text) {
  const positions = [];
  const normals = [];
  const faces = [];
  const groupOf = [];
  let group = "";
  let material = "";
  for (const line of text.split("\n")) {
    const parts = line.trim().split(/\s+/);
    if (parts[0] === "v") positions.push(parts.slice(1, 4).map(Number));
    else if (parts[0] === "vn") normals.push(parts.slice(1, 4).map(Number));
    else if (parts[0] === "g") group = parts.slice(1).join(" ");
    else if (parts[0] === "usemtl") material = parts.slice(1).join(" ");
    else if (parts[0] === "f") {
      const corners = parts.slice(1).map((token) => {
        const [v, , n] = token.split("/").map((x) => (x ? Number(x) - 1 : -1));
        return { v, n };
      });
      for (let i = 1; i + 1 < corners.length; i++)
        faces.push({ corners: [corners[0], corners[i], corners[i + 1]], material });
    }
    if (parts[0] === "v") groupOf.push(group);
  }
  return { positions, normals, faces, groupOf };
}

const read = (name) => readFile(path.join(source, name), "utf8");
const colors = parseMtl(await read("StillHere_Assembled.mtl"));
const assembled = parseObj(await read("StillHere_Assembled.obj"));
const exploded = parseObj(await read("StillHere_Exploded.obj"));

// Rank each part cluster by how far the exploded view moved it.
const shift = assembled.positions.map((p, i) => exploded.positions[i][0] - p[0]);
const distinct = [...new Set(shift.map((x) => x.toFixed(2)))].map(Number).sort((a, b) => a - b);
const layer = shift.map((x) => distinct.indexOf(Number(x.toFixed(2))));

// CAD is Z-up; the scene is Y-up.
const toScene = ([x, y, z]) => [x, z, -y];
const scene = assembled.positions.map(toScene);
const min = [0, 1, 2].map((i) => Math.min(...scene.map((p) => p[i])));
const max = [0, 1, 2].map((i) => Math.max(...scene.map((p) => p[i])));
const center = min.map((m, i) => (m + max[i]) / 2);
const radius = Math.max(...max.map((m, i) => (m - min[i]) / 2));

const vertices = [];
const indices = [];
const seen = new Map();
for (const face of assembled.faces) {
  const [a, b, c] = face.corners.map((corner) => scene[corner.v]);
  const flat = normalize(cross(sub(b, a), sub(c, a)));
  for (const corner of face.corners) {
    const key = `${corner.v}/${corner.n}/${face.material}`;
    let index = seen.get(key);
    if (index === undefined) {
      index = vertices.length;
      seen.set(key, index);
      const normal = corner.n >= 0 ? normalize(toScene(assembled.normals[corner.n])) : flat;
      vertices.push({
        position: scene[corner.v].map((x, i) => (x - center[i]) / radius),
        normal,
        color: colors[face.material] ?? [0.8, 0.8, 0.8],
        material: materialKind(face.material, colors[face.material] ?? [0.8, 0.8, 0.8]),
        layer: layer[corner.v],
      });
    }
    indices.push(index);
  }
}

const header = 16;
const buffer = Buffer.alloc(header + vertices.length * 16 + indices.length * 4);
buffer.write("SH3D", 0, "ascii");
buffer.writeUInt32LE(vertices.length, 4);
buffer.writeUInt32LE(indices.length, 8);
buffer.writeFloatLE(radius, 12);
vertices.forEach((vertex, i) => {
  const at = header + i * 16;
  vertex.position.forEach((x, j) => buffer.writeInt16LE(Math.round(x * 32767), at + j * 2));
  vertex.normal.forEach((x, j) => buffer.writeInt8(Math.round(x * 127), at + 8 + j));
  buffer.writeInt8(vertex.material, at + 11);
  vertex.color.forEach((x, j) => buffer.writeUInt8(Math.round(x * 255), at + 12 + j));
  buffer.writeUInt8(vertex.layer, at + 15);
});
indices.forEach((index, i) => buffer.writeUInt32LE(index, header + vertices.length * 16 + i * 4));

const output = path.join("public", "models", "sensor.bin");
await mkdir(path.dirname(output), { recursive: true });
await writeFile(output, buffer);
console.log(
  `${output}: ${vertices.length} vertices, ${indices.length / 3} triangles, ` +
    `${distinct.length} layers, ${(buffer.length / 1e6).toFixed(1)} MB`,
);

function sub(a, b) {
  return a.map((x, i) => x - b[i]);
}
function cross(a, b) {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}
function normalize(v) {
  const length = Math.hypot(...v) || 1;
  return v.map((x) => x / length);
}
