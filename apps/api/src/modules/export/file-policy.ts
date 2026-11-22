import { scanForSecrets } from "../../certification/secret-scan.js";
import { notEligible } from "../../lib/errors.js";

/**
 * One file policy shared by every path that moves project files out of (or into a sandbox from) the generated
 * folder: ZIP/workspace export, repository hand-off, deployment bundles, connector publishing, job copies and
 * workspace writes. Path-traversal and symlink handling stay with the walkers; this module owns what may leave.
 */
export const EXCLUDED_DIRECTORIES: ReadonlySet<string> = new Set([".git", "node_modules"]);

const SECRET_FILE_NAMES = [/^\.env(?:\..+)?$/i, /\.(?:pem|key|p12|pfx|jks)$/i, /^id_(?:rsa|ed25519|ecdsa)$/i];

/** Credential-bearing file names (.env, private keys). "*.example" files are templates and are allowed. */
export function isSecretFileName(name: string): boolean {
  const base = name.split("/").pop() ?? name;
  return SECRET_FILE_NAMES.some((rule) => rule.test(base)) && !/\.example$/i.test(base);
}

/** Refuse to ship text that contains a high-confidence credential. Findings never include secret values. */
export function assertNoSecretContent(files: { path: string; content: Buffer }[]): void {
  const findings = scanForSecrets(new Map(files.map((file) => [file.path, file.content])));
  if (findings.length > 0) {
    const shown = findings
      .slice(0, 5)
      .map((finding) => `${finding.file} (${finding.rule})`)
      .join(", ");
    throw notEligible(`Cannot export: possible credentials found in ${shown}. Remove them and try again.`);
  }
}
