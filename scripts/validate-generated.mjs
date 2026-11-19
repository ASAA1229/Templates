#!/usr/bin/env node
/**
 * Validate generated projects through real installation and builds.
 *   npm run validate:generated [-- --only <substring>] [--keep]
 * Generates each starter variant (no database; same pipeline as certification) into a temp dir, runs
 * `npm install` with an isolated cache, then build / typecheck / test when the generated package.json declares them.
 * Static (HTML-only) templates get a file sanity check. Report: .local/generated-validation/report.json
 */
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const library = path.join(root, "apps/api/template-library");
const helper = path.join(root, "apps/api/src/cli/generate-for-validation.ts");
const reportFile = path.join(root, ".local/generated-validation/report.json");
const isWin = process.platform === "win32";
const INSTALL_TIMEOUT = 8 * 60_000;
const BUILD_TIMEOUT = 5 * 60_000;
const GENERATE_TIMEOUT = 2 * 60_000;
const args = process.argv.slice(2);
const only = args.includes("--only") ? args[args.indexOf("--only") + 1] : null;
const keep = args.includes("--keep");

/** Buildable variants: default, includeTests both ways, every select option once. */
const VARIANTS = [
  { template: "starter-web-app", variant: "default", inputs: {} },
  { template: "starter-web-app", variant: "includeTests=false", inputs: { includeTests: false } },
  { template: "starter-web-app", variant: "includeTests=true", inputs: { includeTests: true } },
  { template: "starter-web-app", variant: "nodeVersion=22", inputs: { nodeVersion: "22" } },
  { template: "starter-api-service", variant: "default", inputs: {} },
  { template: "starter-api-service", variant: "nodeVersion=22", inputs: { nodeVersion: "22" } },
  { template: "starter-api-service", variant: "port=4000", inputs: { port: "4000" } },
  { template: "starter-api-service", variant: "port=8080", inputs: { port: "8080" } },
];

const npmCli = path.join(path.dirname(process.execPath), "node_modules/npm/bin/npm-cli.js");

/** Run a command without a shell. On Windows npm is run through node + npm-cli.js (no .cmd shim needed). */
function run(command, argv, { cwd, timeout }) {
  return new Promise((resolve) => {
    const started = Date.now();
    let output = "";
    let timedOut = false;
    const viaNode = isWin && command === "npm" && existsSync(npmCli);
    const child = spawn(viaNode ? process.execPath : command, viaNode ? [npmCli, ...argv] : argv, {
      cwd,
      env: { ...process.env, CI: "true" },
      shell: false,
      windowsHide: true,
    });
    const timer = setTimeout(() => {
      timedOut = true;
      if (isWin) spawn("taskkill", ["/pid", String(child.pid), "/t", "/f"], { shell: false });
      else child.kill("SIGKILL");
    }, timeout);
    const collect = (chunk) => {
      output = (output + chunk.toString()).slice(-60_000);
    };
    child.stdout.on("data", collect);
    child.stderr.on("data", collect);
    child.on("error", (error) => {
      clearTimeout(timer);
      resolve({ ok: false, code: -1, seconds: 0, tail: String(error) });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      const tail = output.trim().split(/\r?\n/).slice(-15).join("\n");
      resolve({
        ok: code === 0 && !timedOut,
        code: timedOut ? "timeout" : code,
        seconds: (Date.now() - started) / 1000,
        tail,
      });
    });
  });
}

const step = (r) => ({
  ok: r.ok,
  exitCode: r.code,
  seconds: Number(r.seconds.toFixed(1)),
  ...(r.ok ? {} : { tail: r.tail }),
});
const skipped = { ok: null, skipped: true };

function generate(template, inputs, out) {
  // Run tsx's CLI through node directly (no shell, so the JSON argument is passed verbatim on every platform).
  const tsx = path.join(root, "node_modules/tsx/dist/cli.mjs");
  return run(
    process.execPath,
    [tsx, helper, "--out", out, "--template", template, "--version", "1.0.0", "--inputs", JSON.stringify(inputs)],
    { cwd: path.join(root, "apps/api"), timeout: GENERATE_TIMEOUT },
  );
}

async function validateBuildable(entry, base) {
  const dir = path.join(base, `${entry.template}-${entry.variant.replace(/[^a-z0-9]+/gi, "-")}`);
  const result = { template: entry.template, variant: entry.variant, kind: "buildable", ok: false };
  const gen = await generate(entry.template, entry.inputs, dir);
  result.generate = step(gen);
  if (!gen.ok) return result;
  const pkg = JSON.parse(await readFile(path.join(dir, "package.json"), "utf8"));
  const scripts = pkg.scripts ?? {};
  const cache = path.join(base, "npm-cache");
  const install = await run("npm", ["install", "--no-audit", "--no-fund", "--ignore-scripts=false", "--cache", cache], {
    cwd: dir,
    timeout: INSTALL_TIMEOUT,
  });
  result.install = step(install);
  if (!install.ok) return result;
  let allOk = true;
  for (const name of ["build", "typecheck", "test"]) {
    if (!scripts[name]) {
      result[name] = skipped;
      continue;
    }
    const r = await run("npm", ["run", name, "--silent"], { cwd: dir, timeout: BUILD_TIMEOUT });
    result[name] = step(r);
    allOk &&= r.ok;
  }
  if (!scripts.build && !scripts.typecheck) {
    // dev/start-only projects must at least type check.
    const r = await run("npm", ["exec", "--", "tsc", "--noEmit", "-p", "tsconfig.json"], {
      cwd: dir,
      timeout: BUILD_TIMEOUT,
    });
    result.typecheck = step(r);
    allOk &&= r.ok;
  }
  result.ok = allOk;
  return result;
}

/** Static templates: generate with sample values and check the output is a plausible site. */
async function validateStatic(id, base) {
  const dir = path.join(base, `static-${id}`);
  const result = { template: id, variant: "default", kind: "static", ok: false };
  const gen = await generate(id, {}, dir);
  result.generate = step(gen);
  if (!gen.ok) return result;
  const html = (await readdir(dir, { recursive: true })).filter((n) => n.endsWith(".html"));
  const problems = [];
  if (!html.length) problems.push("no HTML files generated");
  for (const file of html) {
    const text = await readFile(path.join(dir, file), "utf8");
    if (!/<title>[^<]+<\/title>/i.test(text)) problems.push(`${file}: missing title`);
    if (/\{\{[^}]*\}\}/.test(text)) problems.push(`${file}: unresolved placeholder`);
  }
  result.static = { ok: problems.length === 0, problems };
  result.ok = problems.length === 0;
  if (!result.ok) result.generate = { ...result.generate, ok: false, tail: problems.slice(0, 15).join("\n") };
  return result;
}

async function listStatic() {
  const buildable = new Set(VARIANTS.map((v) => v.template));
  const ids = [];
  for (const entry of await readdir(library, { withFileTypes: true })) {
    if (!entry.isDirectory() || buildable.has(entry.name) || entry.name === "starter-blank") continue;
    ids.push(entry.name);
  }
  return ids.sort();
}

const base = await mkdtemp(path.join(tmpdir(), "asaa-validate-"));
const results = [];
const started = Date.now();
try {
  for (const entry of VARIANTS) {
    if (only && !`${entry.template} ${entry.variant}`.includes(only)) continue;
    console.log(`> ${entry.template} [${entry.variant}]`);
    results.push(await validateBuildable(entry, base));
  }
  // starter-blank has no package.json; it only has to generate.
  if (!only || "starter-blank".includes(only)) {
    const gen = await generate("starter-blank", {}, path.join(base, "starter-blank"));
    results.push({ template: "starter-blank", variant: "default", kind: "static", ok: gen.ok, generate: step(gen) });
  }
  for (const id of await listStatic()) {
    if (only && !id.includes(only)) continue;
    results.push(await validateStatic(id, base));
  }
} finally {
  if (!keep) await rm(base, { recursive: true, force: true, maxRetries: 3 }).catch(() => {});
}

const cell = (s) =>
  !s ? "-" : s.skipped ? "skipped" : `${s.ok ? "ok" : "FAIL"}${s.seconds !== undefined ? ` ${s.seconds}s` : ""}`;
console.log("\nproject / variant                          generate  install        build          typecheck      test");
for (const r of results.filter((x) => x.kind === "buildable")) {
  const label = `${r.template} [${r.variant}]`.padEnd(42);
  console.log(
    `${label} ${cell(r.generate).padEnd(9)} ${cell(r.install).padEnd(14)} ${cell(r.build).padEnd(14)} ${cell(r.typecheck).padEnd(14)} ${cell(r.test)}`,
  );
}
const statics = results.filter((r) => r.kind === "static");
console.log(`static templates: ${statics.filter((r) => r.ok).length}/${statics.length} ok`);
const failed = results.filter((r) => !r.ok);
for (const r of failed) {
  console.log(`\nFAILED ${r.template} [${r.variant}]`);
  for (const name of ["generate", "install", "build", "typecheck", "test"]) {
    const s = r[name];
    if (s && s.ok === false) console.log(`  ${name} exit ${s.exitCode}:\n${(s.tail ?? "").replace(/^/gm, "    ")}`);
  }
}
await mkdir(path.dirname(reportFile), { recursive: true });
const report = {
  schemaVersion: 1,
  node: process.version,
  platform: process.platform,
  totalSeconds: Number(((Date.now() - started) / 1000).toFixed(1)),
  summary: { total: results.length, failed: failed.length },
  results,
};
await writeFile(reportFile, `${JSON.stringify(report, null, 2)}\n`);
console.log(`\n${results.length - failed.length}/${results.length} ok. Report: ${reportFile}`);
process.exit(failed.length ? 1 : 0);
