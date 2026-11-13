#!/usr/bin/env node
/**
 * Post-build / post-deployment smoke test (US-H04 foundation).
 *
 *   node scripts/smoke.mjs                 start the built API (serving apps/web/dist) on a
 *                                          spare port, check it, then stop only that child
 *   node scripts/smoke.mjs --url <base>    check an already running deployment
 *
 * Checks: health endpoint and database, SPA served with history fallback, protected
 * API refuses anonymous access, security headers present. Exit code 1 on any failure.
 */
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const urlFlag = process.argv.indexOf("--url");
const externalBase = urlFlag > 0 ? process.argv[urlFlag + 1] : undefined;
const port = Number(process.env.SMOKE_PORT ?? 4290);

async function waitFor(url, attempts = 40) {
  for (let i = 0; i < attempts; i++) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      /* not up yet */
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Timed out waiting for ${url}`);
}

async function check(base) {
  const results = [];
  const record = (name, ok, detail = "") => results.push({ name, ok, detail });

  const health = await fetch(`${base}/api/health`);
  const body = await health.json().catch(() => ({}));
  record("health endpoint reports database ok", health.ok && body.database === "ok", JSON.stringify(body));

  const ready = await fetch(`${base}/api/health/ready`);
  const readyBody = await ready.json().catch(() => ({}));
  record("readiness endpoint reports ready", ready.ok && readyBody.status === "ready", JSON.stringify(readyBody));

  const spa = await fetch(`${base}/projects`);
  const html = await spa.text();
  record("SPA served with history fallback", spa.ok && html.includes('<div id="root">'), String(spa.status));

  const anonymous = await fetch(`${base}/api/projects`);
  record("protected API rejects anonymous access", anonymous.status === 401, String(anonymous.status));

  const generation = await fetch(`${base}/api/templates/options`);
  record("project generation API rejects anonymous access", generation.status === 401, String(generation.status));

  const headers = (await fetch(`${base}/`)).headers;
  record("CSP header present", Boolean(headers.get("content-security-policy")));
  record("nosniff header present", headers.get("x-content-type-options") === "nosniff");

  for (const result of results)
    console.log(`${result.ok ? "PASS" : "FAIL"}  ${result.name}${result.ok ? "" : `  (${result.detail})`}`);
  return results.every((result) => result.ok);
}

let child;
try {
  let base = externalBase;
  if (!base) {
    const server = path.join(root, "apps", "api", "dist", "server.js");
    const webDist = path.join(root, "apps", "web", "dist");
    if (!existsSync(server) || !existsSync(path.join(webDist, "index.html"))) {
      throw new Error("Build first: npm run build");
    }
    base = `http://127.0.0.1:${port}`;
    child = spawn(process.execPath, ["--env-file-if-exists=.env", server], {
      cwd: path.join(root, "apps", "api"),
      env: { ...process.env, PORT: String(port), WEB_DIST_DIR: webDist, WEB_ORIGIN: base, LOG_LEVEL: "warn" },
      stdio: ["ignore", "inherit", "inherit"],
    });
    await waitFor(`${base}/api/health`);
  }
  const ok = await check(base);
  process.exitCode = ok ? 0 : 1;
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  // Stop only the server this script started.
  child?.kill();
}
