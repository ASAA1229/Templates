/**
 * PostgreSQL binary consistency check. A partial upgrade (for example postgres 18.6 next to initdb 18.7) makes
 * initdb abort deep inside the database stage, so the prerequisites check and `db:local` use this to fail early
 * with a clear message. Pure functions are exported for unit tests.
 */
import { spawnSync } from "node:child_process";

/** "postgres (PostgreSQL) 18.6" -> "18.6" (also handles "17.2 (Debian ...)", "16beta1" -> "16"). */
export function parsePgVersion(text) {
  const match = /(\d+)(?:\.(\d+))?/.exec(String(text ?? ""));
  if (!match) return null;
  return match[2] === undefined ? match[1] : `${match[1]}.${match[2]}`;
}

/**
 * @param {Record<string, string>} outputs tool name -> `--version` output
 * @returns {{ok: boolean, versions: Record<string, string|null>, message: string}}
 */
export function comparePgVersions(outputs) {
  const versions = Object.fromEntries(Object.entries(outputs).map(([tool, text]) => [tool, parsePgVersion(text)]));
  const unknown = Object.entries(versions)
    .filter(([, v]) => v === null)
    .map(([tool]) => tool);
  if (unknown.length > 0) {
    return {
      ok: false,
      versions,
      message: `Could not read the version of: ${unknown.join(", ")}. Repair the PostgreSQL install.`,
    };
  }
  const distinct = new Set(Object.values(versions));
  if (distinct.size === 1)
    return { ok: true, versions, message: `PostgreSQL binaries consistent (${[...distinct][0]}).` };
  const detail = Object.entries(versions)
    .map(([tool, v]) => `${tool} ${v}`)
    .join(" vs ");
  return {
    ok: false,
    versions,
    message: `PostgreSQL binaries version mismatch: ${detail}; repair the PostgreSQL install.`,
  };
}

/** Probe the tools on PATH (postgres is looked up next to pg_ctl when not on PATH). */
export function checkInstalledPostgres(tools = ["postgres", "initdb", "pg_ctl", "psql"]) {
  const outputs = {};
  for (const tool of tools) {
    const result = spawnSync(tool, ["--version"], { encoding: "utf8" });
    if (result.error || result.status !== 0) {
      if (tool === "postgres") continue; // optional on PATH; the other tools still catch a mismatch
      return { ok: false, versions: outputs, message: `${tool} is not runnable; install or repair PostgreSQL.` };
    }
    outputs[tool] = result.stdout;
  }
  return comparePgVersions(outputs);
}
