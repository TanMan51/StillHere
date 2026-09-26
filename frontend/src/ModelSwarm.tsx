import { useEffect, useRef } from "react";
import { loadModel } from "./IceScene";

// The case, lid, and Circuit Playground form the sensor's visible outside; sampling only their
// outward faces gives a clean silhouette instead of a jumble of inner walls and wiring.
const SHAPE_PARTS = new Set([0, 4, 5]);
const COUNT = 9000;
const ASSEMBLE_MS = 2600;
const MAX_DELAY_MS = 900;
// The big sensor holds the landing scene's pose (logo badge front left, board on top) and sways
// gently around it instead of spinning, so it always reads as the sensor.
const POSE_YAW = Math.PI - 0.65;
const SWAY = 0.3;
const SWAY_PERIOD_MS = 16000;
const TILT = 0.55;
const CAMERA_DISTANCE = 4.2;
// Tiny sensor width as a fraction of the big sensor's on-screen scale.
const TINY_SIZE = 0.042;
// Tiny sensors near the mouse lift off the big one along its surface, then settle back.
// Radius is a fraction of the big sensor's on-screen size; push is in model units.
const HOVER_RADIUS = 0.35;
const HOVER_PUSH = 0.45;
const HOVER_GROW = 1.5;
const HOVER_EASE = 0.12;
// Each tiny sensor is the real CAD mesh, pre-rendered once from this many turns around its axis.
const FRAMES = 48;
const FRAME_SIZE = 128;
const ATLAS_COLUMNS = 8;
const ATLAS_ROWS = FRAMES / ATLAS_COLUMNS;
// How far each tiny sensor is recolored to the CAD color of the spot it stands in for. High
// enough that together they paint the big sensor exactly; low enough to keep each one's detail.
const TINT_STRENGTH = 0.72;
// Same direction as the sprite shader's light, in view space.
const LIGHT = normalize([-0.45, 0.8, 0.55]);
// The mesh spans [-1, 1]; this frames its turning diagonal with a little margin.
const FRAME_ZOOM = 1 / 1.45;
// Per-instance floats uploaded each frame: x, y, depth, size, r, g, b, frame.
const STRIDE = 8;

type Vec3 = [number, number, number];

interface Surface {
  position: Vec3;
  normal: Vec3;
  color: Vec3;
}

interface Tiny extends Surface {
  start: Vec3;
  delay: number;
  // 0 at rest on the big sensor, 1 fully lifted off by the mouse.
  lift: number;
  spin: number;
  spinSpeed: number;
}

const spriteVertexShader = `#version 300 es
layout(location = 0) in vec3 position;
layout(location = 1) in vec3 normal;
layout(location = 2) in vec3 color;
layout(location = 3) in float material;
uniform mat3 view;
out vec3 vNormal;
out vec3 vColor;
out float vMaterial;
void main() {
  vec3 p = view * position;
  gl_Position = vec4(p.xy * ${FRAME_ZOOM}, -p.z * 0.4, 1.0);
  vNormal = view * normal;
  vColor = color;
  vMaterial = material;
}`;

const spriteFragmentShader = `#version 300 es
precision mediump float;
in vec3 vNormal;
in vec3 vColor;
in float vMaterial;
out vec4 outColor;
const vec3 light = vec3(${LIGHT.join(", ")});
void main() {
  vec3 n = normalize(vNormal);
  float diffuse = max(dot(n, light), 0.0);
  // Metal, glossy parts, and the printed case catch a highlight; matte parts barely do.
  float shine = vMaterial > 2.5 ? 0.18 : vMaterial > 1.5 ? 0.35 : vMaterial > 0.5 ? 0.6 : 0.05;
  float highlight = pow(max(dot(n, normalize(light + vec3(0.0, 0.0, 1.0))), 0.0), 32.0) * shine;
  outColor = vec4(vColor * (0.45 + 0.6 * diffuse) + highlight, 1.0);
}`;

const swarmVertexShader = `#version 300 es
layout(location = 0) in vec2 corner;
layout(location = 1) in vec4 place;
layout(location = 2) in vec4 paint;
uniform vec2 viewport;
out vec2 vUv;
out vec3 vColor;
void main() {
  vec2 pixel = place.xy + corner * place.w;
  vec2 clip = pixel / viewport * 2.0 - 1.0;
  gl_Position = vec4(clip.x, -clip.y, place.z, 1.0);
  vec2 cell = vec2(mod(paint.w, ${ATLAS_COLUMNS}.0), floor(paint.w / ${ATLAS_COLUMNS}.0));
  vUv = (cell + corner + 0.5) / vec2(${ATLAS_COLUMNS}.0, ${ATLAS_ROWS}.0);
  vColor = paint.rgb;
}`;

const swarmFragmentShader = `#version 300 es
precision mediump float;
in vec2 vUv;
in vec3 vColor;
uniform sampler2D atlas;
out vec4 outColor;
void main() {
  vec4 sprite = texture(atlas, vUv);
  if (sprite.a < 0.5) discard;
  outColor = vec4(mix(sprite.rgb / sprite.a, vColor, ${TINT_STRENGTH}), 1.0);
}`;

/** Column-major view rotation: turn about the vertical axis, then tilt toward the viewer. */
function viewMatrix(yaw: number, pitch: number) {
  const [cy, sy, cp, sp] = [Math.cos(yaw), Math.sin(yaw), Math.cos(pitch), Math.sin(pitch)];
  return [cy, sy * sp, -sy * cp, 0, cp, sp, sy, -cy * sp, cy * cp];
}

function program(gl: WebGL2RenderingContext, vertex: string, fragment: string) {
  const linked = gl.createProgram();
  for (const [type, source] of [
    [gl.VERTEX_SHADER, vertex],
    [gl.FRAGMENT_SHADER, fragment],
  ] as const) {
    const shader = gl.createShader(type);
    if (!shader) throw new Error("tiny sensors: could not create shader");
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS))
      throw new Error(`tiny sensors: ${gl.getShaderInfoLog(shader)}`);
    gl.attachShader(linked, shader);
  }
  gl.linkProgram(linked);
  if (!gl.getProgramParameter(linked, gl.LINK_STATUS))
    throw new Error(`tiny sensors: ${gl.getProgramInfoLog(linked)}`);
  return linked;
}

/** Renders the full sensor mesh once per turn step into a sprite sheet. */
function renderAtlas(vertices: ArrayBuffer, indices: Uint32Array) {
  const render = FRAME_SIZE * 2;
  const glCanvas = document.createElement("canvas");
  glCanvas.width = glCanvas.height = render;
  const gl = glCanvas.getContext("webgl2", { antialias: true, preserveDrawingBuffer: true });
  const atlas = document.createElement("canvas");
  atlas.width = ATLAS_COLUMNS * FRAME_SIZE;
  atlas.height = ATLAS_ROWS * FRAME_SIZE;
  const sheet = atlas.getContext("2d");
  if (!gl || !sheet) throw new Error("tiny sensors: WebGL2 unavailable");

  gl.useProgram(program(gl, spriteVertexShader, spriteFragmentShader));
  gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
  gl.bufferData(gl.ARRAY_BUFFER, vertices, gl.STATIC_DRAW);
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, gl.createBuffer());
  gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, indices, gl.STATIC_DRAW);
  // Vertex layout from scripts/build-model.mjs: int16 xyz, int8 normal + material, uint8 rgb.
  const attributes: [number, number, number, boolean, number][] = [
    [0, 3, gl.SHORT, true, 0],
    [1, 3, gl.BYTE, true, 8],
    [2, 3, gl.UNSIGNED_BYTE, true, 12],
    [3, 1, gl.BYTE, false, 11],
  ];
  for (const [location, size, type, normalized, offset] of attributes) {
    gl.enableVertexAttribArray(location);
    gl.vertexAttribPointer(location, size, type, normalized, 16, offset);
  }
  const view = gl.getUniformLocation(gl.getParameter(gl.CURRENT_PROGRAM), "view");
  gl.enable(gl.DEPTH_TEST);
  gl.viewport(0, 0, render, render);
  gl.clearColor(0, 0, 0, 0);

  for (let frame = 0; frame < FRAMES; frame++) {
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.uniformMatrix3fv(view, false, viewMatrix((frame / FRAMES) * Math.PI * 2, TILT));
    gl.drawElements(gl.TRIANGLES, indices.length, gl.UNSIGNED_INT, 0);
    const x = (frame % ATLAS_COLUMNS) * FRAME_SIZE;
    const y = Math.floor(frame / ATLAS_COLUMNS) * FRAME_SIZE;
    sheet.drawImage(glCanvas, 0, 0, render, render, x, y, FRAME_SIZE, FRAME_SIZE);
  }
  gl.getExtension("WEBGL_lose_context")?.loseContext();
  return atlas;
}

/** Sets up instanced drawing of every tiny sensor in one call. */
function createRenderer(gl: WebGL2RenderingContext, atlas: HTMLCanvasElement, count: number) {
  const swarm = program(gl, swarmVertexShader, swarmFragmentShader);
  gl.useProgram(swarm);
  gl.bindVertexArray(gl.createVertexArray());

  gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
  gl.bufferData(
    gl.ARRAY_BUFFER,
    new Float32Array([-0.5, -0.5, 0.5, -0.5, -0.5, 0.5, 0.5, 0.5]),
    gl.STATIC_DRAW,
  );
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

  const instances = new Float32Array(count * STRIDE);
  gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
  gl.bufferData(gl.ARRAY_BUFFER, instances.byteLength, gl.DYNAMIC_DRAW);
  for (const [location, offset] of [
    [1, 0],
    [2, 4],
  ]) {
    gl.enableVertexAttribArray(location);
    gl.vertexAttribPointer(location, 4, gl.FLOAT, false, STRIDE * 4, offset * 4);
    gl.vertexAttribDivisor(location, 1);
  }

  gl.bindTexture(gl.TEXTURE_2D, gl.createTexture());
  // Premultiplied so mipmaps don't pick up dark fringes from the transparent margins.
  gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, atlas);
  gl.generateMipmap(gl.TEXTURE_2D);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  const viewport = gl.getUniformLocation(swarm, "viewport");
  gl.enable(gl.DEPTH_TEST);
  gl.clearColor(0, 0, 0, 0);

  return {
    instances,
    draw(width: number, height: number) {
      gl.viewport(0, 0, width, height);
      gl.uniform2f(viewport, width, height);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, instances);
      gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, count);
    },
  };
}

/** Small seeded generator so the formation is the same on every visit. */
function seeded(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Evenly spread points over the outside: area-weighted picks, rejecting any that crowd another. */
function sampleSurface(
  vertices: ArrayBuffer,
  indices: Uint32Array,
  random: () => number,
): Surface[] {
  const positions = new Int16Array(vertices);
  const bytes = new Uint8Array(vertices);
  const normals = new Int8Array(vertices);
  const point = (i: number): Vec3 => [
    positions[i * 8] / 32767,
    positions[i * 8 + 1] / 32767,
    positions[i * 8 + 2] / 32767,
  ];
  const normalOf = (i: number): Vec3 => [
    normals[i * 16 + 8],
    normals[i * 16 + 9],
    normals[i * 16 + 10],
  ];
  const colorOf = (i: number): Vec3 => [
    bytes[i * 16 + 12] / 255,
    bytes[i * 16 + 13] / 255,
    bytes[i * 16 + 14] / 255,
  ];
  let low = Infinity;
  let high = -Infinity;
  for (let i = 0; i < positions.length / 8; i++) {
    if (!SHAPE_PARTS.has(bytes[i * 16 + 15])) continue;
    low = Math.min(low, positions[i * 8 + 1] / 32767);
    high = Math.max(high, positions[i * 8 + 1] / 32767);
  }
  const middle = (low + high) / 2;
  const triangles: { corners: Vec3[]; normal: Vec3; color: Vec3 }[] = [];
  const cumulative: number[] = [];
  let total = 0;
  for (let t = 0; t < indices.length; t += 3) {
    const corners = [indices[t], indices[t + 1], indices[t + 2]];
    if (!corners.every((i) => SHAPE_PARTS.has(bytes[i * 16 + 15]))) continue;
    const [a, b, c] = corners.map(point);
    const normal = normalize(corners.map(normalOf).reduce(add));
    const centroid: Vec3 = [
      (a[0] + b[0] + c[0]) / 3,
      (a[1] + b[1] + c[1]) / 3 - middle,
      (a[2] + b[2] + c[2]) / 3,
    ];
    // Inner walls and undersides face the middle of the sensor; skip them.
    if (dot(normal, centroid) <= 0) continue;
    const area = Math.hypot(...cross(sub(b, a), sub(c, a))) / 2;
    if (area === 0) continue;
    total += area;
    triangles.push({ corners: [a, b, c], normal, color: colorOf(corners[0]) });
    cumulative.push(total);
  }
  const spacing = Math.sqrt(total / COUNT) * 0.75;
  const picked: Surface[] = [];
  // Points bucketed by spacing-sized cells, so each candidate only checks its 27 neighbors.
  const grid = new Map<number, Vec3[]>();
  const cellOf = (p: Vec3) => p.map((x) => Math.floor(x / spacing) + 512);
  const key = (x: number, y: number, z: number) => (x * 1024 + y) * 1024 + z;
  const crowded = (p: Vec3) => {
    const [cx, cy, cz] = cellOf(p);
    for (let dx = -1; dx <= 1; dx++)
      for (let dy = -1; dy <= 1; dy++)
        for (let dz = -1; dz <= 1; dz++)
          for (const q of grid.get(key(cx + dx, cy + dy, cz + dz)) ?? [])
            if (distanceSquared(p, q) < spacing * spacing) return true;
    return false;
  };
  for (let tries = 0; picked.length < COUNT && tries < COUNT * 30; tries++) {
    const triangle = triangles[search(cumulative, random() * total)];
    const [a, b, c] = triangle.corners;
    let u = random();
    let v = random();
    if (u + v > 1) [u, v] = [1 - u, 1 - v];
    const p: Vec3 = [0, 1, 2].map((j) => a[j] + u * (b[j] - a[j]) + v * (c[j] - a[j])) as Vec3;
    p[1] -= middle;
    if (crowded(p)) continue;
    const cell = key(...(cellOf(p) as Vec3));
    grid.set(cell, [...(grid.get(cell) ?? []), p]);
    picked.push({ position: p, normal: triangle.normal, color: triangle.color });
  }
  return picked;
}

/** Thousands of tiny sensors drifting in to form one big sensor behind the dashboard. */
export default function ModelSwarm() {
  const canvas = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const element = canvas.current;
    const gl = element?.getContext("webgl2", { antialias: true });
    if (!element || !gl) return;
    const motion = !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const pointer = { x: 0, y: 0, targetX: 0, targetY: 0, clientX: 0, clientY: 0, over: false };
    let renderer: ReturnType<typeof createRenderer> | null = null;
    let tinies: Tiny[] = [];
    let startedAt = 0;
    let frame = 0;
    let cancelled = false;

    function resize() {
      if (!element) return;
      const ratio = Math.min(2, window.devicePixelRatio || 1);
      element.width = Math.round(window.innerWidth * ratio);
      element.height = Math.round(window.innerHeight * ratio);
    }

    function draw(now: number) {
      if (!element || !renderer) return;
      const elapsed = motion ? now - startedAt : Infinity;
      const width = element.width;
      const height = element.height;
      const wide = width > height * 1.2;
      const centerX = width * (wide ? 0.66 : 0.5);
      const centerY = height * 0.56;
      const scale = Math.min(width, height) * (wide ? 0.3 : 0.28);
      pointer.x += (pointer.targetX - pointer.x) * 0.04;
      pointer.y += (pointer.targetY - pointer.y) * 0.04;
      const sway = motion ? Math.sin((now / SWAY_PERIOD_MS) * Math.PI * 2) * SWAY : 0;
      const yaw = POSE_YAW + sway + pointer.x * 0.35;
      const pitch = TILT + pointer.y * 0.15;
      const [cy, sy, cp, sp] = [Math.cos(yaw), Math.sin(yaw), Math.cos(pitch), Math.sin(pitch)];
      const view = ([x0, y0, z0]: Vec3): Vec3 => {
        const z1 = -x0 * sy + z0 * cy;
        return [x0 * cy + z0 * sy, y0 * cp - z1 * sp, y0 * sp + z1 * cp];
      };
      const ratio = width / window.innerWidth;
      const radius = scale * HOVER_RADIUS;
      const pointerX = pointer.clientX * ratio;
      const pointerY = pointer.clientY * ratio;
      const size = scale * TINY_SIZE;
      const out = renderer.instances;

      tinies.forEach((tiny, i) => {
        const t = ease((elapsed - tiny.delay) / ASSEMBLE_MS);
        const home: Vec3 = [
          tiny.start[0] + (tiny.position[0] - tiny.start[0]) * t,
          tiny.start[1] + (tiny.position[1] - tiny.start[1]) * t,
          tiny.start[2] + (tiny.position[2] - tiny.start[2]) * t,
        ];
        let [x, y, z] = view(home);
        let depth = perspective(z);
        // Measure closeness from the resting spot so a lifted sensor can't chase the mouse.
        const restX = centerX + x * depth * scale;
        const restY = centerY - y * depth * scale;
        const near =
          pointer.over && t === 1
            ? smoothstep(1 - Math.hypot(restX - pointerX, restY - pointerY) / radius)
            : 0;
        tiny.lift += (near - tiny.lift) * HOVER_EASE;
        if (tiny.lift > 0.001) {
          const push = tiny.lift * HOVER_PUSH;
          [x, y, z] = view([
            home[0] + tiny.normal[0] * push,
            home[1] + tiny.normal[1] * push,
            home[2] + tiny.normal[2] * push,
          ]);
          depth = perspective(z);
        }
        const normal = view(tiny.normal);
        // Once landed, sensors on the far side hide, like the back of a solid object.
        const hidden = t === 1 && tiny.lift < 0.05 && normal[2] < -0.05;
        const [r, g, b] = lightColor(tiny.color, normal);
        const turn = yaw + tiny.spin + (motion ? (now / 1000) * tiny.spinSpeed : 0);
        const step = Math.round((turn / (Math.PI * 2)) * FRAMES);
        const o = i * STRIDE;
        out[o] = centerX + x * depth * scale;
        out[o + 1] = centerY - y * depth * scale;
        out[o + 2] = Math.min(1, Math.max(-1, -z / 6));
        out[o + 3] = hidden ? 0 : size * depth * (1 + tiny.lift * HOVER_GROW);
        out[o + 4] = r;
        out[o + 5] = g;
        out[o + 6] = b;
        out[o + 7] = ((step % FRAMES) + FRAMES) % FRAMES;
      });
      renderer.draw(width, height);
      if (motion) frame = requestAnimationFrame(draw);
    }

    function redraw() {
      resize();
      if (!motion) draw(0);
    }
    function follow(event: PointerEvent) {
      pointer.targetX = event.clientX / window.innerWidth - 0.5;
      pointer.targetY = event.clientY / window.innerHeight - 0.5;
      pointer.clientX = event.clientX;
      pointer.clientY = event.clientY;
      pointer.over = event.pointerType === "mouse";
    }
    function leave() {
      pointer.over = false;
    }

    loadModel()
      .then(({ vertices, indices }) => {
        if (cancelled) return;
        const random = seeded(7);
        tinies = sampleSurface(vertices, indices, random).map((surface) => {
          const angle = random() * Math.PI * 2;
          const rise = random() * 2 - 1;
          const reach = 2.5 + random() * 2;
          const ring = Math.sqrt(1 - rise * rise) * reach;
          return {
            ...surface,
            start: [Math.cos(angle) * ring, rise * reach, Math.sin(angle) * ring],
            delay: random() * MAX_DELAY_MS,
            lift: 0,
            spin: random() * Math.PI * 2,
            spinSpeed: (random() - 0.5) * 0.4,
          };
        });
        renderer = createRenderer(gl, renderAtlas(vertices, indices), tinies.length);
        resize();
        startedAt = performance.now();
        if (motion) frame = requestAnimationFrame(draw);
        else draw(0);
      })
      .catch(() => {
        // The background is decoration; without the model or WebGL2 the dashboard stays plain.
      });

    window.addEventListener("resize", redraw);
    if (motion) {
      window.addEventListener("pointermove", follow);
      document.documentElement.addEventListener("pointerleave", leave);
    }
    return () => {
      cancelled = true;
      cancelAnimationFrame(frame);
      window.removeEventListener("resize", redraw);
      window.removeEventListener("pointermove", follow);
      document.documentElement.removeEventListener("pointerleave", leave);
    };
  }, []);

  return <canvas ref={canvas} className="model-swarm" aria-hidden="true" />;
}

/**
 * A simplified version of the landing scene's lighting (sceneShader.ts): key light plus sky fill
 * in linear color, ACES tone mapping, then back to sRGB, so the big sensor matches the CAD render.
 */
function lightColor(color: Vec3, normal: Vec3): Vec3 {
  const direct = Math.max(0, dot(normal, LIGHT)) * (3.4 / Math.PI);
  const sky = 0.3 + 0.6 * (normal[1] * 0.5 + 0.5);
  return color.map((c) => {
    const x = Math.pow(c, 2.2) * (direct + sky) * 1.15;
    const toned = (x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14);
    return Math.pow(Math.min(1, toned), 1 / 2.2);
  }) as Vec3;
}

/** Screen scale for a point at view depth z; clamped so sensors flying past the camera stay sane. */
function perspective(z: number) {
  return CAMERA_DISTANCE / Math.max(1.5, CAMERA_DISTANCE - z);
}
function smoothstep(x: number) {
  const t = Math.min(1, Math.max(0, x));
  return t * t * (3 - 2 * t);
}
function ease(x: number) {
  const t = Math.min(1, Math.max(0, x));
  return 1 - Math.pow(1 - t, 3);
}
function search(cumulative: number[], value: number) {
  let low = 0;
  let high = cumulative.length - 1;
  while (low < high) {
    const middle = (low + high) >> 1;
    if (cumulative[middle] < value) low = middle + 1;
    else high = middle;
  }
  return low;
}
function add(a: Vec3, b: Vec3): Vec3 {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}
function sub(a: Vec3, b: Vec3): Vec3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}
function dot(a: Vec3, b: Vec3) {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}
function cross(a: Vec3, b: Vec3): Vec3 {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}
function normalize(v: Vec3): Vec3 {
  const length = Math.hypot(...v) || 1;
  return [v[0] / length, v[1] / length, v[2] / length];
}
function distanceSquared(a: Vec3, b: Vec3) {
  return (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2;
}
