import { cpSync, existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";

/**
 * Prepare a disposable copy of the template library for E2E runs, plus one extra package
 * (`release-demo`) that no other spec touches, so the release-lifecycle journey starts from a template
 * with no release record. The copy happens once per run (workers inherit E2E_LIBRARY_READY).
 */
export function prepareE2eLibrary(repoRoot: string): string {
  const target = path.join(repoRoot, ".local", "e2e-library");
  if (process.env.E2E_LIBRARY_READY === "1" && existsSync(target)) return target;
  const source = path.join(repoRoot, "apps", "api", "template-library");
  rmSync(target, { recursive: true, force: true });
  cpSync(source, target, { recursive: true });
  const from = path.join(target, "clinic-essential", "1.0.0");
  // One version per attempt (1.0.0 first run; 1.0.1/1.0.2 for retries) so a retried journey never meets a
  // release record left by an earlier attempt.
  for (const version of ["1.0.0", "1.0.1", "1.0.2"]) {
    const to = path.join(target, "release-demo", version);
    cpSync(from, to, { recursive: true });
    const manifestPath = path.join(to, "manifest.json");
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as { id: string; title: string; version: string };
    manifest.id = "release-demo";
    manifest.title = "Release lifecycle demo";
    manifest.version = version;
    writeFileSync(
      manifestPath,
      `${JSON.stringify(manifest, null, 2)}
`,
    );
  }
  process.env.E2E_LIBRARY_READY = "1";
  return target;
}
