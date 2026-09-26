import { useEffect, useRef, useState } from "react";
import { fragmentShader, vertexShader } from "./sceneShader";

// Matches the page background (#f7f8f3) so the house sits on the site, not in a box.
const BACKDROP = [0xf7 / 255, 0xf8 / 255, 0xf3 / 255] as const;

export default function IceScene() {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [motion, setMotion] = useState(
    () => !window.matchMedia("(prefers-reduced-motion: reduce)").matches,
  );
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const preference = window.matchMedia("(prefers-reduced-motion: reduce)");
    const change = () => setMotion(!preference.matches);
    preference.addEventListener("change", change);
    return () => preference.removeEventListener("change", change);
  }, []);

  useEffect(() => {
    const element = canvas.current;
    const gl = element?.getContext("webgl", {
      alpha: false,
      antialias: false,
      powerPreference: "high-performance",
    });
    if (!gl || !element) return;
    function compile(type: number, source: string) {
      const shader = gl!.createShader(type)!;
      gl!.shaderSource(shader, source);
      gl!.compileShader(shader);
      if (!gl!.getShaderParameter(shader, gl!.COMPILE_STATUS)) {
        gl!.deleteShader(shader);
        return null;
      }
      return shader;
    }
    const vertex = compile(gl.VERTEX_SHADER, vertexShader);
    const fragment = compile(gl.FRAGMENT_SHADER, fragmentShader);
    if (!vertex || !fragment) {
      if (vertex) gl.deleteShader(vertex);
      if (fragment) gl.deleteShader(fragment);
      return;
    }
    const program = gl.createProgram()!;
    gl.attachShader(program, vertex);
    gl.attachShader(program, fragment);
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      gl.deleteProgram(program);
      gl.deleteShader(vertex);
      gl.deleteShader(fragment);
      return;
    }
    gl.useProgram(program);
    gl.uniform3f(gl.getUniformLocation(program, "backdrop"), ...BACKDROP);
    const buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]),
      gl.STATIC_DRAW,
    );
    const position = gl.getAttribLocation(program, "position");
    gl.enableVertexAttribArray(position);
    gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);
    const size = gl.getUniformLocation(program, "resolution"),
      clock = gl.getUniformLocation(program, "time"),
      mouse = gl.getUniformLocation(program, "pointer");
    const target = { x: 0, y: 0 },
      eased = { x: 0, y: 0 };
    let frame = 0,
      elapsed = 0,
      last = performance.now();
    function draw() {
      gl!.uniform2f(size, element!.width, element!.height);
      gl!.uniform2f(mouse, eased.x, eased.y);
      gl!.uniform1f(clock, elapsed);
      gl!.drawArrays(gl!.TRIANGLES, 0, 6);
    }
    function tick(now: number) {
      frame = requestAnimationFrame(tick);
      const step = Math.min(now - last, 100) / 1000;
      last = now;
      // Skip work once the hero has scrolled away or the tab is hidden.
      if (document.hidden || window.scrollY > window.innerHeight) return;
      elapsed += step;
      const ease = 1 - Math.exp(-step * 4);
      eased.x += (target.x - eased.x) * ease;
      eased.y += (target.y - eased.y) * ease;
      draw();
    }
    function resize() {
      const ratio = Math.min(window.devicePixelRatio, 1.25, 1600 / window.innerWidth);
      element!.width = Math.round(window.innerWidth * ratio);
      element!.height = Math.round(window.innerHeight * ratio);
      gl!.viewport(0, 0, element!.width, element!.height);
      draw();
    }
    const move = (event: PointerEvent) => {
      target.x = event.clientX / window.innerWidth - 0.5;
      target.y = 0.5 - event.clientY / window.innerHeight;
    };
    const lost = (event: Event) => {
      event.preventDefault();
      cancelAnimationFrame(frame);
      setReady(false);
    };
    resize();
    setReady(true);
    if (motion) frame = requestAnimationFrame(tick);
    window.addEventListener("resize", resize);
    if (motion) window.addEventListener("pointermove", move, { passive: true });
    element.addEventListener("webglcontextlost", lost);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("resize", resize);
      window.removeEventListener("pointermove", move);
      element.removeEventListener("webglcontextlost", lost);
      gl.deleteBuffer(buffer);
      gl.deleteProgram(program);
      gl.deleteShader(vertex);
      gl.deleteShader(fragment);
    };
  }, [motion]);

  return (
    <>
      <div className={`ice-scene ${ready ? "scene-ready" : ""}`} aria-hidden="true">
        <svg className="scene-fallback" viewBox="0 0 1000 700">
          <defs>
            <linearGradient id="ice" x2="1" y2="1">
              <stop stopColor="#eef7fc" />
              <stop offset="1" stopColor="#7d94a6" />
            </linearGradient>
          </defs>
          <ellipse cx="510" cy="590" rx="290" ry="40" fill="#758593" opacity=".3" />
          <path
            d="M285 320 500 150 715 320 715 570 285 570Z"
            fill="url(#ice)"
            stroke="#effaff"
            strokeWidth="10"
          />
          <path
            d="M500 150 805 265 715 320M715 570 805 500 805 265"
            fill="#8498a7"
            stroke="#effaff"
            strokeWidth="5"
          />
          <path d="M400 570V355H570V570" fill="#d7f3ff" />
          <rect x="450" y="408" width="60" height="85" rx="12" fill="#344b59" />
          <circle cx="480" cy="430" r="5" fill="#e3fffc" />
        </svg>
        <canvas ref={canvas} />
      </div>
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
