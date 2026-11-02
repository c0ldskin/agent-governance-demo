import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// `npm run dev` serves the kit on 127.0.0.1:5180 and forwards /api to the demo's UI server (8776) when it is
// running; without it the kit plays the scripted mock. `npm run build` writes ../ui/kit, which ui/server.py serves
// at / (assets under /kit/).
export default defineConfig(({ command }) => ({
  plugins: [react()],
  base: command === "build" ? "/kit/" : "/",
  build: { outDir: "../ui/kit", emptyOutDir: true, chunkSizeWarningLimit: 1500 },
  server: { proxy: { "/api": { target: "http://127.0.0.1:8776", changeOrigin: false } } },
}));
