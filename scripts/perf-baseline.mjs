#!/usr/bin/env node
/**
 * Local load/latency baseline (RG-14). Reproducible, dependency-free.
 *
 *   npm run build            (the baseline runs the built API in apps/api/dist)
 *   npm run perf:baseline    [-- --projects 50 --requests 300]
 *
 * What it does: creates a throw-away database `perf_baseline_<random>` on the server named by
 * DATABASE_URL (apps/api/.env), migrates it, creates an owner through the owner CLI, starts the built
 * API as a child process on a free port, seeds projects + requirements, measures each scenario at
 * concurrency 1/10/25 over keep-alive HTTP, then stops the API and ALWAYS drops the database.
 * It never touches any other database. Output: a table and .local/perf/baseline.json.
 *
 * Budgets (generous, local single-process; a breach exits 1):
 *   - zero HTTP 5xx and zero transport errors / unexpected statuses in every scenario;
 *   - read scenarios (health, projects, project detail, search, dashboard): p95 < 500 ms at concurrency 10;
 *   - generation preview: p95 < 8000 ms at concurrency 10 (deliberately loose: preview is CPU/IO heavy, ~1-10 req/s; tighten after optimising);
 *   - login scenario: only 401/429 allowed (429 = rate limiter working, reported separately; not an error).
 */
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { createRequire } from "node:module";
import { randomBytes } from "node:crypto";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const apiDir = path.join(root, "apps", "api");
const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? Number(process.argv[i + 1]) : fallback;
};
const PROJECTS = arg("projects", 50);
const REQUESTS = arg("requests", 300);
const CONCURRENCY = [1, 10, 25];
const BUDGETS = { readP95Ms: 500, previewP95Ms: 8000, concurrencyForBudget: 10, max5xx: 0, maxErrors: 0 };

function readEnvValue(name) {
  if (process.env[name]) return process.env[name];
  const file = path.join(apiDir, ".env");
  const match = existsSync(file) ? readFileSync(file, "utf8").match(new RegExp(`^${name}="?([^"\\n]+)"?`, "m")) : null;
  if (!match) throw new Error(`${name} is not configured (apps/api/.env).`);
  return match[1];
}

function freePort() {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
    server.on("error", reject);
  });
}

function run(cmd, args, env) {
  const result = spawnSync(cmd, args, {
    cwd: apiDir,
    env: { ...process.env, ...env },
    encoding: "utf8",
  });
  if (result.status !== 0)
    throw new Error(`${cmd} ${args.join(" ")} failed:\n${(result.stdout + result.stderr).slice(-800)}`);
}

const agent = new http.Agent({ keepAlive: true, maxSockets: 100 });
function request(base, method, urlPath, { cookie, body } = {}) {
  return new Promise((resolve) => {
    const payload = body === undefined ? undefined : JSON.stringify(body);
    const headers = { "x-requested-with": "asaa-templates" };
    if (cookie) headers.cookie = cookie;
    if (payload) {
      headers["content-type"] = "application/json";
      headers["content-length"] = Buffer.byteLength(payload);
    }
    const started = performance.now();
    const req = http.request(base + urlPath, { method, headers, agent }, (res) => {
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () =>
        resolve({
          status: res.statusCode,
          ms: performance.now() - started,
          text: Buffer.concat(chunks).toString(),
          headers: res.headers,
        }),
      );
    });
    req.on("error", (error) =>
      resolve({ status: 0, ms: performance.now() - started, text: String(error), headers: {} }),
    );
    req.setTimeout(30_000, () => req.destroy(new Error("timeout")));
    if (payload) req.write(payload);
    req.end();
  });
}

const pct = (sorted, p) =>
  sorted.length ? sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)] : 0;

async function measure(name, concurrency, total, fire, okStatuses) {
  const latencies = [];
  const statuses = {};
  let next = 0;
  const started = performance.now();
  await Promise.all(
    Array.from({ length: concurrency }, async () => {
      while (next < total) {
        next += 1;
        const r = await fire();
        latencies.push(r.ms);
        statuses[r.status] = (statuses[r.status] ?? 0) + 1;
      }
    }),
  );
  const seconds = (performance.now() - started) / 1000;
  latencies.sort((a, b) => a - b);
  const count = (pred) => Object.entries(statuses).reduce((n, [s, c]) => n + (pred(Number(s)) ? c : 0), 0);
  return {
    scenario: name,
    concurrency,
    requests: total,
    // Unexpected statuses (including transport failures, status 0) are errors; 429 counts as an error unless expected.
    errors: count((s) => !okStatuses.includes(s)),
    status5xx: count((s) => s >= 500),
    rateLimited429: count((s) => s === 429),
    statuses,
    reqPerSec: Number((total / seconds).toFixed(1)),
    p50: Number(pct(latencies, 50).toFixed(2)),
    p95: Number(pct(latencies, 95).toFixed(2)),
    p99: Number(pct(latencies, 99).toFixed(2)),
    max: Number((latencies.at(-1) ?? 0).toFixed(2)),
  };
}

async function waitFor(url, attempts = 80) {
  for (let i = 0; i < attempts; i++) {
    try {
      if ((await fetch(url)).ok) return;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`Timed out waiting for ${url}`);
}

function commitSha() {
  const r = spawnSync("git", ["rev-parse", "--short", "HEAD"], { cwd: root, encoding: "utf8" });
  return r.status === 0 ? r.stdout.trim() : "unknown";
}

const dbName = `perf_baseline_${randomBytes(4).toString("hex")}`;
const adminUrl = new URL(readEnvValue("DATABASE_URL"));
const dbUrl = new URL(adminUrl);
dbUrl.pathname = `/${dbName}`;
dbUrl.searchParams.set("schema", "public");
const maintenanceUrl = new URL(adminUrl);
maintenanceUrl.pathname = "/postgres";

let child;
let admin;
let dbCreated = false;
const results = [];
try {
  if (!existsSync(path.join(apiDir, "dist", "server.js"))) throw new Error("Build first: npm run build");
  const { PrismaClient } = createRequire(path.join(apiDir, "package.json"))("@prisma/client");
  admin = new PrismaClient({ datasourceUrl: maintenanceUrl.toString() });
  await admin.$executeRawUnsafe(`CREATE DATABASE "${dbName}"`);
  dbCreated = true;
  console.log(`Created ${dbName}; migrating...`);
  run(
    process.execPath,
    [createRequire(path.join(apiDir, "package.json")).resolve("prisma/build/index.js"), "migrate", "deploy"],
    { DATABASE_URL: dbUrl.toString() },
  );

  const ownerEnv = {
    OWNER_EMAIL: "perf@example.test",
    OWNER_NAME: "Perf Owner",
    OWNER_PASSWORD: process.env.PERF_OWNER_PASSWORD || `Pb-${randomBytes(18).toString("base64url")}`,
  };
  run(process.execPath, ["dist/cli/owner.js", "init"], { DATABASE_URL: dbUrl.toString(), ...ownerEnv });

  const port = await freePort();
  const base = `http://127.0.0.1:${port}`;
  child = spawn(process.execPath, [path.join(apiDir, "dist", "server.js")], {
    cwd: apiDir,
    env: {
      ...process.env,
      NODE_ENV: "development",
      PORT: String(port),
      DATABASE_URL: dbUrl.toString(),
      WEB_DIST_DIR: path.join(root, "apps", "web", "dist"),
      WEB_ORIGIN: base,
      LOG_LEVEL: "warn",
      COOKIE_SECURE: "false",
      GENERATION_OUTPUT_DIR: path.join(root, ".local", "perf", "generated"),
    },
    stdio: ["ignore", "inherit", "inherit"],
  });
  await waitFor(`${base}/api/health`);

  const login = await request(base, "POST", "/api/auth/login", {
    body: { email: ownerEnv.OWNER_EMAIL, password: ownerEnv.OWNER_PASSWORD },
  });
  if (login.status !== 200) throw new Error(`Sign-in failed: ${login.status} ${login.text.slice(0, 200)}`);
  const cookie = []
    .concat(login.headers["set-cookie"] ?? [])
    .map((c) => c.split(";")[0])
    .join("; ");

  console.log(`Seeding ${PROJECTS} projects...`);
  const projectIds = [];
  for (let i = 0; i < PROJECTS; i++) {
    const made = await request(base, "POST", "/api/projects", {
      cookie,
      body: {
        key: `perf-${String(i).padStart(3, "0")}`,
        name: `Perf project ${i}`,
        purpose: "Baseline load project searchable perf",
      },
    });
    if (made.status !== 201) throw new Error(`Seed project failed: ${made.status} ${made.text.slice(0, 200)}`);
    const id = JSON.parse(made.text).project.id;
    projectIds.push(id);
    for (let r = 0; r < 3; r++) {
      const req = await request(base, "POST", `/api/projects/${id}/requirements`, {
        cookie,
        body: {
          title: `Perf requirement ${r}`,
          description: "Requirement text for search",
          acceptanceCriteria: ["Works", "Is fast"],
        },
      });
      if (req.status !== 201) throw new Error(`Seed requirement failed: ${req.status} ${req.text.slice(0, 200)}`);
    }
  }

  const previewBody = {
    mode: "SCRATCH",
    projectType: "web-app",
    project: { key: "perf-preview", name: "Perf preview", purpose: "Baseline preview" },
    inputs: {},
  };
  let pick = 0;
  const get = (p) => () => request(base, "GET", p, { cookie });
  const scenarios = [
    { name: "GET /api/health", fire: () => request(base, "GET", "/api/health"), ok: [200], budget: "read" },
    {
      name: "GET /api/health/ready",
      fire: () => request(base, "GET", "/api/health/ready"),
      ok: [200],
      budget: "read",
    },
    { name: "GET /api/projects", fire: get("/api/projects"), ok: [200], budget: "read" },
    {
      name: "GET /api/projects/:id",
      fire: () => request(base, "GET", `/api/projects/${projectIds[pick++ % projectIds.length]}`, { cookie }),
      ok: [200],
      budget: "read",
    },
    { name: "GET /api/search?q=perf", fire: get("/api/search?q=perf"), ok: [200], budget: "read" },
    { name: "GET /api/dashboard", fire: get("/api/dashboard"), ok: [200], budget: "read" },
    {
      name: "POST /api/generations/preview",
      fire: () => request(base, "POST", "/api/generations/preview", { cookie, body: previewBody }),
      ok: [200],
      budget: "preview",
    },
    {
      name: "POST /api/auth/login (bad pw)",
      fire: () =>
        request(base, "POST", "/api/auth/login", {
          body: { email: ownerEnv.OWNER_EMAIL, password: "wrong-password-xx" },
        }),
      ok: [401, 429],
      budget: "login",
    },
  ];

  for (const scenario of scenarios) {
    for (const c of CONCURRENCY) {
      // Warm-up (not recorded) so JIT/connection-pool cost does not dominate the first run.
      if (c === 1 && scenario.budget !== "login") for (let i = 0; i < 5; i++) await scenario.fire();
      const row = await measure(
        scenario.name,
        c,
        scenario.budget === "preview" ? Math.min(REQUESTS, 60) : REQUESTS,
        scenario.fire,
        scenario.ok,
      );
      row.budget = scenario.budget;
      results.push(row);
    }
  }

  const breaches = [];
  for (const row of results) {
    if (row.status5xx > BUDGETS.max5xx) breaches.push(`${row.scenario} c=${row.concurrency}: ${row.status5xx} 5xx`);
    if (row.errors > BUDGETS.maxErrors) breaches.push(`${row.scenario} c=${row.concurrency}: ${row.errors} errors`);
    if (row.concurrency !== BUDGETS.concurrencyForBudget) continue;
    if (row.budget === "read" && row.p95 >= BUDGETS.readP95Ms)
      breaches.push(`${row.scenario}: p95 ${row.p95} ms >= ${BUDGETS.readP95Ms}`);
    if (row.budget === "preview" && row.p95 >= BUDGETS.previewP95Ms)
      breaches.push(`${row.scenario}: p95 ${row.p95} ms >= ${BUDGETS.previewP95Ms}`);
  }

  const pad = (v, n) => String(v).padStart(n);
  console.log(`\n${"scenario".padEnd(32)} conc  reqs  err  429    req/s    p50    p95    p99    max`);
  for (const r of results)
    console.log(
      `${r.scenario.padEnd(32)} ${pad(r.concurrency, 4)} ${pad(r.requests, 5)} ${pad(r.errors, 4)} ${pad(r.rateLimited429, 4)} ${pad(r.reqPerSec, 8)} ${pad(r.p50, 6)} ${pad(r.p95, 6)} ${pad(r.p99, 6)} ${pad(r.max, 6)}`,
    );

  const report = {
    generatedAt: new Date().toISOString(),
    commit: commitSha(),
    machine: {
      platform: `${os.platform()} ${os.release()}`,
      arch: os.arch(),
      cpus: os.cpus().length,
      cpuModel: os.cpus()[0]?.model,
      totalMemGb: Number((os.totalmem() / 1024 ** 3).toFixed(1)),
      node: process.version,
    },
    config: { projects: PROJECTS, requestsPerRun: REQUESTS, concurrency: CONCURRENCY },
    budgets: BUDGETS,
    breaches,
    results,
  };
  mkdirSync(path.join(root, ".local", "perf"), { recursive: true });
  writeFileSync(path.join(root, ".local", "perf", "baseline.json"), `${JSON.stringify(report, null, 2)}\n`);
  console.log(breaches.length ? `\nBUDGET BREACHES:\n  ${breaches.join("\n  ")}` : "\nAll budgets met.");
  process.exitCode = breaches.length ? 1 : 0;
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  agent.destroy();
  child?.kill();
  if (child) await new Promise((r) => setTimeout(r, 500));
  if (admin && dbCreated) {
    try {
      await admin.$executeRawUnsafe(`DROP DATABASE IF EXISTS "${dbName}" WITH (FORCE)`);
      console.log(`Dropped ${dbName}.`);
    } catch (error) {
      console.error(`Could not drop ${dbName}: ${error instanceof Error ? error.message : error}`);
    }
  }
  await admin?.$disconnect();
}
