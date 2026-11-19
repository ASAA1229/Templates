import { existsSync } from "node:fs";
import { lstat, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  environmentSpecSchema,
  versionSatisfies,
  type EnvironmentCheckResultView,
  type EnvironmentCheckView,
  type EnvironmentSpec,
  type EnvironmentTool,
} from "@asaa/contracts";
import { baseEnvironment, ProcessUnavailableError, runProcess } from "../../lib/process.js";
import type { GitClient } from "./git.js";

const SECRET_NAME = /(SECRET|TOKEN|PASSWORD|PASSWD|PRIVATE|API_?KEY|CREDENTIAL)/;

async function readSmallText(file: string, limit = 256 * 1024): Promise<string | null> {
  const stats = await lstat(file).catch(() => null);
  if (!stats?.isFile() || stats.isSymbolicLink() || stats.size > limit) return null;
  return readFile(file, "utf8");
}

/**
 * Infer an initial environment specification from a generated project folder:
 * package.json (engines, scripts) and .env.example (variable names only — values
 * are copied as examples only when clearly non-secret). The owner can edit it.
 */
export async function inferEnvironment(dir: string | null): Promise<EnvironmentSpec> {
  const tools: EnvironmentSpec["tools"] = [{ name: "git", version: ">=2.28", required: true }];
  const commands: EnvironmentSpec["commands"] = { install: [], dev: [], build: [], test: [] };
  let packageManager: EnvironmentSpec["packageManager"] = { name: "none", version: "*" };
  const variables: EnvironmentSpec["variables"] = [];
  let database: EnvironmentSpec["database"] = { engine: "none", version: "*" };

  const pkgText = dir ? await readSmallText(path.join(dir, "package.json")) : null;
  if (pkgText) {
    try {
      const pkg = JSON.parse(pkgText) as { engines?: { node?: string }; scripts?: Record<string, string> };
      const nodeRequirement = pkg.engines?.node?.match(/^>=\s*(\d{1,3})/)?.[1];
      tools.unshift(
        { name: "node", version: nodeRequirement ? `>=${nodeRequirement}` : ">=22", required: true },
        { name: "npm", version: ">=10", required: true },
      );
      packageManager = { name: "npm", version: ">=10" };
      commands.install = ["npm install"];
      const scripts = pkg.scripts ?? {};
      if (scripts.dev) commands.dev = ["npm run dev"];
      if (scripts.build) commands.build = ["npm run build"];
      if (scripts.test) commands.test = ["npm test"];
    } catch {
      /* not JSON: leave node tooling out */
    }
  }

  const envText = dir ? await readSmallText(path.join(dir, ".env.example"), 64 * 1024) : null;
  for (const line of envText?.split(/\r?\n/) ?? []) {
    const match = line.match(/^([A-Z][A-Z0-9_]{0,63})=(.*)$/);
    if (!match || variables.some((variable) => variable.name === match[1])) continue;
    const name = match[1]!;
    const secret = SECRET_NAME.test(name);
    const value = match[2]!.trim().replace(/^"|"$/g, "");
    const safeExample = !secret && value.length <= 200 && !/:\/\/[^/\s:@]+:[^/\s@]+@/.test(value);
    variables.push({ name, description: "", required: false, secret, example: safeExample ? value : "" });
    if (name === "DATABASE_URL") database = { engine: "postgresql", version: ">=16" };
  }
  if (database.engine === "postgresql") tools.push({ name: "postgresql", version: ">=16", required: false });

  return environmentSpecSchema.parse({ tools, packageManager, commands, variables, database });
}

/** Locate npm's CLI script next to the running Node.js (works without a shell on Windows and POSIX). */
function npmCli(): string | null {
  const nodeDir = path.dirname(process.execPath);
  const candidates = [
    path.join(nodeDir, "node_modules", "npm", "bin", "npm-cli.js"),
    path.join(nodeDir, "..", "lib", "node_modules", "npm", "bin", "npm-cli.js"),
  ];
  return candidates.find((candidate) => existsSync(candidate)) ?? null;
}

async function probe(executable: string, args: string[]): Promise<string | null> {
  try {
    const result = await runProcess(executable, args, {
      cwd: tmpdir(),
      timeoutMs: 8000,
      maxOutputBytes: 16 * 1024,
      env: baseEnvironment(),
    });
    if (result.exitCode !== 0) return null;
    return (result.stdout + result.stderr).match(/(\d+\.\d+(?:\.\d+)?)/)?.[1] ?? null;
  } catch (error) {
    if (error instanceof ProcessUnavailableError) return null;
    return null;
  }
}

/**
 * Check whether this machine has the tools the specification requires. Only
 * read-only `--version` probes of a fixed allowlist are executed; nothing is
 * installed or changed on the host.
 */
export async function checkEnvironment(spec: EnvironmentSpec, git: GitClient): Promise<EnvironmentCheckView> {
  const versions: Partial<Record<EnvironmentTool, () => Promise<string | null>>> = {
    node: async () => process.versions.node,
    npm: async () => {
      const cli = npmCli();
      return cli ? probe(process.execPath, [cli, "--version"]) : null;
    },
    git: async () => git.version().catch(() => null),
    pnpm: () => probe("pnpm", ["--version"]),
    yarn: () => probe("yarn", ["--version"]),
    postgresql: () => probe("psql", ["--version"]),
    docker: () => probe("docker", ["--version"]),
  };
  const requirements = [...spec.tools];
  if (spec.packageManager.name !== "none" && !requirements.some((tool) => tool.name === spec.packageManager.name)) {
    requirements.push({ name: spec.packageManager.name, version: spec.packageManager.version, required: true });
  }
  if (spec.database.engine === "postgresql" && !requirements.some((tool) => tool.name === "postgresql")) {
    requirements.push({ name: "postgresql", version: spec.database.version, required: true });
  }
  const results: EnvironmentCheckResultView[] = [];
  for (const tool of requirements) {
    const version = await versions[tool.name]!();
    const found = version !== null;
    const ok = found && versionSatisfies(version, tool.version);
    results.push({
      name: tool.name,
      requirement: tool.version,
      required: tool.required,
      found,
      version,
      ok,
      message: !found
        ? process.platform === "win32" && (tool.name === "pnpm" || tool.name === "yarn")
          ? "Not found on PATH (command shims that need a shell are not executed)."
          : "Not found on PATH."
        : ok
          ? "Available."
          : `Version ${version} does not meet ${tool.version}.`,
    });
  }
  return {
    checkedAt: new Date().toISOString(),
    ok: results.every((result) => result.ok || !result.required),
    results,
  };
}
