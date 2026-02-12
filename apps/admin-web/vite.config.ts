import { defineConfig, type PluginOption } from "vite";
import react from "@vitejs/plugin-react";

// https://vite.dev/config/
export default defineConfig({
  plugins: [react() as unknown as PluginOption],
  server: {
    proxy: {
      "/api": "http://localhost:8787",
      "/healthz": "http://localhost:8787",
      "/ws": {
        target: "ws://localhost:8787",
        ws: true,
      },
    },
  },
});
