import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { hashPassword } from "../src/lib/password.js";
import { createZip, readZip, unsafeEntryName, ZipError } from "../src/modules/export/zip.js";
import { createHarness } from "./helpers.js";

/** RG-08: safe, complete ZIP export with manifest, provenance, checksums and authorization. */
const PASSWORD = "a sufficiently long test password";
const sha256 = (value: Buffer) => createHash("sha256").update(value).digest("hex");

describe("zip writer and reader", () => {
  const sample = [
    { name: "app/index.html", content: Buffer.from("<h1>hello</h1>".repeat(50)) },
    { name: "app/data.bin", content: Buffer.from([0, 1, 2, 3, 255]) },
    { name: "app/empty.txt", content: Buffer.alloc(0) },
  ];

  it("round-trips content and is deterministic", () => {
    const first = createZip(sample);
    const second = createZip([...sample].reverse());
    expect(first.equals(second)).toBe(true);
    const entries = readZip(first);
    expect(entries.map((entry) => entry.name).sort()).toEqual(sample.map((entry) => entry.name).sort());
    for (const entry of sample) {
      expect(entries.find((candidate) => candidate.name === entry.name)!.content.equals(entry.content)).toBe(true);
    }
  });

  it("refuses unsafe entry names on write (zip-slip, absolute, drive letters, backslashes, duplicates)", () => {
    for (const name of ["../evil.txt", "a/../../evil", "/etc/passwd", "C:/windows/x", "a\\b", "a/./b", ""]) {
      expect(unsafeEntryName(name), name).not.toBeNull();
      expect(() => createZip([{ name, content: Buffer.from("x") }])).toThrow(ZipError);
    }
    expect(() =>
      createZip([
        { name: "A.txt", content: Buffer.from("1") },
        { name: "a.txt", content: Buffer.from("2") },
      ]),
    ).toThrow(/Duplicate/);
  });

  it("refuses a crafted archive whose entry name escapes the extraction folder", () => {
    const archive = createZip([{ name: "aa/evil.txt", content: Buffer.from("payload") }]);
    // Same-length patch so every header stays consistent: only the name changes.
    const crafted = Buffer.from(archive.toString("latin1").replaceAll("aa/evil.txt", "../evil.txt"), "latin1");
    expect(crafted.length).toBe(archive.length);
    expect(() => readZip(crafted)).toThrow(/Unsafe entry/);
  });

  it("detects corruption, truncation and decompression bombs", () => {
    const archive = createZip(sample);
    const corrupt = Buffer.from(archive);
    const at = corrupt.indexOf(Buffer.from([0, 1, 2, 3, 255]));
    corrupt[at] = 9;
    expect(() => readZip(corrupt)).toThrow(/Checksum mismatch/);
    expect(() => readZip(archive.subarray(0, archive.length - 10))).toThrow(ZipError);
    expect(() => readZip(Buffer.from("not a zip file at all"))).toThrow(/Not a ZIP/);
    const bomb = createZip([{ name: "z/zeros.bin", content: Buffer.alloc(2_000_000) }]);
    expect(bomb.length).toBeLessThan(10_000);
    expect(() => readZip(bomb, { maxEntries: 10, maxTotalBytes: 1_000_000 })).toThrow(/expands beyond/);
  });
});

describe("project export API", () => {
  let base: string;
  let output: string;
  let h: ReturnType<typeof createHarness>;

  beforeAll(async () => {
    base = await mkdtemp(path.join(tmpdir(), "asaa-export-"));
    output = path.join(base, "output");
    h = createHarness({ GENERATION_OUTPUT_DIR: output });
  });
  afterAll(async () => {
    await h.close();
    await rm(base, { recursive: true, force: true });
  });
  beforeEach(async () => {
    await rm(output, { recursive: true, force: true });
    await h.reset();
    await h.createOwner();
  });

  async function member(email: string) {
    const user = await h.ctx.prisma.owner.create({
      data: {
        email,
        displayName: email,
        role: "EMPLOYEE",
        passwordHash: await hashPassword(PASSWORD),
        passwordChangedAt: new Date(h.clock.now.getTime() - 1000),
        createdAt: new Date(h.clock.now.getTime() - 1000),
      },
    });
    const agent = h.agent();
    expect((await agent.post("/api/auth/login", { email, password: PASSWORD })).status).toBe(200);
    return { user, agent };
  }

  async function generated() {
    const { agent } = await member("author@asaa.test");
    const created = await agent.post("/api/generations", {
      mode: "SCRATCH",
      projectType: "web-app",
      project: { key: "EXPORTME", name: "Export me", purpose: "ZIP export" },
      inputs: {},
    });
    expect(created.status).toBe(201);
    return { agent, generation: created.body.generation };
  }

  const download = (agent: ReturnType<typeof h.agent>, id: string) =>
    agent.raw
      .get(`/api/generations/${id}/export`)
      .buffer(true)
      .parse((res, callback) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk: Buffer) => chunks.push(chunk));
        res.on("end", () => callback(null, Buffer.concat(chunks)));
      });

  it("exports a complete archive with manifest, provenance and matching checksums", async () => {
    const { agent, generation } = await generated();
    const response = await download(agent, generation.id);
    expect(response.status).toBe(200);
    expect(response.headers["content-type"]).toBe("application/zip");
    expect(response.headers["content-disposition"]).toMatch(/attachment; filename="exportme-[0-9a-f]{12}\.zip"/);
    const entries = readZip(response.body as Buffer);
    const names = entries.map((entry) => entry.name);
    expect(names).toEqual(
      expect.arrayContaining(["exportme/EXPORT-MANIFEST.json", "exportme/SHA256SUMS", "exportme/package.json"]),
    );
    expect(names.some((name) => name.startsWith("exportme/.asaa/"))).toBe(true);
    const manifest = JSON.parse(
      entries.find((entry) => entry.name.endsWith("EXPORT-MANIFEST.json"))!.content.toString(),
    );
    expect(manifest).toMatchObject({
      schemaVersion: 1,
      project: { key: "EXPORTME" },
      modifiedSinceGeneration: false,
      generation: { outputDigest: generation.outputDigest, templateId: generation.templateId },
    });
    for (const file of manifest.files as { path: string; sha256: string; bytes: number }[]) {
      const entry = entries.find((candidate) => candidate.name === `exportme/${file.path}`)!;
      expect(sha256(entry.content)).toBe(file.sha256);
      expect(entry.content.length).toBe(file.bytes);
    }
    const sums = entries.find((entry) => entry.name.endsWith("SHA256SUMS"))!.content.toString();
    expect(sums).toContain(`${manifest.files[0].sha256}  ${manifest.files[0].path}`);
    // Repeated exports of unchanged output are byte-identical.
    expect(((await download(agent, generation.id)).body as Buffer).equals(response.body as Buffer)).toBe(true);
    const audits = await h.ctx.prisma.auditEvent.count({ where: { action: "generation.export", outcome: "SUCCESS" } });
    expect(audits).toBe(2);
  });

  it("flags local modifications, excludes .git and node_modules, and refuses symbolic links", async () => {
    const { agent, generation } = await generated();
    const root = path.join(output, generation.outputDir);
    await writeFile(path.join(root, "notes.txt"), "local edit");
    await mkdir(path.join(root, ".git"), { recursive: true });
    await writeFile(path.join(root, ".git", "config"), "[core]");
    await mkdir(path.join(root, "node_modules", "x"), { recursive: true });
    await writeFile(path.join(root, "node_modules", "x", "index.js"), "module.exports = 1");
    const entries = readZip((await download(agent, generation.id)).body as Buffer);
    const names = entries.map((entry) => entry.name);
    expect(names).toContain("exportme/notes.txt");
    expect(names.some((name) => name.includes(".git/") || name.includes("node_modules"))).toBe(false);
    const manifest = JSON.parse(
      entries.find((entry) => entry.name.endsWith("EXPORT-MANIFEST.json"))!.content.toString(),
    );
    expect(manifest.modifiedSinceGeneration).toBe(true);

    try {
      await symlink(path.join(base, "outside.txt"), path.join(root, "link.txt"));
    } catch {
      return; // Symlink creation needs privileges on some Windows setups.
    }
    const blocked = await download(agent, generation.id);
    expect(blocked.status).toBe(422);
  });

  it("applies project authorization: members may export, strangers and anonymous callers may not", async () => {
    const { agent, generation } = await generated();
    const viewer = await member("viewer@asaa.test");
    const stranger = await member("stranger@asaa.test");
    const suspended = await member("suspended@asaa.test");
    for (const target of [viewer.user, suspended.user]) {
      await agent.post(`/api/projects/${generation.projectId}/members`, { email: target.email, role: "VIEWER" });
    }
    expect((await download(viewer.agent, generation.id)).status).toBe(200);
    const denied = await download(stranger.agent, generation.id);
    expect(denied.status).toBe(404);
    expect((await download(h.agent(), generation.id)).status).toBe(401);
    await h.ctx.prisma.owner.update({ where: { id: suspended.user.id }, data: { isActive: false } });
    expect((await download(suspended.agent, generation.id)).status).toBe(401);
    // Revoked access is immediate.
    await agent.delete(`/api/projects/${generation.projectId}/members/${viewer.user.id}`);
    expect((await download(viewer.agent, generation.id)).status).toBe(404);
    expect((await download(agent, "not-a-uuid")).status).toBe(404);
  });
});
