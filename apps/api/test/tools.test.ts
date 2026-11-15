import { createHash } from "node:crypto";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { certifyTools } from "../src/certification/certify-tool.js";
import { readZip } from "../src/modules/export/zip.js";
import { loadTools, readAndVerify, buildArchive } from "../src/modules/tools/tools.js";
import { createHarness } from "./helpers.js";

const REAL_TOOLS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../tools");
const sha256 = (value: Buffer | string) => createHash("sha256").update(value).digest("hex");

let base: string;
let toolsDir: string;
let toolDir: string;

async function freshCopy() {
  await rm(toolsDir, { recursive: true, force: true, maxRetries: 8, retryDelay: 250 });
  await cp(path.join(REAL_TOOLS, "env-snapshot"), toolDir, {
    recursive: true,
    filter: (source) => !source.includes("__pycache__"),
  });
}

/** Recompute the manifest the way `npm run tools:manifest` does (used to isolate non-checksum failures). */
async function refreshManifest(dir = toolDir) {
  const manifestPath = path.join(dir, "manifest.json");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as {
    files: { path: string; sha256: string; bytes: number }[];
  };
  for (const file of manifest.files) {
    const bytes = await readFile(path.join(dir, ...file.path.split("/")));
    file.sha256 = sha256(bytes);
    file.bytes = bytes.length;
  }
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
}

async function editManifest(change: (manifest: Record<string, unknown> & { files: { path: string }[] }) => void) {
  const manifestPath = path.join(toolDir, "manifest.json");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  change(manifest);
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
}

const failing = async () => {
  const report = await certifyTools(toolsDir);
  return report.tools[0]!.checks.filter((check) => check.status === "fail").map((check) => check.id);
};

beforeAll(async () => {
  base = await mkdtemp(path.join(tmpdir(), "asaa-tools-"));
  toolsDir = path.join(base, "tools");
  toolDir = path.join(toolsDir, "env-snapshot");
});
afterAll(() => rm(base, { recursive: true, force: true, maxRetries: 8, retryDelay: 250 }));

describe("tool registry", () => {
  it("loads the packaged env-snapshot tool with a valid manifest", async () => {
    const { tools, problems } = await loadTools(REAL_TOOLS);
    expect(problems).toEqual([]);
    const tool = tools.find((entry) => entry.manifest.id === "env-snapshot")!;
    expect(tool.manifest).toMatchObject({
      version: "1.0.0",
      kind: "tool",
      language: "python",
      minRuntime: "3.6",
      offline: true,
      license: { spdx: "Proprietary" },
      provenance: { origin: "local" },
    });
    const paths = tool.manifest.files.map((file) => file.path);
    expect(paths).toEqual(expect.arrayContaining(["env_snapshot.py", "README.txt", "report.schema.json"]));
    expect(paths.some((p) => p.includes("__pycache__") || p.endsWith(".pyc") || p === "manifest.json")).toBe(false);
    expect((await readAndVerify(tool)).problems).toEqual([]);
  });

  it("builds a deterministic archive whose digest does not change", async () => {
    const { tools } = await loadTools(REAL_TOOLS);
    const tool = tools[0]!;
    const first = buildArchive(tool, await readAndVerify(tool));
    const second = buildArchive(tool, await readAndVerify(tool));
    expect(first.archive.equals(second.archive)).toBe(true);
    expect(first.filename).toBe("env-snapshot-1.0.0.zip");
  });

  it("reports invalid manifests instead of serving them", async () => {
    await freshCopy();
    await editManifest((manifest) => {
      manifest.kind = "template";
    });
    const { tools, problems } = await loadTools(toolsDir);
    expect(tools).toEqual([]);
    expect(problems[0]!.dir).toBe("env-snapshot");
  });

  it("returns an empty registry for a missing tools directory", async () => {
    expect(await loadTools(path.join(base, "does-not-exist"))).toEqual({ tools: [], problems: [] });
  });
});

describe("tool certification", () => {
  it("certifies the real tool", async () => {
    const report = await certifyTools(REAL_TOOLS);
    expect(report.toolSummary.total).toBeGreaterThanOrEqual(1);
    const tool = report.tools.find((entry) => entry.id === "env-snapshot")!;
    expect(
      tool.checks.filter((check) => check.status === "fail"),
      JSON.stringify(tool.checks),
    ).toEqual([]);
    expect(tool.status).toBe("CERTIFIED");
    expect(tool.checks.map((check) => check.id)).toEqual(
      expect.arrayContaining([
        "manifest-schema",
        "license-provenance",
        "files-match-manifest",
        "no-files-outside-manifest",
        "no-bytecode",
        "secret-scan",
        "python-syntax",
        "forbidden-constructs",
        "unit-tests-present",
      ]),
    );
    const syntax = tool.checks.find((check) => check.id === "python-syntax")!;
    expect(["pass", "skipped"]).toContain(syntax.status);
    if (syntax.status === "skipped") expect(syntax.detail).toMatch(/^skipped: /);
  });

  it("fails when a file was modified without refreshing the manifest", async () => {
    await freshCopy();
    await writeFile(path.join(toolDir, "env_snapshot.py"), "# tampered\n", { flag: "a" });
    expect(await failing()).toContain("files-match-manifest");
  });

  it("fails on a file that is not in the manifest and on bytecode", async () => {
    await freshCopy();
    await writeFile(path.join(toolDir, "extra.txt"), "x");
    await mkdir(path.join(toolDir, "__pycache__"), { recursive: true });
    await writeFile(path.join(toolDir, "__pycache__", "m.cpython-312.pyc"), "x");
    const failed = await failing();
    expect(failed).toContain("no-files-outside-manifest");
    expect(failed).toContain("no-bytecode");
  });

  it("fails on a secret even when the manifest was refreshed (and never prints the secret)", async () => {
    await freshCopy();
    const secret = ["postgres://admin:", "hunter2pass", "@db.internal/app"].join("");
    await writeFile(path.join(toolDir, "env_snapshot.py"), `\n# ${secret}\n`, { flag: "a" });
    await refreshManifest();
    const report = await certifyTools(toolsDir);
    const check = report.tools[0]!.checks.find((c) => c.id === "secret-scan")!;
    expect(check.status).toBe("fail");
    expect(check.detail).toContain("credentialed-url");
    expect(JSON.stringify(report)).not.toContain("hunter2pass");
    expect(report.tools[0]!.status).toBe("FAILED");
  });

  it("fails on a private key block in any file", async () => {
    await freshCopy();
    const header = ["-----BEGIN RSA ", "PRIVATE KEY-----"].join("");
    await writeFile(path.join(toolDir, "tests", "fixtures", "linux", "hosts"), `${header}\nabc\n`, { flag: "a" });
    await refreshManifest();
    expect(await failing()).toContain("secret-scan");
  });

  it.each([
    ["capture_output", "import subprocess\nsubprocess.run(['x'], capture_output=True)\n"],
    ["text=True", "import subprocess\nsubprocess.run(['x'], " + "text" + "=True)\n"],
    ["walrus", "if (n " + ":" + "= 1):\n    pass\n"],
    ["future annotations", "from __future__ " + "import annotations\n"],
    ["dataclass", "from " + "dataclasses import dataclass\n"],
  ])("fails on the forbidden construct %s (manifest refreshed)", async (_name, snippet) => {
    await freshCopy();
    await writeFile(path.join(toolDir, "env_snapshot.py"), `\n${snippet}`, { flag: "a" });
    await refreshManifest();
    expect(await failing()).toContain("forbidden-constructs");
  });

  it("fails when a Python file has a syntax error (when python 3.8+ is available)", async () => {
    await freshCopy();
    await writeFile(path.join(toolDir, "env_snapshot.py"), "\ndef broken(:\n", { flag: "a" });
    await refreshManifest();
    const report = await certifyTools(toolsDir);
    const syntax = report.tools[0]!.checks.find((check) => check.id === "python-syntax")!;
    expect(["fail", "skipped"]).toContain(syntax.status);
    if (syntax.status === "skipped") expect(syntax.detail).toMatch(/^skipped: /);
  });

  it("fails without unit tests, with a bad licence and with a mismatching id", async () => {
    await freshCopy();
    await editManifest((manifest) => {
      manifest.files = manifest.files.filter((file) => !file.path.startsWith("tests/test_"));
      (manifest.license as { spdx: string }).spdx = "GPL-3.0-only";
    });
    const failed = await failing();
    expect(failed).toContain("unit-tests-present");
    expect(failed).toContain("license-provenance");
    await editManifest((manifest) => {
      manifest.id = "someone-else";
    });
    expect(await failing()).toContain("manifest-schema");
  });

  it("fails a directory without a manifest", async () => {
    await freshCopy();
    await rm(path.join(toolDir, "manifest.json"));
    const report = await certifyTools(toolsDir);
    expect(report.tools[0]).toMatchObject({ id: "env-snapshot", version: null, status: "FAILED" });
  });
});

describe("tools API", () => {
  let h: ReturnType<typeof createHarness>;
  const bufferBody = (res: import("superagent").Response, callback: (error: Error | null, body: Buffer) => void) => {
    const chunks: Buffer[] = [];
    res.on("data", (chunk: Buffer) => chunks.push(chunk));
    res.on("end", () => callback(null, Buffer.concat(chunks)));
  };

  beforeAll(async () => {
    await freshCopy();
    h = createHarness({ TOOLS_DIR: toolsDir });
  });
  afterAll(() => h.close());
  beforeEach(async () => {
    await freshCopy();
    await h.reset();
    await h.createOwner();
  });

  it("requires authentication", async () => {
    const anonymous = h.agent();
    for (const url of ["/api/tools", "/api/tools/env-snapshot", "/api/tools/env-snapshot/download"]) {
      expect((await anonymous.get(url)).status, url).toBe(401);
    }
  });

  it("lists tools with archive digest and file count", async () => {
    const agent = await h.signedIn();
    const response = await agent.get("/api/tools");
    expect(response.status).toBe(200);
    expect(response.body.items).toHaveLength(1);
    const item = response.body.items[0];
    expect(item).toMatchObject({ id: "env-snapshot", version: "1.0.0", integrity: "ok" });
    expect(item.title).toContain("Environment Snapshot");
    expect(item.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(item.fileCount).toBeGreaterThan(50);
    expect(Object.keys(item).sort()).toEqual(
      ["description", "fileCount", "id", "integrity", "language", "minRuntime", "sha256", "title", "version"].sort(),
    );
  });

  it("returns the manifest with per-file checksums", async () => {
    const agent = await h.signedIn();
    const response = await agent.get("/api/tools/env-snapshot");
    expect(response.status).toBe(200);
    const { tool } = response.body;
    expect(tool.license).toMatchObject({ spdx: "Proprietary" });
    expect(tool.provenance.origin).toBe("local");
    expect(tool.files.length).toBeGreaterThan(50);
    for (const file of tool.files) expect(file.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect((await agent.get("/api/tools/nope")).status).toBe(404);
    expect((await agent.get("/api/tools/..%2F..%2Fetc")).status).toBe(404);
  });

  it("downloads a verifiable, deterministic zip and audits it without secrets", async () => {
    const agent = await h.signedIn();
    const list = await agent.get("/api/tools");
    const download = () => agent.raw.get("/api/tools/env-snapshot/download").buffer(true).parse(bufferBody);
    const first = await download();
    expect(first.status).toBe(200);
    expect(first.headers["content-type"]).toBe("application/zip");
    expect(first.headers["content-disposition"]).toBe('attachment; filename="env-snapshot-1.0.0.zip"');
    expect(first.headers["x-content-type-options"]).toBe("nosniff");
    const body = first.body as Buffer;
    expect(sha256(body)).toBe(list.body.items[0].sha256);
    expect(((await download()).body as Buffer).equals(body)).toBe(true);

    const entries = readZip(body);
    const byName = new Map(entries.map((entry) => [entry.name, entry.content]));
    expect(entries.every((entry) => entry.name.startsWith("env-snapshot-1.0.0/"))).toBe(true);
    expect(byName.has("env-snapshot-1.0.0/env_snapshot.py")).toBe(true);
    expect(byName.has("env-snapshot-1.0.0/manifest.json")).toBe(true);
    const manifest = JSON.parse(byName.get("env-snapshot-1.0.0/manifest.json")!.toString("utf8")) as {
      files: { path: string; sha256: string; bytes: number }[];
    };
    expect(entries).toHaveLength(manifest.files.length + 2);
    const sums = new Map(
      byName
        .get("env-snapshot-1.0.0/SHA256SUMS")!
        .toString("utf8")
        .trim()
        .split("\n")
        .map((line) => {
          const [digest, file] = line.split("  ");
          return [file!, digest!] as const;
        }),
    );
    expect(sums.size).toBe(manifest.files.length);
    for (const file of manifest.files) {
      const content = byName.get(`env-snapshot-1.0.0/${file.path}`)!;
      expect(sha256(content)).toBe(file.sha256);
      expect(content.length).toBe(file.bytes);
      expect(sums.get(file.path)).toBe(file.sha256);
    }

    const events = await h.ctx.prisma.auditEvent.findMany({ where: { action: "tool.download" } });
    expect(events.length).toBeGreaterThanOrEqual(2);
    expect(events[0]).toMatchObject({ outcome: "SUCCESS", targetType: "tool", targetId: "env-snapshot" });
    expect(JSON.stringify(events[0]!.metadata)).not.toMatch(/password|secret|token/i);
  });

  it("answers 409 when a file was modified without refreshing the manifest", async () => {
    const agent = await h.signedIn();
    expect((await agent.get("/api/tools/env-snapshot/download")).status).toBe(200);
    await writeFile(path.join(toolDir, "env_snapshot.py"), "# tampered\n", { flag: "a" });
    const response = await agent.get("/api/tools/env-snapshot/download");
    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe("CONFLICT");
    expect(response.headers["content-type"]).not.toBe("application/zip");
    const list = await agent.get("/api/tools");
    expect(list.body.items[0]).toMatchObject({ integrity: "modified", sha256: null });
    const failure = await h.ctx.prisma.auditEvent.findFirst({ where: { action: "tool.download", outcome: "FAILURE" } });
    expect(failure?.targetId).toBe("env-snapshot");
  });

  it("answers 409 when a manifest file is missing", async () => {
    const agent = await h.signedIn();
    await rm(path.join(toolDir, "README.txt"));
    expect((await agent.get("/api/tools/env-snapshot/download")).status).toBe(409);
  });
});
