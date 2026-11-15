#!/usr/bin/env node
/**
 * Package-manager authority guard. npm + package-lock.json are authoritative for this monorepo.
 *
 * Enforces (fails with a non-zero exit code and one line per problem):
 *   1. package.json declares `packageManager` as npm@<x.y.z> and `engines.node` / `engines.npm`.
 *   2. The npm that is running satisfies the declared major version and the Node.js engine range.
 *   3. package-lock.json exists, is lockfileVersion >= 3, and no competing lockfile
 *      (yarn.lock, pnpm-lock.yaml, bun.lock, bun.lockb, npm-shrinkwrap.json) exists at the root or in a workspace.
 *   4. Workspace packages do not carry their own lockfile or a conflicting `packageManager`.
 *   5. The lockfile is in sync with every package.json: `npm ci --dry-run` validates it without touching node_modules.
 *
 * Usage: node scripts/check-package-manager.mjs [--skip-sync]   (--skip-sync only for offline unit use)
 */
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const problems = [];
const readJson = (file) => JSON.parse(readFileSync(path.join(root, file), "utf8"));
const rel = (...parts) => parts.join("/");

function parseVersion(text) {
  const match = /(\d+)\.(\d+)\.(\d+)/.exec(String(text ?? ""));
  return match ? match.slice(1).map(Number) : null;
}

function satisfiesNodeEngine(range, versionText) {
  const version = parseVersion(versionText);
  if (!version) return false;
  const compare = (a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2];
  return String(range)
    .split("||")
    .some((alternative) =>
      [...alternative.matchAll(/(>=|<=|>|<|=)?\s*v?(\d+(?:\.\d+){0,2})/g)].every(([, op = "=", target]) => {
        const parts = target.split(".").map(Number);
        const wanted = [parts[0], parts[1] ?? 0, parts[2] ?? 0];
        const result = compare(version, wanted);
        return { ">=": result >= 0, "<=": result <= 0, ">": result > 0, "<": result < 0, "=": result === 0 }[op];
      }),
    );
}

const pkg = readJson("package.json");

// 1. Declarations
const declared = /^npm@(\d+\.\d+\.\d+)$/.exec(pkg.packageManager ?? "");
if (!declared) problems.push('package.json "packageManager" must be exactly npm@<major>.<minor>.<patch>.');
if (!pkg.engines?.node) problems.push('package.json "engines.node" must be declared.');
if (!pkg.engines?.npm) problems.push('package.json "engines.npm" must be declared.');

// 2. Running toolchain
if (declared) {
  const npmUserAgent = /npm\/(\d+\.\d+\.\d+)/.exec(process.env.npm_config_user_agent ?? "");
  const runningNpm = npmUserAgent?.[1] ?? spawnNpm(["--version"]).stdout.trim();
  if (parseVersion(runningNpm)?.[0] !== parseVersion(declared[1])[0]) {
    problems.push(
      `Running npm ${runningNpm || "(unknown)"} does not match the declared packageManager npm@${declared[1]} (major version must match).`,
    );
  }
}
if (pkg.engines?.node && !satisfiesNodeEngine(pkg.engines.node, process.versions.node)) {
  problems.push(`Running Node.js ${process.versions.node} does not satisfy engines.node "${pkg.engines.node}".`);
}

// 3. Lockfiles
const lockPath = "package-lock.json";
if (!existsSync(path.join(root, lockPath))) {
  problems.push("package-lock.json is missing.");
} else if ((readJson(lockPath).lockfileVersion ?? 0) < 3) {
  problems.push("package-lock.json must be lockfileVersion 3 or newer.");
}
const competing = ["yarn.lock", "pnpm-lock.yaml", "bun.lock", "bun.lockb", "npm-shrinkwrap.json"];
for (const file of competing) {
  if (existsSync(path.join(root, file))) problems.push(`${file} competes with package-lock.json.`);
}

// 4. Workspaces
const workspaceDirs = Array.isArray(pkg.workspaces) ? pkg.workspaces : (pkg.workspaces?.packages ?? []);
for (const dir of workspaceDirs) {
  for (const file of [lockPath, ...competing]) {
    if (existsSync(path.join(root, dir, file)))
      problems.push(`${rel(dir, file)} must not exist; the root package-lock.json is the only lockfile.`);
  }
  const workspacePackage = path.join(dir, "package.json");
  if (!existsSync(path.join(root, workspacePackage))) {
    problems.push(`${workspacePackage} is listed as a workspace but does not exist.`);
    continue;
  }
  const workspaceManager = readJson(workspacePackage).packageManager;
  if (workspaceManager && workspaceManager !== pkg.packageManager) {
    problems.push(
      `${workspacePackage} declares packageManager "${workspaceManager}" which conflicts with the root "${pkg.packageManager}".`,
    );
  }
}

// 5. Lockfile / package.json synchronisation
function spawnNpm(args) {
  const bundledNpm = path.join(path.dirname(process.execPath), "node_modules", "npm", "bin", "npm-cli.js");
  const execPath = process.env.npm_execpath ?? (existsSync(bundledNpm) ? bundledNpm : undefined);
  if (execPath && /npm-cli\.js$/.test(execPath)) {
    return spawnSync(process.execPath, [execPath, ...args], { cwd: root, encoding: "utf8" });
  }
  // Fixed, constant arguments only; the shell is required to launch npm.cmd on Windows.
  return spawnSync(process.platform === "win32" ? "npm.cmd" : "npm", args, {
    cwd: root,
    encoding: "utf8",
    shell: process.platform === "win32",
  });
}
if (!process.argv.includes("--skip-sync") && existsSync(path.join(root, lockPath))) {
  const result = spawnNpm(["ci", "--dry-run", "--ignore-scripts", "--no-audit", "--no-fund"]);
  if (result.error || result.status !== 0) {
    const lines = (result.stderr || result.stdout || String(result.error ?? ""))
      .split("\n")
      .filter((line) => line.replace(/^npm error\s*/, "").trim());
    const usageStart = lines.findIndex((line) => /Clean install a project/.test(line));
    const detail = (usageStart > 0 ? lines.slice(0, usageStart) : lines.slice(0, 8)).join("\n");
    problems.push(`package-lock.json is out of sync with package.json (npm ci --dry-run failed):\n${detail}`);
  }
}

if (problems.length) {
  console.error("Package manager policy violations:");
  for (const problem of problems) console.error(` - ${problem}`);
  process.exit(1);
}
console.log(
  `Package manager OK: ${pkg.packageManager}, engines node "${pkg.engines.node}" npm "${pkg.engines.npm}", single package-lock.json in sync with all workspaces.`,
);
