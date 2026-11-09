#!/usr/bin/env node
/**
 * Project-local PostgreSQL cluster for zero-cost local development and tests.
 *
 * Uses the PostgreSQL binaries already installed on the machine (initdb/pg_ctl/psql
 * on PATH) to run a private cluster under `.local/pgdata`, owned by the current OS
 * user, listening on 127.0.0.1 only. No admin rights, Docker or hosted database.
 *
 *   node scripts/local-db.mjs init     create cluster, databases and apps/api/.env
 *   node scripts/local-db.mjs start    start the cluster
 *   node scripts/local-db.mjs stop     stop the cluster
 *   node scripts/local-db.mjs status   show cluster status
 *
 * The generated password lives only in `.local/` and `apps/api/.env` (both ignored
 * by Git). Set TEMPLATES_PG_PORT to change the port (default 54329).
 */
import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const localDir = path.join(root, ".local");
const dataDir = path.join(localDir, "pgdata");
const secretFile = path.join(localDir, "pg-password");
const logFile = path.join(localDir, "postgres.log");
const envFile = path.join(root, "apps", "api", ".env");
const port = Number(process.env.TEMPLATES_PG_PORT ?? 54329);
const superuser = "templates_admin";
const databases = ["templates_dev", "templates_test"];

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { encoding: "utf8", ...options });
  if (result.error) throw new Error(`${command} failed to start: ${result.error.message}`);
  return result;
}

function must(command, args, options) {
  const result = run(command, args, options);
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} failed:\n${result.stderr || result.stdout}`);
  }
  return result;
}

function password() {
  return readFileSync(secretFile, "utf8").trim();
}

function psql(sql, database = "postgres") {
  return run(
    "psql",
    ["-h", "127.0.0.1", "-p", String(port), "-U", superuser, "-d", database, "-v", "ON_ERROR_STOP=1", "-tAc", sql],
    { env: { ...process.env, PGPASSWORD: password() } },
  );
}

function isRunning() {
  return run("pg_ctl", ["-D", dataDir, "status"]).status === 0;
}

function start() {
  if (!existsSync(dataDir)) throw new Error("Cluster not initialised. Run: npm run db:local -- init");
  if (isRunning()) return console.log(`Local PostgreSQL already running on 127.0.0.1:${port}.`);
  // stdio "ignore": the detached server would otherwise inherit our pipes and
  // spawnSync would wait for it to exit (observed on Windows).
  const started = run(
    "pg_ctl",
    ["-D", dataDir, "-l", logFile, "-o", `-p ${port} -c listen_addresses=127.0.0.1`, "-w", "start"],
    { stdio: "ignore" },
  );
  if (started.status !== 0) throw new Error(`pg_ctl start failed; see ${logFile}`);
  console.log(`Local PostgreSQL started on 127.0.0.1:${port}.`);
}

function init() {
  mkdirSync(localDir, { recursive: true });
  if (!existsSync(dataDir)) {
    const secret = randomBytes(24).toString("base64url");
    writeFileSync(secretFile, secret + "\n", { mode: 0o600 });
    const pwfile = path.join(localDir, "pwfile.tmp");
    writeFileSync(pwfile, secret + "\n", { mode: 0o600 });
    try {
      must("initdb", [
        "-D",
        dataDir,
        "-U",
        superuser,
        "--pwfile",
        pwfile,
        "-A",
        "scram-sha-256",
        "-E",
        "UTF8",
        "--no-locale",
      ]);
    } finally {
      writeFileSync(pwfile, "");
    }
    console.log("Initialised local cluster in .local/pgdata.");
  }
  start();
  for (const database of databases) {
    const exists = psql(`SELECT 1 FROM pg_database WHERE datname = '${database}'`).stdout.trim();
    if (exists !== "1") {
      const created = psql(`CREATE DATABASE ${database}`);
      if (created.status !== 0) throw new Error(created.stderr);
      console.log(`Created database ${database}.`);
    }
  }
  const url = (database) =>
    `postgresql://${superuser}:${encodeURIComponent(password())}@127.0.0.1:${port}/${database}?schema=public`;
  if (!existsSync(envFile)) {
    const example = readFileSync(path.join(root, "apps", "api", ".env.example"), "utf8");
    const env = example
      .replace(/^DATABASE_URL=.*$/m, `DATABASE_URL="${url("templates_dev")}"`)
      .replace(/^TEST_DATABASE_URL=.*$/m, `TEST_DATABASE_URL="${url("templates_test")}"`);
    writeFileSync(envFile, env, { mode: 0o600 });
    console.log("Wrote apps/api/.env (git-ignored) with local connection strings.");
  } else {
    console.log("apps/api/.env already exists; left unchanged.");
  }
}

const command = process.argv[2] ?? "status";
try {
  if (command === "init") init();
  else if (command === "start") start();
  else if (command === "stop") {
    if (isRunning()) must("pg_ctl", ["-D", dataDir, "-w", "stop"]);
    console.log("Local PostgreSQL stopped.");
  } else if (command === "status") {
    console.log(isRunning() ? `Running on 127.0.0.1:${port}.` : "Not running.");
  } else {
    throw new Error("Commands: init, start, stop, status");
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}
