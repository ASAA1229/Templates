import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { defineConfig, devices } from "@playwright/test";

/**
 * End-to-end tests run the real API and web app against the dedicated PostgreSQL
 * test database (never the dev database). Locally the installed Microsoft Edge is
 * used, so no browser download is needed; CI installs Playwright's Chromium.
 */
function testDatabaseUrl(): string {
  if (process.env.TEST_DATABASE_URL) return process.env.TEST_DATABASE_URL;
  const envFile = path.resolve(import.meta.dirname, "../api/.env");
  const match = existsSync(envFile) ? readFileSync(envFile, "utf8").match(/^TEST_DATABASE_URL="?([^"\n]+)"?/m) : null;
  if (!match?.[1]) throw new Error("TEST_DATABASE_URL is not configured. Run `npm run db:local -- init`.");
  return match[1];
}

const API_PORT = 4100;
const WEB_PORT = 5180;
export const E2E_BASE_URL = `http://localhost:${WEB_PORT}`;
const databaseUrl = testDatabaseUrl();
process.env.E2E_DATABASE_URL = databaseUrl;
const channel = process.env.CI ? undefined : (process.env.PLAYWRIGHT_CHANNEL ?? "msedge");

export default defineConfig({
  testDir: "e2e",
  fullyParallel: false,
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  globalSetup: "./e2e/global-setup.ts",
  use: {
    baseURL: E2E_BASE_URL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: "desktop",
      use: { ...devices["Desktop Chrome"], channel, viewport: { width: 1366, height: 860 } },
      testIgnore: /responsive.spec.ts/,
    },
    { name: "mobile", use: { ...devices["Pixel 7"], channel }, testMatch: /responsive\.spec\.ts/ },
    {
      name: "desktop-dark",
      use: { ...devices["Desktop Chrome"], channel, colorScheme: "dark" },
      testMatch: /journey.spec.ts/,
    },
  ],
  webServer: [
    {
      command: "npm run serve:ts",
      cwd: path.resolve(import.meta.dirname, "../api"),
      url: `http://127.0.0.1:${API_PORT}/api/health`,
      reuseExistingServer: false,
      timeout: 60_000,
      env: {
        NODE_ENV: "test",
        PORT: String(API_PORT),
        DATABASE_URL: databaseUrl,
        WEB_ORIGIN: E2E_BASE_URL,
        LOG_LEVEL: "warn",
      },
    },
    {
      command: "npx vite",
      url: E2E_BASE_URL,
      reuseExistingServer: false,
      timeout: 60_000,
      env: { WEB_PORT: String(WEB_PORT), API_PROXY_TARGET: `http://127.0.0.1:${API_PORT}` },
    },
  ],
});
