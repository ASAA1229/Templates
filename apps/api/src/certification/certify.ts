import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { templateInputValuesSchema, type TemplateInputValues, type TemplateManifest } from "@asaa/contracts";
import { renderWithAdapter } from "../modules/generation/adapters.js";
import { isUsable, TemplateLibrary, type LibraryTemplate } from "../modules/generation/library.js";
import { projectVariables } from "../modules/generation/render.js";
import { scanForSecrets } from "./secret-scan.js";

/**
 * RG-04: per-package, per-version certification. Pure local checks; nothing is executed.
 * A package is CERTIFIED only when every check passes and its content digest equals the
 * digest recorded in the committed lock file (immutability: changed content needs a new
 * version and a deliberate lock update after review).
 */
export interface CertificationCheck {
  id: string;
  status: "pass" | "fail";
  detail: string;
}
export interface PackageCertification {
  id: string;
  version: string;
  kind: string | null;
  contentDigest: string | null;
  outputDigest: string | null;
  status: "CERTIFIED" | "FAILED";
  checks: CertificationCheck[];
}
export interface CertificationReport {
  schemaVersion: 1;
  summary: { total: number; certified: number; failed: number };
  packages: PackageCertification[];
}
export interface LockFile {
  schemaVersion: 1;
  packages: Record<string, { contentDigest: string; outputDigest: string }>;
}

export const LOCK_FILE = "certification.lock.json";
const EXACT_VERSION = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;
const APPROVED_LICENSES = new Set(["MIT", "Apache-2.0", "BSD-2-Clause", "BSD-3-Clause", "ISC", "Proprietary"]);

/** Deterministic sample values: defaults first, then a safe value per input type. */
export function sampleValues(manifest: TemplateManifest): TemplateInputValues {
  const sample: Record<string, string | boolean> = {};
  for (const input of manifest.inputs) {
    if (input.default !== undefined) continue;
    if (input.type === "select") sample[input.id] = input.options[0]!.value;
    else if (input.type === "boolean") sample[input.id] = false;
    else if (input.type === "string" && input.format === "email") sample[input.id] = "sample@example.com";
    else if (input.type === "string" && input.format === "color") sample[input.id] = "#2563eb";
    else if (input.type === "string" && input.format === "identifier") sample[input.id] = "sample";
    else sample[input.id] = "Sample value";
  }
  return templateInputValuesSchema(manifest.inputs).parse(sample) as TemplateInputValues;
}

const SAMPLE_PROJECT = projectVariables({
  key: "CERT",
  name: "Certification sample",
  purpose: "Certification dry run",
});

function htmlProblems(files: { path: string; content: Buffer }[]): string[] {
  const problems: string[] = [];
  for (const file of files.filter((f) => f.path.endsWith(".html"))) {
    const html = file.content.toString("utf8");
    if (!/<html[^>]*\blang=/i.test(html)) problems.push(`${file.path}: <html> needs a lang attribute`);
    if (!/<meta[^>]*name=["']viewport["']/i.test(html)) problems.push(`${file.path}: missing viewport meta`);
    if (!/<title>[^<]+<\/title>/i.test(html)) problems.push(`${file.path}: missing document title`);
    // Single-page-app shells render their landmarks and headings at runtime.
    const shell = /id=["']root["']/.test(html);
    if (!shell && !/<main[\s>]/i.test(html)) problems.push(`${file.path}: missing <main> landmark`);
    if (!shell && !/<h1[\s>]/i.test(html)) problems.push(`${file.path}: missing <h1>`);
    for (const img of html.match(/<img\b[^>]*>/gi) ?? []) {
      if (!/\balt=/i.test(img)) problems.push(`${file.path}: <img> without alt text`);
    }
    if (/<script\b[^>]*\bsrc=["']https?:/i.test(html)) problems.push(`${file.path}: external script`);
  }
  return problems;
}

export function certifyTemplate(template: LibraryTemplate, lock: LockFile | null): PackageCertification {
  const checks: CertificationCheck[] = [];
  const add = (id: string, problems: string[], ok: string) =>
    checks.push({ id, status: problems.length ? "fail" : "pass", detail: problems.length ? problems.join("; ") : ok });

  add("manifest-schema", template.problems, "manifest valid, matches its folder, files listed, placeholders declared");
  const result: PackageCertification = {
    id: template.id,
    version: template.version,
    kind: template.manifest?.kind ?? null,
    contentDigest: template.digest,
    outputDigest: null,
    status: "FAILED",
    checks,
  };
  if (!isUsable(template)) return result;
  const { manifest } = template;

  const licenseProblems: string[] = [];
  if (!APPROVED_LICENSES.has(manifest.license.spdx))
    licenseProblems.push(`license ${manifest.license.spdx} is not approved`);
  if (manifest.license.spdx === "Proprietary" && !manifest.license.notice) {
    licenseProblems.push("proprietary license needs a notice");
  }
  add("license", licenseProblems, manifest.license.spdx);
  add(
    "provenance",
    manifest.provenance.repository ? [] : ["provenance.repository is required"],
    `${manifest.provenance.maintainer} / ${manifest.provenance.repository}`,
  );

  const dependencyProblems: string[] = [];
  const declared = new Set<string>();
  for (const dependency of manifest.dependencies) {
    if (declared.has(dependency.name)) dependencyProblems.push(`duplicate dependency ${dependency.name}`);
    declared.add(dependency.name);
    if (!EXACT_VERSION.test(dependency.version)) {
      dependencyProblems.push(`${dependency.name}@${dependency.version} is not an exact version`);
    }
  }
  for (const packageJson of manifest.files.filter((file) => file.target === "package.json")) {
    try {
      const text = template.files
        .get(packageJson.source)!
        .toString("utf8")
        .replace(/\{\{[^}]*\}\}/g, "x");
      const parsed = JSON.parse(text) as Record<string, Record<string, string> | undefined>;
      for (const section of ["dependencies", "devDependencies"]) {
        for (const [name, range] of Object.entries(parsed[section] ?? {})) {
          if (!EXACT_VERSION.test(range)) dependencyProblems.push(`package.json ${name}@${range} is not pinned`);
          if (!declared.has(name))
            dependencyProblems.push(`package.json dependency ${name} is not declared in the manifest`);
        }
      }
    } catch {
      dependencyProblems.push("package.json is not valid JSON");
    }
  }
  add("dependencies", dependencyProblems, `${manifest.dependencies.length} declared, all pinned`);

  const findings = scanForSecrets(template.files);
  add(
    "secret-scan",
    findings.map((f) => `${f.file}${f.line ? `:${f.line}` : ""} (${f.rule})`),
    `${template.files.size} files scanned, no credentials`,
  );

  const dryRunProblems: string[] = [];
  let rendered: ReturnType<typeof renderWithAdapter> | null = null;
  try {
    const context = { manifest, sources: template.files, values: sampleValues(manifest), project: SAMPLE_PROJECT };
    rendered = renderWithAdapter(context);
    if (renderWithAdapter(context).digest !== rendered.digest) {
      dryRunProblems.push("two renders produced different output (non-deterministic)");
    }
  } catch (error) {
    dryRunProblems.push(error instanceof Error ? error.message : "render failed");
  }
  add("generation-dry-run", dryRunProblems, `rendered ${rendered?.files.length ?? 0} files deterministically`);
  result.outputDigest = rendered?.digest ?? null;
  if (rendered) {
    add(
      "static-quality",
      htmlProblems(rendered.files),
      "HTML has lang, viewport, title, main, h1, alt text; no external scripts",
    );
  }

  const integrityProblems: string[] = [];
  const recorded = lock?.packages[`${template.id}@${template.version}`];
  if (!recorded)
    integrityProblems.push("no certification lock entry (run certify:templates -- --update-lock after review)");
  else {
    if (recorded.contentDigest !== template.digest) {
      integrityProblems.push("content changed since certification; publish a new version");
    }
    if (result.outputDigest && recorded.outputDigest !== result.outputDigest) {
      integrityProblems.push("sample output changed since certification");
    }
  }
  add("integrity", integrityProblems, `sha256 ${template.digest?.slice(0, 16)} matches the lock`);

  result.status = checks.every((check) => check.status === "pass") ? "CERTIFIED" : "FAILED";
  return result;
}

export async function readLock(root: string): Promise<LockFile | null> {
  try {
    return JSON.parse(await readFile(path.join(root, LOCK_FILE), "utf8")) as LockFile;
  } catch {
    return null;
  }
}

export async function certifyLibrary(
  root: string,
  options: { lock?: LockFile | null } = {},
): Promise<CertificationReport> {
  const lock = options.lock === undefined ? await readLock(root) : options.lock;
  const templates = await new TemplateLibrary(root).list();
  const packages = templates.map((template) => certifyTemplate(template, lock));
  const certified = packages.filter((pkg) => pkg.status === "CERTIFIED").length;
  return {
    schemaVersion: 1,
    summary: { total: packages.length, certified, failed: packages.length - certified },
    packages,
  };
}

/** Lock entries for every package that passes all checks except the lock comparison itself. */
export async function buildLock(root: string): Promise<{ lock: LockFile; rejected: string[] }> {
  const report = await certifyLibrary(root, { lock: null });
  const lock: LockFile = { schemaVersion: 1, packages: {} };
  const rejected: string[] = [];
  for (const pkg of report.packages) {
    const others = pkg.checks.filter((check) => check.id !== "integrity");
    if (others.every((check) => check.status === "pass") && pkg.contentDigest && pkg.outputDigest) {
      lock.packages[`${pkg.id}@${pkg.version}`] = { contentDigest: pkg.contentDigest, outputDigest: pkg.outputDigest };
    } else rejected.push(`${pkg.id}@${pkg.version}`);
  }
  return { lock, rejected };
}

export async function writeLock(root: string, lock: LockFile): Promise<void> {
  const sorted = Object.fromEntries(Object.entries(lock.packages).sort(([a], [b]) => a.localeCompare(b)));
  await writeFile(path.join(root, LOCK_FILE), `${JSON.stringify({ ...lock, packages: sorted }, null, 2)}\n`, "utf8");
}
