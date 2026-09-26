import { useEffect, useRef, useState } from "react";
import { fragmentShader, vertexShader } from "./sceneShader";

export default function IceScene({ dark = false }: { dark?: boolean }) {
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
    gl.uniform1f(gl.getUniformLocation(program, "darkStage"), dark ? 1 : 0);
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
    let stopped = false;
    function draw() {
      if (stopped) return;
      gl!.uniform2f(size, element!.width, element!.height);
      gl!.uniform2f(mouse, 0, 0);
      gl!.uniform1f(clock, 0);
      gl!.drawArrays(gl!.TRIANGLES, 0, 6);
    }
    function resize() {
      const ratio = Math.min(
        window.devicePixelRatio,
        1.5,
        1920 / window.innerWidth,
      );
      element!.width = Math.round(window.innerWidth * ratio);
      element!.height = Math.round(window.innerHeight * ratio);
      gl!.viewport(0, 0, element!.width, element!.height);
      draw();
    }
    const move = (event: PointerEvent) => {
      if (!motion || window.scrollY > window.innerHeight) return;
      // Move the cached render through the compositor instead of rerunning the shader.
      const x = (event.clientX / window.innerWidth - 0.5) * 8;
      const y = (event.clientY / window.innerHeight - 0.5) * 8;
      element!.style.transform = `translate(${x}px, ${y}px) scale(1.02)`;
    };
    const visibility = () => {
      if (!document.hidden) draw();
    };
    const lost = (event: Event) => {
      event.preventDefault();
      stopped = true;
      setReady(false);
    };
    element.style.transform = "scale(1.02)";
    resize();
    setReady(true);
    window.addEventListener("resize", resize);
    window.addEventListener("pointermove", move, { passive: true });
    document.addEventListener("visibilitychange", visibility);
    element.addEventListener("webglcontextlost", lost);
    return () => {
      stopped = true;
      window.removeEventListener("resize", resize);
      window.removeEventListener("pointermove", move);
      document.removeEventListener("visibilitychange", visibility);
      element.removeEventListener("webglcontextlost", lost);
      gl.deleteBuffer(buffer);
      gl.deleteProgram(program);
      gl.deleteShader(vertex);
      gl.deleteShader(fragment);
    };
  }, [motion, dark]);

  return (
    <>
      <div
        className={`ice-scene ${dark ? "dark-scene" : ""} ${ready ? "scene-ready" : ""}`}
        aria-hidden="true"
      >
        <svg className="scene-fallback" viewBox="0 0 1000 700">
          <defs>
            <linearGradient id="ice" x2="1" y2="1">
              <stop stopColor="#eef7fc" />
              <stop offset="1" stopColor="#7d94a6" />
            </linearGradient>
          </defs>
          <ellipse
            cx="510"
            cy="590"
            rx="290"
            ry="40"
            fill="#758593"
            opacity=".3"
          />
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
        {!dark && <div className="snow-field snow-paused" />}
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
