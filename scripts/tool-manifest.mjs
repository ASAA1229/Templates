#!/usr/bin/env node
/**
 * Refresh the integrity manifest of every packaged tool under tools/<id>/.
 *   npm run tools:manifest            recompute sha256 and size of each file, write manifest.json
 *   npm run tools:manifest -- --check fail (exit 1) if a manifest is stale, without writing
 * Descriptive fields (title, license, provenance ...) are kept from the existing manifest; new tools get
 * the defaults below. Excluded from `files`: manifest.json itself, __pycache__ and *.pyc.
 * The output is deterministic, so running it twice leaves manifest.json byte-identical.
 */
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const toolsDir = path.resolve(process.env.TOOLS_DIR || path.join(root, "tools"));
const check = process.argv.includes("--check");

const DEFAULTS = {
  "env-snapshot": {
    id: "env-snapshot",
    version: "1.0.0",
    title: "Environment Snapshot (Linux/AIX)",
    description:
      "Offline, read-only Python 3.6+ tool that inventories a Linux or AIX host (OS, kernel, hardware, disks, packages, runtimes, network, services, limits) into TXT and JSON reports with secret redaction.",
    kind: "tool",
    language: "python",
    minRuntime: "3.6",
    offline: true,
    license: {
      spdx: "Proprietary",
      notice: "Internal ASAA tool. Not for redistribution outside the organisation and its engagement partners.",
    },
    provenance: { origin: "local", maintainer: "ASAA Platform Team", repository: "Templates/tools/env-snapshot" },
  },
};

async function listFiles(dir, prefix = "") {
  const found = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (entry.name === "__pycache__" || entry.name.endsWith(".pyc")) continue;
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) found.push(...(await listFiles(path.join(dir, entry.name), relative)));
    else if (entry.isFile() && relative !== "manifest.json") found.push(relative);
  }
  return found;
}

let stale = 0;
for (const entry of await readdir(toolsDir, { withFileTypes: true })) {
  if (!entry.isDirectory()) continue;
  const dir = path.join(toolsDir, entry.name);
  const manifestPath = path.join(dir, "manifest.json");
  const previous = existsSync(manifestPath)
    ? JSON.parse(await readFile(manifestPath, "utf8"))
    : (DEFAULTS[entry.name] ?? null);
  if (!previous) {
    console.log(`skip ${entry.name}: no manifest.json and no defaults`);
    continue;
  }
  const files = [];
  for (const relative of (await listFiles(dir)).sort()) {
    const bytes = await readFile(path.join(dir, relative));
    files.push({ path: relative, sha256: createHash("sha256").update(bytes).digest("hex"), bytes: bytes.length });
  }
  const { files: _old, ...descriptive } = previous;
  const next = `${JSON.stringify({ ...descriptive, files }, null, 2)}\n`;
  const current = existsSync(manifestPath) ? await readFile(manifestPath, "utf8") : "";
  if (check) {
    if (current !== next) {
      stale += 1;
      console.log(`STALE ${entry.name}`);
    } else console.log(`ok    ${entry.name} (${files.length} files)`);
  } else {
    if (current !== next) await writeFile(manifestPath, next, "utf8");
    console.log(`${current === next ? "unchanged" : "updated  "} ${entry.name}: ${files.length} files`);
  }
}
process.exit(stale ? 1 : 0);
