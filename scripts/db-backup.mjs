#!/usr/bin/env node
/**
 * Database + file backup, verification and restore drill (RG-10). No extra dependencies.
 *
 *   node scripts/db-backup.mjs backup --out <dir>         pg_dump (custom format) + template library +
 *                                                         generated output + backup-manifest.json
 *   node scripts/db-backup.mjs verify --dir <backup>      recompute checksums, parse the dump with pg_restore --list
 *   node scripts/db-backup.mjs restore-check --dir <dir>  restore into a NEW scratch database, compare row counts
 *                                                         with the manifest, print PASS/FAIL, always drop the scratch DB
 *
 * DATABASE_URL comes from the environment, falling back to apps/api/.env. The password is only ever passed to
 * child processes through PGPASSWORD; it is never logged or written to the manifest. restore-check refuses to
 * restore over the database named in DATABASE_URL.
 */
import { spawnSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const MANIFEST = "backup-manifest.json";
const DUMP = "database.dump";
const KEY_TABLES = ["Owner", "Project", "Requirement", "AuditEvent", "CatalogItem", "ProjectGeneration"];

class Failure extends Error {}

function readEnvFile(name) {
  const file = path.join(root, "apps", "api", ".env");
  if (!existsSync(file)) return undefined;
  const match = readFileSync(file, "utf8").match(new RegExp(`^${name}="?([^"\\r\\n]+)"?`, "m"));
  return match?.[1];
}

function resolveSetting(name) {
  return process.env[name] || readEnvFile(name);
}

function parseConnection() {
  const raw = resolveSetting("DATABASE_URL");
  if (!raw) throw new Failure("DATABASE_URL is not set (environment or apps/api/.env).");
  let url;
  try {
    url = new URL(raw);
  } catch {
    throw new Failure("DATABASE_URL is not a valid URL.");
  }
  if (!/^postgres(ql)?:$/.test(url.protocol)) throw new Failure("DATABASE_URL must be a PostgreSQL URL.");
  return {
    host: url.hostname || "127.0.0.1",
    port: url.port || "5432",
    user: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
    database: decodeURIComponent(url.pathname.replace(/^\//, "")),
  };
}

function connArgs(conn, database) {
  return ["--host", conn.host, "--port", conn.port, "--username", conn.user, "--dbname", database];
}

/** Run a PostgreSQL client tool. The password travels only via PGPASSWORD; output is scrubbed of it. */
function run(tool, args, conn, { allowFail = false } = {}) {
  const env = { ...process.env, PGPASSWORD: conn?.password ?? "" };
  const result = spawnSync(tool, args, { env, encoding: "utf8", maxBuffer: 256 * 1024 * 1024 });
  if (result.error) throw new Failure(`Could not run ${tool}: ${result.error.code ?? result.error.message}`);
  const scrub = (text) => (conn?.password ? text.split(conn.password).join("***") : text);
  const stdout = scrub(result.stdout ?? "");
  const stderr = scrub(result.stderr ?? "");
  if (result.status !== 0 && !allowFail) {
    throw new Failure(`${tool} failed (exit ${result.status}): ${stderr.trim().split("\n").slice(-3).join(" | ")}`);
  }
  return { status: result.status, stdout, stderr };
}

function psql(conn, database, sql) {
  return run(
    "psql",
    [...connArgs(conn, database), "-X", "-A", "-t", "-v", "ON_ERROR_STOP=1", "-c", sql],
    conn,
  ).stdout.trim();
}

function quoteIdent(name) {
  return `"${name.replace(/"/g, '""')}"`;
}

function sha256(file) {
  return createHash("sha256").update(readFileSync(file)).digest("hex");
}

function walk(dir, base = dir) {
  const files = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...walk(full, base));
    else if (entry.isFile()) files.push(path.relative(base, full).split(path.sep).join("/"));
  }
  return files.sort();
}

function countTables(conn, database) {
  const counts = {};
  for (const table of KEY_TABLES)
    counts[table] = Number(psql(conn, database, `SELECT count(*) FROM ${quoteIdent(table)}`));
  counts._prisma_migrations = Number(psql(conn, database, "SELECT count(*) FROM _prisma_migrations"));
  return counts;
}

function toolVersion(tool) {
  try {
    return run(tool, ["--version"], undefined).stdout.trim();
  } catch {
    return undefined;
  }
}

function gitCommit() {
  const result = spawnSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" });
  return result.status === 0 ? result.stdout.trim() : undefined;
}

function option(name) {
  const index = process.argv.indexOf(name);
  const value = index > 0 ? process.argv[index + 1] : undefined;
  if (!value || value.startsWith("--")) throw new Failure(`Missing required option ${name} <path>.`);
  return path.resolve(value);
}

function backup() {
  const out = option("--out");
  const conn = parseConnection();
  if (existsSync(out) && readdirSync(out).length > 0) throw new Failure("Backup directory must be empty or not exist.");
  mkdirSync(out, { recursive: true });

  const counts = countTables(conn, conn.database);
  run(
    "pg_dump",
    ["--format=custom", "--no-owner", "--file", path.join(out, DUMP), ...connArgs(conn, conn.database)],
    conn,
  );

  const sources = {
    "template-library": path.join(root, "apps", "api", "template-library"),
    generated: path.resolve(resolveSetting("GENERATION_OUTPUT_DIR") || path.join(root, ".local", "generated")),
  };
  const copied = [];
  for (const [name, source] of Object.entries(sources)) {
    if (existsSync(source) && statSync(source).isDirectory()) {
      cpSync(source, path.join(out, "files", name), { recursive: true });
      copied.push(name);
    }
  }

  const files = walk(out).filter((file) => file !== MANIFEST);
  const manifest = {
    format: 1,
    createdAt: new Date().toISOString(),
    gitCommit: gitCommit() ?? null,
    pgDumpVersion: toolVersion("pg_dump") ?? null,
    database: { name: conn.database, host: conn.host, port: conn.port },
    sourceCounts: counts,
    copiedDirectories: copied,
    files: Object.fromEntries(
      files.map((file) => [file, { sha256: sha256(path.join(out, file)), size: statSync(path.join(out, file)).size }]),
    ),
  };
  writeFileSync(path.join(out, MANIFEST), JSON.stringify(manifest, null, 2) + "\n");
  console.log(`Backup written: ${out} (${files.length} files; copied: ${copied.join(", ") || "none"})`);
}

function loadManifest(dir) {
  const file = path.join(dir, MANIFEST);
  if (!existsSync(file)) throw new Failure(`${MANIFEST} not found in backup directory.`);
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch {
    throw new Failure(`${MANIFEST} is not valid JSON.`);
  }
}

function verify(dir) {
  const manifest = loadManifest(dir);
  const problems = [];
  const expected = Object.keys(manifest.files ?? {});
  if (!expected.includes(DUMP)) problems.push(`${DUMP} missing from manifest`);
  for (const file of expected) {
    const full = path.join(dir, file);
    if (!existsSync(full)) {
      problems.push(`missing file: ${file}`);
      continue;
    }
    const info = manifest.files[file];
    if (statSync(full).size !== info.size) problems.push(`size mismatch: ${file}`);
    if (sha256(full) !== info.sha256) problems.push(`checksum mismatch: ${file}`);
  }
  for (const file of walk(dir)) {
    if (file !== MANIFEST && !expected.includes(file)) problems.push(`unexpected file: ${file}`);
  }
  if (!problems.some((problem) => problem.includes(DUMP))) {
    const list = run("pg_restore", ["--list", path.join(dir, DUMP)], undefined, { allowFail: true });
    if (list.status !== 0) problems.push("pg_restore --list could not parse the dump");
  }
  if (problems.length > 0) throw new Failure(`Verification FAILED: ${problems.join("; ")}`);
  console.log(`Verification PASS: ${expected.length} files match the manifest and the dump parses.`);
  return manifest;
}

function restoreCheck(dir) {
  const manifest = verify(dir);
  const conn = parseConnection();
  const scratch = `restore_check_${randomBytes(5).toString("hex")}`;
  if (scratch === conn.database) throw new Failure("Refusing to restore over the DATABASE_URL database.");
  const expected = manifest.sourceCounts ?? {};
  const failures = [];
  let created = false;
  try {
    psql(conn, "postgres", `CREATE DATABASE ${quoteIdent(scratch)}`);
    created = true;
    run("pg_restore", ["--no-owner", "--exit-on-error", ...connArgs(conn, scratch), path.join(dir, DUMP)], conn);
    const actual = countTables(conn, scratch);
    for (const key of [...KEY_TABLES, "_prisma_migrations"]) {
      if (actual[key] !== expected[key]) failures.push(`${key}: expected ${expected[key]}, restored ${actual[key]}`);
    }
    console.log(
      `Restored counts: ${Object.entries(actual)
        .map(([key, value]) => `${key}=${value}`)
        .join(", ")}`,
    );
  } catch (error) {
    failures.push(error instanceof Error ? error.message : String(error));
  } finally {
    if (created) {
      try {
        psql(conn, "postgres", `DROP DATABASE IF EXISTS ${quoteIdent(scratch)} WITH (FORCE)`);
      } catch (error) {
        failures.push(`could not drop scratch database ${scratch}: ${error.message}`);
      }
    }
  }
  if (failures.length > 0) throw new Failure(`Restore check FAIL: ${failures.join("; ")}`);
  console.log(`Restore check PASS (scratch database ${scratch} restored and dropped).`);
}

try {
  const command = process.argv[2];
  if (command === "backup") backup();
  else if (command === "verify") verify(option("--dir"));
  else if (command === "restore-check") restoreCheck(option("--dir"));
  else throw new Failure("Usage: db-backup.mjs <backup --out DIR | verify --dir DIR | restore-check --dir DIR>");
} catch (error) {
  console.error(error instanceof Failure ? error.message : `Unexpected error: ${error?.message ?? error}`);
  process.exitCode = 1;
}
