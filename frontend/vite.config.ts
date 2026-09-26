import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
export default defineConfig(({ mode }) => ({
  plugins: [react(), tailwindcss()],
  // Tailwind runs as a Vite plugin, so skip the PostCSS config search entirely.
  css: { postcss: {} },
  // "live" talks to the deployed backend; "backend" to one running on this machine (uvicorn, port
  // 8000), which is where new backend features work before they are deployed.
  define:
    mode === "live" || mode === "backend"
      ? { "import.meta.env.VITE_USE_MOCK": '"false"' }
      : undefined,
  server: {
    proxy: {
      "/api": {
        target:
          mode === "backend"
            ? "http://127.0.0.1:8000"
            : "https://stillhere-production-8652.up.railway.app",
        changeOrigin: true,
      },
    },
  },
}));
