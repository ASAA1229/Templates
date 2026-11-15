import { execFile } from "node:child_process";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { sha256, toolManifestSchema, type ToolManifest } from "../modules/tools/tools.js";
import { scanForSecrets } from "./secret-scan.js";

/**
 * Certification of packaged tools (tools/<id>): pure local checks plus a Python syntax check when an
 * interpreter is available. A tool is CERTIFIED only when no check fails ("skipped" is not a failure).
 */
export interface ToolCheck {
  id: string;
  status: "pass" | "fail" | "skipped";
  detail: string;
}
export interface ToolCertification {
  id: string;
  version: string | null;
  status: "CERTIFIED" | "FAILED";
  checks: ToolCheck[];
}
export interface ToolCertificationReport {
  schemaVersion: 1;
  toolSummary: { total: number; certified: number; failed: number };
  tools: ToolCertification[];
}

const run = promisify(execFile);
const APPROVED_LICENSES = new Set(["MIT", "Apache-2.0", "BSD-2-Clause", "BSD-3-Clause", "ISC", "Proprietary"]);
/** Constructs that would break Python 3.6 (or the offline/portable promise); checked in non-test sources. */
export const FORBIDDEN_PYTHON_CONSTRUCTS = [
  "capture_output",
  "text=True",
  ":=",
  "from __future__ import annotations",
  "dataclass",
];
const SYNTAX_SNIPPET = "import ast,sys; ast.parse(open(sys.argv[1], encoding='utf-8').read(), feature_version=(3,6))";

async function walk(dir: string, prefix = ""): Promise<string[]> {
  const found: string[] = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) found.push(...(await walk(path.join(dir, entry.name), relative)), `${relative}/`);
    else if (entry.isFile()) found.push(relative);
  }
  return found;
}

interface PythonRuntime {
  executable: string;
  minor: number;
}
async function findPython(): Promise<PythonRuntime | null> {
  const candidates = [process.env.PYTHON, "python3", "python"].filter((c): c is string => Boolean(c));
  for (const executable of candidates) {
    try {
      const { stdout } = await run(
        executable,
        ["-B", "-c", "import sys; print(sys.version_info[0], sys.version_info[1])"],
        {
          timeout: 15_000,
          windowsHide: true,
        },
      );
      const [major, minor] = stdout.trim().split(/\s+/).map(Number);
      if (major === 3 && Number.isFinite(minor)) return { executable, minor: minor! };
    } catch {
      /* try the next candidate */
    }
  }
  return null;
}

async function syntaxCheck(root: string, pythonFiles: string[], python: PythonRuntime | null): Promise<ToolCheck> {
  if (pythonFiles.length === 0) return { id: "python-syntax", status: "pass", detail: "no Python files" };
  if (!python) return { id: "python-syntax", status: "skipped", detail: "skipped: python not found" };
  if (python.minor < 8)
    return {
      id: "python-syntax",
      status: "skipped",
      detail: `skipped: python 3.${python.minor} cannot check feature_version (needs 3.8+)`,
    };
  const failed: string[] = [];
  for (const file of pythonFiles) {
    try {
      await run(python.executable, ["-B", "-c", SYNTAX_SNIPPET, path.join(root, ...file.split("/"))], {
        timeout: 20_000,
        windowsHide: true,
        env: { ...process.env, PYTHONDONTWRITEBYTECODE: "1" },
      });
    } catch {
      failed.push(file);
    }
  }
  return failed.length
    ? { id: "python-syntax", status: "fail", detail: `not valid Python 3.6 syntax: ${failed.join(", ")}` }
    : {
        id: "python-syntax",
        status: "pass",
        detail: `${pythonFiles.length} file(s) parse as Python 3.6 (python 3.${python.minor})`,
      };
}

export async function certifyTool(dir: string, python: PythonRuntime | null): Promise<ToolCertification> {
  const name = path.basename(dir);
  const checks: ToolCheck[] = [];
  const add = (id: string, ok: boolean, detail: string) => checks.push({ id, status: ok ? "pass" : "fail", detail });

  let manifest: ToolManifest | null = null;
  try {
    const parsed = toolManifestSchema.safeParse(JSON.parse(await readFile(path.join(dir, "manifest.json"), "utf8")));
    if (parsed.success) {
      manifest = parsed.data;
      add(
        "manifest-schema",
        manifest.id === name,
        manifest.id === name ? "valid" : `id ${manifest.id} must equal the directory name ${name}`,
      );
    } else {
      add(
        "manifest-schema",
        false,
        parsed.error.issues
          .slice(0, 5)
          .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
          .join("; "),
      );
    }
  } catch {
    add("manifest-schema", false, "manifest.json is missing or not valid JSON");
  }
  if (!manifest) return { id: name, version: null, status: "FAILED", checks };

  add(
    "license-provenance",
    APPROVED_LICENSES.has(manifest.license.spdx) && manifest.license.notice.trim().length > 0,
    APPROVED_LICENSES.has(manifest.license.spdx)
      ? `${manifest.license.spdx}; origin ${manifest.provenance.origin}; maintainer ${manifest.provenance.maintainer}`
      : `licence ${manifest.license.spdx} is not approved`,
  );

  const contents = new Map<string, Buffer>();
  const problems: string[] = [];
  for (const file of manifest.files) {
    try {
      const bytes = await readFile(path.join(dir, ...file.path.split("/")));
      contents.set(file.path, bytes);
      if (bytes.length !== file.bytes) problems.push(`${file.path}: size ${bytes.length} != ${file.bytes}`);
      else if (sha256(bytes) !== file.sha256) problems.push(`${file.path}: checksum differs`);
    } catch {
      problems.push(`${file.path}: missing`);
    }
  }
  add(
    "files-match-manifest",
    problems.length === 0,
    problems.length ? problems.slice(0, 8).join("; ") : `${manifest.files.length} files match size and sha256`,
  );

  const onDisk = await walk(dir);
  const listed = new Set(manifest.files.map((file) => file.path));
  const extra = onDisk.filter((file) => !file.endsWith("/") && file !== "manifest.json" && !listed.has(file));
  add(
    "no-files-outside-manifest",
    extra.length === 0,
    extra.length ? `not in manifest: ${extra.slice(0, 8).join(", ")}` : "none",
  );

  const bytecode = onDisk.filter((file) => /(^|\/)__pycache__\/?$/.test(file) || /\.py[co]$/.test(file));
  add(
    "no-bytecode",
    bytecode.length === 0,
    bytecode.length ? `found: ${bytecode.slice(0, 5).join(", ")}` : "no __pycache__ or .pyc files",
  );

  const findings = scanForSecrets(contents);
  add(
    "secret-scan",
    findings.length === 0,
    findings.length
      ? findings.map((f) => `${f.file}${f.line ? `:${f.line}` : ""} (${f.rule})`).join("; ")
      : "no credentials found",
  );

  const pythonFiles = [...contents.keys()].filter((file) => file.endsWith(".py"));
  checks.push(await syntaxCheck(dir, pythonFiles, python));

  const hits: string[] = [];
  for (const file of pythonFiles.filter((f) => !f.startsWith("tests/"))) {
    const text = contents.get(file)!.toString("utf8");
    for (const token of FORBIDDEN_PYTHON_CONSTRUCTS) if (text.includes(token)) hits.push(`${file}: ${token}`);
  }
  add(
    "forbidden-constructs",
    hits.length === 0,
    hits.length ? hits.join("; ") : "none of the Python 3.7+ constructs found",
  );

  const tests = [...listed].filter((file) => /^tests\/test_[^/]+\.py$/.test(file));
  add(
    "unit-tests-present",
    tests.length > 0,
    tests.length ? `${tests.length} test module(s)` : "no tests/test_*.py in the manifest",
  );

  const failed = checks.some((check) => check.status === "fail");
  return { id: manifest.id, version: manifest.version, status: failed ? "FAILED" : "CERTIFIED", checks };
}

/** Certify every directory directly under `root` (the repository `tools` directory). */
export async function certifyTools(root: string): Promise<ToolCertificationReport> {
  let names: string[] = [];
  try {
    names = (await readdir(root, { withFileTypes: true }))
      .filter((e) => e.isDirectory())
      .map((e) => e.name)
      .sort();
  } catch {
    /* no tools directory: nothing to certify */
  }
  const python = await findPython();
  const tools: ToolCertification[] = [];
  for (const name of names) tools.push(await certifyTool(path.join(root, name), python));
  const certified = tools.filter((tool) => tool.status === "CERTIFIED").length;
  return { schemaVersion: 1, toolSummary: { total: tools.length, certified, failed: tools.length - certified }, tools };
}
