import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
export default defineConfig(({ mode }) => ({
  plugins: [react(), tailwindcss()],
  // Tailwind runs as a Vite plugin, so skip the PostCSS config search entirely.
  css: { postcss: {} },
  define: mode === "live" ? { "import.meta.env.VITE_USE_MOCK": '"false"' } : undefined,
  server: {
    proxy: {
      "/api": {
        target: "https://stillhere-production-8652.up.railway.app",
        changeOrigin: true,
      },
    },
  },
}));
