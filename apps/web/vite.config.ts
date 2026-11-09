/// <reference types="vitest/config" />
import path from "node:path";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const apiTarget = process.env.API_PROXY_TARGET ?? "http://127.0.0.1:4000";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: { alias: { "@": path.resolve(import.meta.dirname, "src") } },
  server: {
    port: Number(process.env.WEB_PORT ?? 5173),
    strictPort: true,
    // Same-origin API in development: cookies stay first-party and SameSite=Strict works.
    proxy: { "/api": { target: apiTarget, changeOrigin: false } },
  },
  preview: { port: 4173, proxy: { "/api": { target: apiTarget } } },
  build: { sourcemap: true, target: "es2022" },
  test: {
    environment: "jsdom",
    setupFiles: ["src/test/setup.ts"],
    include: ["src/**/*.test.{ts,tsx}"],
    css: false,
  },
});
