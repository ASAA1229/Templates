import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/** apps/api, from both src/lib (tsx) and dist/lib (compiled). */
const API_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

let cachedVersion: string | undefined;

/** Version from apps/api/package.json; "0.0.0" when it cannot be read. */
export function apiVersion(): string {
  if (cachedVersion) return cachedVersion;
  try {
    const parsed = JSON.parse(readFileSync(path.join(API_ROOT, "package.json"), "utf8")) as { version?: unknown };
    cachedVersion = typeof parsed.version === "string" ? parsed.version.slice(0, 64) : "0.0.0";
  } catch {
    cachedVersion = "0.0.0";
  }
  return cachedVersion;
}

/** Build commit SHA when the build pipeline exports BUILD_COMMIT (7-40 hex chars); otherwise null. */
export function buildCommit(env: NodeJS.ProcessEnv = process.env): string | null {
  const value = env.BUILD_COMMIT?.trim().toLowerCase();
  return value && /^[0-9a-f]{7,40}$/.test(value) ? value : null;
}
