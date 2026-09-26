import { useEffect, useRef, useState } from "react";
import Heartbeat from "./Heartbeat";
import {
  depthFragmentShader,
  depthVertexShader,
  floorFragmentShader,
  floorVertexShader,
  meshFragmentShader,
  meshVertexShader,
} from "./sceneShader";

// Matches the page background (#f7f8f3) so the sensor sits on the site, not in a box.
const BACKDROP = [0xf7 / 255, 0xf8 / 255, 0xf3 / 255] as const;
// Bottom to top, in the order the exploded CAD view lays them out.
const PARTS = [
  { name: "Case", detail: "Printed shell that mounts on an everyday object" },
  { name: "LiPo battery", detail: "Rechargeable cell that powers the sensor" },
  { name: "Raspberry Pi Pico W", detail: "Sends activity to StillHere over Wi-Fi" },
  { name: "Wiring", detail: "Power and a serial link between the two boards" },
  { name: "Circuit Playground Express", detail: "Detects motion and sound" },
  { name: "Lid", detail: "Closes the case around the Circuit Playground" },
];
// Pinned-scroll timeline, as fractions of the hero's scroll track.
const LIFT_END = 0.2;
const TURN_END = 0.38;
const SPREAD_END = 0.6;
const REJOIN_START = 0.7;
// After the parts rejoin, the sensor turns back and settles into its starting pose.
const RETURN_START = 0.82;
const FLOAT_HEIGHT = 0.45;
// Spacing between part centers when spread out: a row on wide screens, a column on narrow.
const ROW_GAP = 1.2;
const COLUMN_GAP = 1.35;
// The camera's resting direction around the model.
const VIEW_ANGLE = 0.65;
// How far apart parts sit when taken apart, in model radii, and how staggered they move.
const PART_GAP = 0.46;
const PART_STAGGER = 0.09;
const PART_DURATION = 0.6;
const SHADOW_SIZE = 2048;
const LIGHT = normalize([-0.35, 1, 0.45]);

type Vec3 = [number, number, number];
type Mat4 = number[];
type Mat3 = number[];

interface SensorModel {
  vertices: ArrayBuffer;
  indices: Uint32Array;
  floor: number;
  top: number;
  centers: Vec3[];
}

// Fetched once per page load; toggling motion re-creates the GL objects, not the download.
let modelRequest: Promise<SensorModel> | null = null;
function loadModel() {
  modelRequest ??= fetch("/models/sensor.bin")
    .then((response) => {
      if (!response.ok) throw new Error(`sensor model: HTTP ${response.status}`);
      return response.arrayBuffer();
    })
    .then((data) => {
      const view = new DataView(data);
      const vertexCount = view.getUint32(4, true);
      const indexCount = view.getUint32(8, true);
      const vertices = data.slice(16, 16 + vertexCount * 16);
      const positions = new Int16Array(vertices);
      const bytes = new Uint8Array(vertices);
      // Each part's center is the middle of its bounding box, so lopsided parts (a battery
      // with its leads, a board with its USB port) still line up by their visual middle.
      const low = PARTS.map(() => [Infinity, Infinity, Infinity]);
      const high = PARTS.map(() => [-Infinity, -Infinity, -Infinity]);
      let floor = 1;
      let top = -1;
      for (let i = 0; i < vertexCount; i++) {
        const part = bytes[i * 16 + 15];
        for (let j = 0; j < 3; j++) {
          const x = positions[i * 8 + j] / 32767;
          low[part][j] = Math.min(low[part][j], x);
          high[part][j] = Math.max(high[part][j], x);
        }
        floor = Math.min(floor, positions[i * 8 + 1] / 32767);
        top = Math.max(top, positions[i * 8 + 1] / 32767);
      }
      const centers = low.map((min, part) => min.map((x, j) => (x + high[part][j]) / 2) as Vec3);
      const indices = new Uint32Array(data, 16 + vertexCount * 16, indexCount);
      return { vertices, indices, floor, top, centers };
    });
  modelRequest.catch(() => (modelRequest = null));
  return modelRequest;
}

function perspective(fovY: number, aspect: number, near: number, far: number): Mat4 {
  const f = 1 / Math.tan(fovY / 2);
  const range = 1 / (near - far);
  // prettier-ignore
  return [f / aspect, 0, 0, 0, 0, f, 0, 0, 0, 0, (far + near) * range, -1, 0, 0, 2 * far * near * range, 0];
}
function orthographic(half: number, near: number, far: number): Mat4 {
  // prettier-ignore
  return [1 / half, 0, 0, 0, 0, 1 / half, 0, 0, 0, 0, -2 / (far - near), 0, 0, 0, -(far + near) / (far - near), 1];
}
function lookAt(eye: Vec3, target: Vec3): Mat4 {
  const z = normalize([eye[0] - target[0], eye[1] - target[1], eye[2] - target[2]]);
  const x = normalize(cross([0, 1, 0], z));
  const y = cross(z, x);
  const dot = (a: Vec3) => a[0] * eye[0] + a[1] * eye[1] + a[2] * eye[2];
  // prettier-ignore
  return [x[0], y[0], z[0], 0, x[1], y[1], z[1], 0, x[2], y[2], z[2], 0, -dot(x), -dot(y), -dot(z), 1];
}
function multiply(a: Mat4, b: Mat4): Mat4 {
  const out = new Array<number>(16).fill(0);
  for (let col = 0; col < 4; col++)
    for (let row = 0; row < 4; row++)
      for (let k = 0; k < 4; k++) out[col * 4 + row] += a[k * 4 + row] * b[col * 4 + k];
  return out;
}
function project(m: Mat4, [x, y, z]: Vec3) {
  const w = m[3] * x + m[7] * y + m[11] * z + m[15];
  return [
    (m[0] * x + m[4] * y + m[8] * z + m[12]) / w,
    (m[1] * x + m[5] * y + m[9] * z + m[13]) / w,
  ];
}
/** Column-major rotation about a unit axis (Rodrigues). */
function rotation(axis: Vec3, angle: number): Mat3 {
  const [x, y, z] = axis;
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  const t = 1 - c;
  // prettier-ignore
  return [
    t * x * x + c, t * x * y + s * z, t * x * z - s * y,
    t * x * y - s * z, t * y * y + c, t * y * z + s * x,
    t * x * z + s * y, t * y * z - s * x, t * z * z + c,
  ];
}
function multiply3(a: Mat3, b: Mat3): Mat3 {
  const out = new Array<number>(9).fill(0);
  for (let col = 0; col < 3; col++)
    for (let row = 0; row < 3; row++)
      for (let k = 0; k < 3; k++) out[col * 3 + row] += a[k * 3 + row] * b[col * 3 + k];
  return out;
}
function apply3(m: Mat3, [x, y, z]: Vec3): Vec3 {
  return [
    m[0] * x + m[3] * y + m[6] * z,
    m[1] * x + m[4] * y + m[7] * z,
    m[2] * x + m[5] * y + m[8] * z,
  ];
}
function add(a: Vec3, b: Vec3): Vec3 {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}
function cross(a: Vec3, b: Vec3): Vec3 {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}
function normalize(v: Vec3): Vec3 {
  const length = Math.hypot(...v) || 1;
  return [v[0] / length, v[1] / length, v[2] / length];
}
function smoothstep(x: number) {
  const t = Math.min(1, Math.max(0, x));
  return t * t * (3 - 2 * t);
}

/** 0 at the top of the landing hero, 1 once its pinned scroll track is used up. */
function heroProgress() {
  const hero = document.querySelector<HTMLElement>(".landing-hero");
  if (!hero) return 0;
  const rect = hero.getBoundingClientRect();
  const track = rect.height - window.innerHeight;
  return track > 0 ? Math.min(1, Math.max(0, -rect.top / track)) : 0;
}

export default function IceScene() {
  const canvas = useRef<HTMLCanvasElement>(null);
  const labels = useRef<(HTMLSpanElement | null)[]>([]);
  const scene = useRef<HTMLDivElement>(null);
  const hint = useRef<HTMLSpanElement>(null);
  const [motion, setMotion] = useState(
    () => !window.matchMedia("(prefers-reduced-motion: reduce)").matches,
  );
  const [ready, setReady] = useState(false);
  const [apart, setApart] = useState(false);
  const apartRef = useRef(apart);
  apartRef.current = apart;
  // Where in the hero's scroll track the sensor was taken apart.
  const apartScrollRef = useRef(0);
  useEffect(() => {
    if (apart) apartScrollRef.current = heroProgress();
  }, [apart]);

  useEffect(() => {
    const preference = window.matchMedia("(prefers-reduced-motion: reduce)");
    const change = () => setMotion(!preference.matches);
    preference.addEventListener("change", change);
    return () => preference.removeEventListener("change", change);
  }, []);

  useEffect(() => {
    document.documentElement.toggleAttribute("data-sensor-apart", apart);
    return () => document.documentElement.removeAttribute("data-sensor-apart");
  }, [apart]);

  useEffect(() => {
    const element = canvas.current;
    const gl = element?.getContext("webgl", {
      alpha: true,
      antialias: true,
      powerPreference: "high-performance",
    });
    if (!gl || !element || !gl.getExtension("OES_element_index_uint")) return;
    const shaders: WebGLShader[] = [];
    const programs: WebGLProgram[] = [];
    const buffers: WebGLBuffer[] = [];
    function build(vertexSource: string, fragmentSource: string) {
      const program = gl!.createProgram()!;
      programs.push(program);
      for (const [type, source] of [
        [gl!.VERTEX_SHADER, vertexSource],
        [gl!.FRAGMENT_SHADER, fragmentSource],
      ] as const) {
        const shader = gl!.createShader(type)!;
        shaders.push(shader);
        gl!.shaderSource(shader, source);
        gl!.compileShader(shader);
        gl!.attachShader(program, shader);
      }
      gl!.linkProgram(program);
      return gl!.getProgramParameter(program, gl!.LINK_STATUS) ? program : null;
    }
    const shadowTexture = gl.createTexture();
    const shadowDepth = gl.createRenderbuffer();
    const shadowFramebuffer = gl.createFramebuffer();
    function cleanup() {
      buffers.forEach((buffer) => gl!.deleteBuffer(buffer));
      programs.forEach((program) => gl!.deleteProgram(program));
      shaders.forEach((shader) => gl!.deleteShader(shader));
      gl!.deleteTexture(shadowTexture);
      gl!.deleteRenderbuffer(shadowDepth);
      gl!.deleteFramebuffer(shadowFramebuffer);
    }
    const mesh = build(meshVertexShader, meshFragmentShader);
    const depth = build(depthVertexShader, depthFragmentShader);
    const floorProgram = build(floorVertexShader, floorFragmentShader);
    if (!mesh || !depth || !floorProgram) {
      cleanup();
      return;
    }

    gl.bindTexture(gl.TEXTURE_2D, shadowTexture);
    // prettier-ignore
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, SHADOW_SIZE, SHADOW_SIZE, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    for (const [key, value] of [
      [gl.TEXTURE_MIN_FILTER, gl.NEAREST],
      [gl.TEXTURE_MAG_FILTER, gl.NEAREST],
      [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE],
      [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE],
    ])
      gl.texParameteri(gl.TEXTURE_2D, key, value);
    gl.bindRenderbuffer(gl.RENDERBUFFER, shadowDepth);
    gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT16, SHADOW_SIZE, SHADOW_SIZE);
    gl.bindFramebuffer(gl.FRAMEBUFFER, shadowFramebuffer);
    // prettier-ignore
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, shadowTexture, 0);
    // prettier-ignore
    gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, shadowDepth);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);

    const at = (program: WebGLProgram, name: string) => gl.getUniformLocation(program, name);
    const passes = [depth, mesh].map((program) => ({
      program,
      attributes: (["position", "normal", "color"] as const).map((name, i) => ({
        location: gl.getAttribLocation(program, name),
        type: [gl.SHORT, gl.BYTE, gl.UNSIGNED_BYTE][i],
        offset: [0, 8, 12][i],
      })),
      offsets: at(program, "offsets"),
      rotation: at(program, "rotation"),
      lightViewProjection: at(program, "lightViewProjection"),
    }));
    const floorUniforms = {
      viewProjection: at(floorProgram, "viewProjection"),
      lightViewProjection: at(floorProgram, "lightViewProjection"),
      floorY: at(floorProgram, "floorY"),
      size: at(floorProgram, "size"),
      contact: at(floorProgram, "contact"),
      castStrength: at(floorProgram, "castStrength"),
    };
    const meshUniforms = {
      viewProjection: at(mesh, "viewProjection"),
      eye: at(mesh, "eye"),
    };
    const corner = gl.getAttribLocation(floorProgram, "corner");
    const quad = gl.createBuffer()!;
    buffers.push(quad);
    gl.bindBuffer(gl.ARRAY_BUFFER, quad);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    for (const program of [mesh, floorProgram]) {
      gl.useProgram(program);
      gl.uniform1i(at(program, "shadowMap"), 0);
      gl.uniform1f(at(program, "shadowTexel"), 1 / SHADOW_SIZE);
    }
    gl.useProgram(mesh);
    gl.uniform3f(at(mesh, "lightDir"), ...LIGHT);
    gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);

    let model: (SensorModel & { vertexBuffer: WebGLBuffer; indexBuffer: WebGLBuffer }) | null =
      null;
    let cancelled = false;
    let frame = 0;
    let elapsed = 0;
    let last = performance.now();
    let hit = { left: 0, right: 0, top: 0, bottom: 0 };
    const pointer = { x: 0, y: 0 };
    const apartEnd = PART_DURATION + PART_STAGGER * (PARTS.length - 1);
    const eased = {
      x: 0,
      y: 0,
      scroll: heroProgress(),
      apart: apartRef.current ? apartEnd : 0,
    };

    function drawMesh(
      pass: (typeof passes)[number],
      offsets: Float32Array,
      lightViewProjection: Mat4,
      spin: Mat3,
    ) {
      gl!.useProgram(pass.program);
      gl!.bindBuffer(gl!.ARRAY_BUFFER, model!.vertexBuffer);
      gl!.bindBuffer(gl!.ELEMENT_ARRAY_BUFFER, model!.indexBuffer);
      for (const { location, type, offset } of pass.attributes) {
        if (location < 0) continue;
        gl!.enableVertexAttribArray(location);
        gl!.vertexAttribPointer(location, 4, type, true, 16, offset);
      }
      gl!.uniform3fv(pass.offsets, offsets);
      gl!.uniformMatrix3fv(pass.rotation, false, spin);
      gl!.uniformMatrix4fv(pass.lightViewProjection, false, lightViewProjection);
      gl!.drawElements(gl!.TRIANGLES, model!.indices.length, gl!.UNSIGNED_INT, 0);
      for (const { location } of pass.attributes)
        if (location >= 0) gl!.disableVertexAttribArray(location);
    }

    function draw() {
      if (!model) return;
      const progress = eased.scroll;
      // Pinned scroll: lift off the floor, turn so the sensor's right side faces the viewer,
      // spread the parts out (a row on wide screens), then bring them back together.
      const aspect = element!.width / element!.height;
      const wide = aspect > 1.2;
      const back = 1 - smoothstep((progress - RETURN_START) / (1 - RETURN_START));
      const lift = smoothstep(progress / LIFT_END) * back;
      const turn = smoothstep((progress - LIFT_END) / (TURN_END - LIFT_END)) * back;
      // The hero copy only shows at the very top; once scrolling starts, only the sensor remains.
      const copy = 1 - smoothstep(progress / 0.06);
      document.documentElement.style.setProperty("--hero-copy", copy.toFixed(3));
      const spreading = ((progress - TURN_END) / (SPREAD_END - TURN_END)) * apartEnd;
      const rejoin = 1 - smoothstep((progress - REJOIN_START) / (RETURN_START - REJOIN_START));
      const laidOut = PARTS.map(
        (_, i) => smoothstep((spreading - i * PART_STAGGER) / PART_DURATION) * rejoin,
      );
      const clicked = PARTS.map((_, i) =>
        smoothstep((eased.apart - i * PART_STAGGER) / PART_DURATION),
      );
      const partProgress = PARTS.map((_, i) => Math.max(clicked[i], laidOut[i]));
      const toViewer: Vec3 = [Math.sin(VIEW_ANGLE), 0, Math.cos(VIEW_ANGLE)];
      const screenRight: Vec3 = [Math.cos(VIEW_ANGLE), 0, -Math.sin(VIEW_ANGLE)];
      // Wide screens: roll the sensor onto its edge (Z) so the Circuit Playground side points
      // right, then yaw (Y) by the view angle so it points straight across the screen and an
      // edge of the case faces the viewer. The parts then spread along that same axis.
      // Narrow screens: only yaw, and the parts spread up the screen instead.
      const spin = wide
        ? multiply3(
            rotation([0, 1, 0], turn * VIEW_ANGLE),
            rotation([0, 0, 1], -turn * (Math.PI / 2)),
          )
        : rotation([0, 1, 0], turn * (VIEW_ANGLE - Math.PI / 2));
      const bob = motion ? Math.sin(elapsed * 1.4) * 0.03 * lift : 0;
      const float = FLOAT_HEIGHT * lift + bob;
      const centers = model.centers.map((center) => apply3(spin, center));
      const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
      const scale3 = (v: Vec3, k: number): Vec3 => [v[0] * k, v[1] * k, v[2] * k];
      // Laid out, each part's center moves to its own slot and all centers line up.
      // Parts keep their turned orientation but slide straight along the screen's horizontal,
      // with centers matched in height and depth so the row stays level on screen.
      const slotAxis: Vec3 = wide ? screenRight : [0, 1, 0];
      const acrossAxes: Vec3[] = wide ? [[0, 1, 0], toViewer] : [screenRight, toViewer];
      const firstSlot = wide ? (-(PARTS.length - 1) * ROW_GAP) / 2 : 0;
      const partOffsets = PARTS.map((_, i) => {
        const slot = firstSlot + i * (wide ? ROW_GAP : COLUMN_GAP);
        const layout = acrossAxes.reduce(
          (sum, axis) => add(sum, scale3(axis, dot(axis, centers[0]) - dot(axis, centers[i]))),
          scale3(slotAxis, slot - dot(slotAxis, centers[i])),
        );
        const clickLift: Vec3 = [0, i * PART_GAP * clicked[i], 0];
        return add(add(scale3(layout, laidOut[i]), clickLift), [0, float, 0]);
      });
      const placedCenters = centers.map((center, i) => add(center, partOffsets[i]));
      // The case's height comes from its turned bounding box; the other parts are smaller.
      const caseHeights = [-0.97, 0.97].flatMap((x) =>
        [model!.floor, model!.top].flatMap((y) =>
          [-1, 1].map((z) => apply3(spin, [x, y, z])[1] + partOffsets[0][1]),
        ),
      );
      const partHalf = 0.6 + 0.4 * turn;
      const low = placedCenters.map((c, i) =>
        i === 0 ? Math.min(...caseHeights) : c[1] - partHalf,
      );
      const high = placedCenters.map((c, i) =>
        i === 0 ? Math.max(...caseHeights) : c[1] + partHalf,
      );
      const bottom = Math.min(...low);
      const top = Math.max(...high);
      const along = placedCenters.map((c) => dot(screenRight, c));
      const width = Math.max(...along) - Math.min(...along) + 2.2;
      const middleRight = (Math.max(...along) + Math.min(...along)) / 2;
      const middle = (bottom + top) / 2;
      const target = add(scale3(screenRight, middleRight), [0, middle, 0]);
      const breathe = motion ? Math.sin(elapsed * 0.3) * 0.15 * (1 - turn) : 0;
      const spreadAmount = Math.max(...laidOut);
      // Pointer sway settles while the parts are laid out so the row reads level.
      const angle = VIEW_ANGLE + (eased.x * 0.4 + breathe) * (1 - spreadAmount);
      // Eye level to show the side, then back up a little so the parts' tops read in the row.
      const elevation =
        (0.5 + eased.y * 0.15 * (1 - spreadAmount)) * (1 - turn) +
        (0.12 + 0.2 * spreadAmount) * turn;
      // Narrow screens need a wider lens to fit the case between the heading and the fold.
      const fov = wide ? 0.55 : 0.62 / Math.max(Math.min(aspect, 1), 0.5);
      const halfTan = Math.tan(fov / 2);
      const distance = Math.max(
        6.4,
        Math.max((top - bottom) / 2 / halfTan, width / 2 / (halfTan * aspect)) * 1.3,
      );
      const eye: Vec3 = add(target, [
        Math.sin(angle) * Math.cos(elevation) * distance,
        Math.sin(elevation) * distance,
        Math.cos(angle) * Math.cos(elevation) * distance,
      ]);
      // Beside the heading at the top; centered once the copy is gone. On narrow screens a
      // taken-apart sensor shrinks left to leave room for its labels.
      const spread = Math.max(top - bottom - (model.top - model.floor), 0);
      const apartAmount = wide ? 0 : Math.min(1, spread / ((PARTS.length - 1) * PART_GAP));
      const scale = 1 - 0.25 * apartAmount;
      const offsetX = wide ? 0.16 * copy : -0.32 * apartAmount;
      const offsetY = wide ? 0 : -0.12 * copy;
      // prettier-ignore
      const place = [scale, 0, 0, 0, 0, scale, 0, 0, 0, 0, 1, 0, offsetX, offsetY, 0, 1];
      const viewProjection = multiply(
        place,
        multiply(perspective(fov, aspect, 0.1, 80), lookAt(eye, target)),
      );
      const lightEye = add(target, scale3(LIGHT, 12));
      const lightViewProjection = multiply(
        orthographic(1.6 + Math.max(width, top - bottom) * 0.6, 1, 24),
        lookAt(lightEye, target),
      );
      const offsets = new Float32Array(partOffsets.flat());
      // Standing on its edge the sensor reaches lower, so the floor drops to stay beneath it.
      const floorY = model.floor - (wide ? 0.6 * turn : 0);
      const levitate = lift;

      // Shadow map from the key light.
      gl!.bindFramebuffer(gl!.FRAMEBUFFER, shadowFramebuffer);
      gl!.viewport(0, 0, SHADOW_SIZE, SHADOW_SIZE);
      gl!.clearColor(1, 1, 1, 1);
      gl!.enable(gl!.DEPTH_TEST);
      gl!.clear(gl!.COLOR_BUFFER_BIT | gl!.DEPTH_BUFFER_BIT);
      drawMesh(passes[0], offsets, lightViewProjection, spin);
      gl!.bindFramebuffer(gl!.FRAMEBUFFER, null);
      gl!.viewport(0, 0, element!.width, element!.height);
      gl!.clearColor(0, 0, 0, 0);
      gl!.clear(gl!.COLOR_BUFFER_BIT | gl!.DEPTH_BUFFER_BIT);
      gl!.activeTexture(gl!.TEXTURE0);
      gl!.bindTexture(gl!.TEXTURE_2D, shadowTexture);

      gl!.useProgram(floorProgram);
      gl!.bindBuffer(gl!.ARRAY_BUFFER, quad);
      gl!.enableVertexAttribArray(corner);
      gl!.vertexAttribPointer(corner, 2, gl!.FLOAT, false, 0, 0);
      gl!.uniformMatrix4fv(floorUniforms.viewProjection, false, viewProjection);
      gl!.uniformMatrix4fv(floorUniforms.lightViewProjection, false, lightViewProjection);
      gl!.uniform1f(floorUniforms.floorY, floorY - 0.002);
      gl!.uniform1f(floorUniforms.size, 4);
      gl!.uniform1f(floorUniforms.contact, 0.22 * (1 - 0.75 * levitate));
      // Shadows fade as the sensor floats away from the floor.
      gl!.uniform1f(floorUniforms.castStrength, 0.28 * (1 - 0.6 * levitate));
      gl!.enable(gl!.BLEND);
      gl!.depthMask(false);
      gl!.drawArrays(gl!.TRIANGLE_STRIP, 0, 4);
      gl!.depthMask(true);
      gl!.disable(gl!.BLEND);
      gl!.disableVertexAttribArray(corner);

      gl!.useProgram(mesh);
      gl!.uniformMatrix4fv(meshUniforms.viewProjection, false, viewProjection);
      gl!.uniform3f(meshUniforms.eye, ...eye);
      drawMesh(passes[1], offsets, lightViewProjection, spin);

      // Labels and the click target follow the model on screen.
      const toScreen = (point: Vec3) => {
        const [x, y] = project(viewProjection, point);
        return [(x * 0.5 + 0.5) * window.innerWidth, (0.5 - y * 0.5) * window.innerHeight];
      };
      const corners = placedCenters.flatMap((c) =>
        [-1.1, 1.1].flatMap((dx) =>
          [-1.1, 1.1].flatMap((dz) =>
            [c[1] - 0.7, c[1] + 0.7].map((y) => toScreen([c[0] + dx, y, c[2] + dz])),
          ),
        ),
      );
      hit = {
        left: Math.min(...corners.map((c) => c[0])),
        right: Math.max(...corners.map((c) => c[0])),
        top: Math.min(...corners.map((c) => c[1])),
        bottom: Math.max(...corners.map((c) => c[1])),
      };
      // Labels only accompany a clicked-apart sensor: a column to the right, each with a leader
      // line to its part. The scroll animation stays unlabeled.
      const anchors = placedCenters.map((center) => toScreen(center));
      const column = Math.min(hit.right + (wide ? 40 : 16), window.innerWidth - (wide ? 240 : 165));
      const rows = anchors.map(([, y]) => y);
      for (let i = rows.length - 2; i >= 0; i--)
        rows[i] = Math.max(rows[i], rows[i + 1] + (wide ? 44 : 26));
      anchors.forEach(([x, y], i) => {
        const label = labels.current[i];
        const line = label?.firstElementChild as HTMLElement | null;
        const text = label?.lastElementChild as HTMLElement | null;
        if (!label || !line || !text) return;
        const dx = column - x;
        const dy = rows[i] - y;
        label.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px)`;
        label.style.opacity = clicked[i].toFixed(3);
        line.style.width = `${Math.hypot(dx, dy).toFixed(1)}px`;
        line.style.transform = `rotate(${Math.atan2(dy, dx).toFixed(4)}rad)`;
        text.style.transform = `translate(${(dx + 8).toFixed(1)}px, ${(dy - 7).toFixed(1)}px)`;
      });
      if (hint.current) {
        const x = (hit.left + hit.right) / 2;
        hint.current.style.transform = `translate(${x.toFixed(1)}px, ${(hit.bottom + 12).toFixed(1)}px)`;
        hint.current.style.opacity = copy.toFixed(3);
      }
    }

    function tick(now: number) {
      frame = requestAnimationFrame(tick);
      const step = Math.min(now - last, 100) / 1000;
      last = now;
      const actualScroll = heroProgress();
      const hero = document.querySelector(".landing-hero")?.getBoundingClientRect();
      scene.current?.classList.toggle(
        "scene-offstage",
        !!hero && hero.bottom < window.innerHeight * 0.35,
      );
      // Scrolling away from where it was clicked apart puts the sensor back together first.
      if (apartRef.current && Math.abs(actualScroll - apartScrollRef.current) > 0.01) {
        apartRef.current = false;
        setApart(false);
      }
      const apartTarget = apartRef.current ? apartEnd : 0;
      // Hold the scroll timeline where it is until a clicked-apart sensor is back together.
      const scroll = eased.apart > 0.001 ? eased.scroll : actualScroll;
      const settled =
        Math.abs(scroll - eased.scroll) < 0.001 && Math.abs(apartTarget - eased.apart) < 0.001;
      // Nothing to animate: the hero is off screen or, without motion, the scene is at rest.
      if (document.hidden || (settled && (scroll >= 1 || !motion))) return;
      if (motion) elapsed += step;
      const ease = motion ? 1 - Math.exp(-step * 5) : 1;
      eased.x += ((motion ? pointer.x : 0) - eased.x) * ease;
      eased.y += ((motion ? pointer.y : 0) - eased.y) * ease;
      eased.scroll += (scroll - eased.scroll) * ease;
      const remaining = apartTarget - eased.apart;
      eased.apart = motion
        ? eased.apart + Math.sign(remaining) * Math.min(step, Math.abs(remaining))
        : apartTarget;
      draw();
    }
    function resize() {
      const ratio = Math.min(window.devicePixelRatio, 1.5, 2400 / window.innerWidth);
      element!.width = Math.round(window.innerWidth * ratio);
      element!.height = Math.round(window.innerHeight * ratio);
      draw();
    }
    // Clickable only at rest: at the top of the page, or back in its starting pose at the end
    // of the hero before the next section covers it.
    const atRest = () => {
      const progress = heroProgress();
      const hero = document.querySelector(".landing-hero")?.getBoundingClientRect();
      return progress < 0.01 || (progress > 0.99 && !!hero && hero.bottom > window.innerHeight - 4);
    };
    const overModel = (x: number, y: number) =>
      atRest() && x >= hit.left && x <= hit.right && y >= hit.top && y <= hit.bottom;
    const interactive = (target: EventTarget | null) =>
      target instanceof Element && !!target.closest("a, button, input, label, dialog, textarea");
    const move = (event: PointerEvent) => {
      pointer.x = event.clientX / window.innerWidth - 0.5;
      pointer.y = 0.5 - event.clientY / window.innerHeight;
      const hover = overModel(event.clientX, event.clientY) && !interactive(event.target);
      document.body.style.cursor = hover ? "pointer" : "";
    };
    const click = (event: MouseEvent) => {
      if (interactive(event.target) || !overModel(event.clientX, event.clientY)) return;
      setApart((value) => !value);
    };
    const lost = (event: Event) => {
      event.preventDefault();
      cancelAnimationFrame(frame);
      setReady(false);
    };
    loadModel()
      .then((loaded) => {
        if (cancelled) return;
        const vertexBuffer = gl.createBuffer()!;
        const indexBuffer = gl.createBuffer()!;
        buffers.push(vertexBuffer, indexBuffer);
        gl.bindBuffer(gl.ARRAY_BUFFER, vertexBuffer);
        gl.bufferData(gl.ARRAY_BUFFER, loaded.vertices, gl.STATIC_DRAW);
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indexBuffer);
        gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, loaded.indices, gl.STATIC_DRAW);
        model = { ...loaded, vertexBuffer, indexBuffer };
        setReady(true);
        resize();
        frame = requestAnimationFrame(tick);
      })
      .catch(() => {
        /* Keep the SVG fallback visible. */
      });
    window.addEventListener("resize", resize);
    window.addEventListener("pointermove", move, { passive: true });
    window.addEventListener("click", click);
    element.addEventListener("webglcontextlost", lost);
    return () => {
      cancelled = true;
      cancelAnimationFrame(frame);
      document.body.style.cursor = "";
      document.documentElement.style.removeProperty("--hero-copy");
      window.removeEventListener("resize", resize);
      window.removeEventListener("pointermove", move);
      window.removeEventListener("click", click);
      element.removeEventListener("webglcontextlost", lost);
      cleanup();
    };
  }, [motion]);

  return (
    <>
      <div className={`ice-scene ${ready ? "scene-ready" : ""}`} ref={scene} aria-hidden="true">
        <Heartbeat />
        <svg className="scene-fallback" viewBox="0 0 1000 700">
          <ellipse cx="500" cy="560" rx="260" ry="46" fill="#253e36" opacity=".08" />
          <path
            d="M500 250 760 360 500 470 240 360Z"
            fill="#f5f5f5"
            stroke="#d5dfd5"
            strokeWidth="4"
          />
          <path d="M240 360V440L500 550V470Z" fill="#dcdcd8" stroke="#d5dfd5" strokeWidth="4" />
          <path d="M760 360V440L500 550V470Z" fill="#e8e8e4" stroke="#d5dfd5" strokeWidth="4" />
          <circle cx="500" cy="360" r="10" fill="#1a5924" />
        </svg>
        <canvas ref={canvas} />
        {ready && (
          <div className="scene-labels">
            {PARTS.map((part, i) => (
              <span
                className="scene-part"
                key={part.name}
                ref={(node) => {
                  labels.current[i] = node;
                }}
              >
                <i className="scene-part-line" />
                <span className="scene-part-label">
                  {part.name.toUpperCase()}
                  <small>{part.detail}</small>
                </span>
              </span>
            ))}
            <span className="scene-hint" ref={hint}>
              {apart ? "Click to put it back together" : "Click the sensor to look inside"}
            </span>
          </div>
        )}
      </div>
      {ready && (
        <button
          className="scene-toggle secondary"
          onClick={() => setApart((value) => !value)}
          aria-pressed={apart}
        >
          {apart ? "Put the sensor back together" : "Take the sensor apart"}
        </button>
      )}
      <button
        className="motion-control secondary"
        onClick={() => setMotion((value) => !value)}
        aria-pressed={motion}
      >
        Motion: {motion ? "on" : "off"}
      </button>
    </>
  );
}
