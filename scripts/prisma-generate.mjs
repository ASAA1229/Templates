#!/usr/bin/env node
/**
 * Robust `prisma generate` for Windows/OneDrive environments.
 *
 * Problem: regenerating the client renames query_engine-*.node.tmp* over the engine DLL; if any process
 * (a running API/test server, antivirus, OneDrive sync) holds the DLL open the rename fails with EPERM.
 *
 * Behaviour:
 *  1. If the generated client already matches apps/api/prisma/schema.prisma (line endings ignored) and
 *     the engine exists, skip regeneration. Types are therefore still exactly current: nothing is weakened.
 *  2. Otherwise remove stale *.tmp* engine files left by earlier failed runs and run `prisma generate`
 *     with a few retries.
 */
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const apiDir = path.join(root, "apps", "api");
const schema = path.join(apiDir, "prisma", "schema.prisma");
const clientDir = path.join(root, "node_modules", ".prisma", "client");
const normalize = (file) => readFileSync(file, "utf8").replace(/\r\n/g, "\n");

function isCurrent() {
  const generated = path.join(clientDir, "schema.prisma");
  if (!existsSync(generated)) return false;
  const engines = readdirSync(clientDir).filter(
    (name) => /^query_engine.*\.node$/.test(name) || name.startsWith("libquery_engine"),
  );
  return engines.length > 0 && normalize(generated) === normalize(schema);
}

if (!process.argv.includes("--force") && isCurrent()) {
  console.log("Prisma client already matches the schema; skipping generate.");
  process.exit(0);
}

for (const name of existsSync(clientDir) ? readdirSync(clientDir) : []) {
  if (/\.tmp\d*$/.test(name)) rmSync(path.join(clientDir, name), { force: true });
}

let status = 1;
for (let attempt = 1; attempt <= 4; attempt++) {
  const result = spawnSync("npx", ["prisma", "generate"], { cwd: apiDir, stdio: "inherit", shell: true });
  status = result.status ?? 1;
  if (status === 0) break;
  console.error(`prisma generate failed (attempt ${attempt}/4); another process may hold the engine file. Retrying...`);
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 2000);
}
process.exit(status);
