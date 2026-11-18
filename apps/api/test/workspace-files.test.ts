import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { hashPassword } from "../src/lib/password.js";
import { createHarness } from "./helpers.js";

/** RG-11: file tree, safe editing with conflict handling, diff, history and commit through the API. */
const PASSWORD = "a sufficiently long test password";
let base: string;
let output: string;
let h: ReturnType<typeof createHarness>;
let agent: Awaited<ReturnType<ReturnType<typeof createHarness>["signedIn"]>>;

beforeAll(async () => {
  base = await mkdtemp(path.join(tmpdir(), "asaa-wsfiles-"));
  output = path.join(base, "output");
  h = createHarness({ GENERATION_OUTPUT_DIR: output });
});
afterAll(async () => {
  await h.close();
  await rm(base, { recursive: true, force: true, maxRetries: 8, retryDelay: 250 });
});
beforeEach(async () => {
  await rm(output, { recursive: true, force: true, maxRetries: 8, retryDelay: 250 });
  await h.reset();
  await h.createOwner();
  agent = await h.signedIn();
});

const identity = { name: "Owner Name", email: "owner@asaa.test" };
const ws = (projectId: string) => `/api/projects/${projectId}/workspace`;

async function project(initialize = true) {
  const response = await agent.post("/api/generations", {
    mode: "SCRATCH",
    projectType: "web-app",
    project: { key: "FILES", name: "Files app", purpose: "Workspace file API" },
    inputs: {},
  });
  expect(response.status).toBe(201);
  const generation = response.body.generation as { projectId: string; outputDir: string };
  if (initialize) expect((await agent.post(`${ws(generation.projectId)}/repository`, { identity })).status).toBe(201);
  return { id: generation.projectId, dir: path.join(output, generation.outputDir) };
}

async function member(email: string, role: "VIEWER" | "EDITOR", projectId: string) {
  await h.ctx.prisma.owner.create({
    data: {
      email,
      displayName: email,
      role: "EMPLOYEE",
      passwordHash: await hashPassword(PASSWORD),
      passwordChangedAt: new Date(h.clock.now.getTime() - 1000),
      createdAt: new Date(h.clock.now.getTime() - 1000),
    },
  });
  expect((await agent.post(`/api/projects/${projectId}/members`, { email, role })).status).toBe(200);
  const other = h.agent();
  expect((await other.post("/api/auth/login", { email, password: PASSWORD })).status).toBe(200);
  return other;
}

describe("workspace files (RG-11)", () => {
  it("lists the file tree, hiding VCS and dependency folders, and reads text files with a content hash", async () => {
    const p = await project();
    await mkdir(path.join(p.dir, "node_modules", "x"), { recursive: true });
    await writeFile(path.join(p.dir, "node_modules", "x", "a.js"), "1");
    const root = await agent.get(`${ws(p.id)}/files/tree`);
    expect(root.status).toBe(200);
    const names = root.body.entries.map((entry: { name: string }) => entry.name);
    expect(names).toContain("package.json");
    expect(names).not.toContain(".git");
    expect(names).not.toContain("node_modules");
    expect(root.body.entries[0].type).toBe("directory");
    const sub = await agent.get(`${ws(p.id)}/files/tree?path=src`);
    expect(sub.body.entries.some((entry: { path: string }) => entry.path.startsWith("src/"))).toBe(true);

    const file = await agent.get(`${ws(p.id)}/files/content?path=package.json`);
    expect(file.status).toBe(200);
    expect(file.body.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.parse(file.body.content).name).toBeTruthy();
    expect((await agent.get(`${ws(p.id)}/files/content?path=missing.txt`)).status).toBe(404);
    expect((await agent.get(`${ws(p.id)}/files/tree?path=nope`)).status).toBe(404);
  });

  it("rejects traversal, absolute paths, hidden folders and symbolic links", async () => {
    const p = await project();
    for (const bad of [
      "../secret",
      "..%2Fsecret",
      "/etc/passwd",
      "C:/Windows/win.ini",
      "a/../../b",
      "a\\b",
      ".git/config",
      "node_modules/x",
    ]) {
      const response = await agent.get(`${ws(p.id)}/files/content?path=${bad}`);
      expect([400, 404], bad).toContain(response.status);
    }
    const write = await agent.put(`${ws(p.id)}/files/content`, {
      path: "../escape.txt",
      content: "x",
      expectedSha256: null,
    });
    expect(write.status).toBe(400);
    expect(
      (
        await agent.put(`${ws(p.id)}/files/content`, {
          path: ".asaa/generation.json",
          content: "{}",
          expectedSha256: null,
        })
      ).status,
    ).toBe(422);
    try {
      await symlink(base, path.join(p.dir, "linked"));
    } catch {
      return;
    }
    expect((await agent.get(`${ws(p.id)}/files/content?path=linked/escape.txt`)).status).toBe(422);
    expect(
      (await agent.put(`${ws(p.id)}/files/content`, { path: "linked/escape.txt", content: "x", expectedSha256: null }))
        .status,
    ).toBe(422);
  });

  it("saves edits atomically and detects concurrent edits as conflicts", async () => {
    const p = await project();
    const opened = (await agent.get(`${ws(p.id)}/files/content?path=README.txt`)).body;
    const saved = await agent.put(`${ws(p.id)}/files/content`, {
      path: "README.txt",
      content: `${opened.content}\nEdited online.\n`,
      expectedSha256: opened.sha256,
    });
    expect(saved.status).toBe(200);
    expect(await readFile(path.join(p.dir, "README.txt"), "utf8")).toContain("Edited online.");
    // A second editor still holding the old hash gets a conflict with the current hash, and nothing is overwritten.
    const stale = await agent.put(`${ws(p.id)}/files/content`, {
      path: "README.txt",
      content: "stale overwrite",
      expectedSha256: opened.sha256,
    });
    expect(stale.status).toBe(409);
    expect(stale.body.error.fields.currentSha256).toBe(saved.body.sha256);
    expect(await readFile(path.join(p.dir, "README.txt"), "utf8")).not.toContain("stale overwrite");
    // Creating a file needs a null hash; creating over an existing one conflicts.
    expect(
      (await agent.put(`${ws(p.id)}/files/content`, { path: "docs/new.md", content: "# New", expectedSha256: null }))
        .body.created,
    ).toBe(true);
    expect(
      (await agent.put(`${ws(p.id)}/files/content`, { path: "docs/new.md", content: "again", expectedSha256: null }))
        .status,
    ).toBe(409);
    const oversized = await agent.put(`${ws(p.id)}/files/content`, {
      path: "big.txt",
      content: "x".repeat(300_000),
      expectedSha256: null,
    });
    // The JSON body limit (100 KB) rejects oversized saves before they reach the file API.
    expect(oversized.status).toBe(413);
    const audits = await h.ctx.prisma.auditEvent.findMany({ where: { action: { startsWith: "workspace.file" } } });
    expect(audits.map((event) => event.action)).toEqual(
      expect.arrayContaining(["workspace.file.write", "workspace.file.conflict"]),
    );
    expect(JSON.stringify(audits, (_k, v) => (typeof v === "bigint" ? String(v) : v))).not.toContain("Edited online");
  });

  /** Edit a tracked file and add an untracked one, so diff and commit assertions have something to show. */
  async function dirtyProject() {
    const p = await project();
    await agent.put(`${ws(p.id)}/files/content`, {
      path: "README.txt",
      content: "changed readme\n",
      expectedSha256: (await agent.get(`${ws(p.id)}/files/content?path=README.txt`)).body.sha256,
    });
    await writeFile(path.join(p.dir, "untracked.txt"), "new");
    return p;
  }

  it("shows diffs and refuses to commit on the protected branch", async () => {
    const p = await dirtyProject();
    const diff = await agent.get(`${ws(p.id)}/diff`);
    expect(diff.status).toBe(200);
    expect(diff.body.patch).toContain("+changed readme");
    expect(diff.body.untracked).toContain("untracked.txt");
    expect((await agent.get(`${ws(p.id)}/diff?path=README.txt`)).body.patch).toContain("README.txt");

    // The generated repository starts on the protected production branch.
    const blocked = await agent.post(`${ws(p.id)}/commits`, { message: "direct to main" });
    expect(blocked.status).toBe(409);
    expect(blocked.body.error.message).toMatch(/protected production branch/);
  });

  it("commits on a work branch and serves history and commit detail", async () => {
    const p = await dirtyProject();
    expect(
      (
        await agent.post(`${ws(p.id)}/branches`, {
          kind: "feature",
          topic: "edit-readme",
          from: "main",
          switchTo: true,
        })
      ).status,
    ).toBe(201);
    expect((await agent.post(`${ws(p.id)}/commits`, { message: "" })).status).toBe(400);
    const commit = await agent.post(`${ws(p.id)}/commits`, { message: "Update readme" });
    expect(commit.status, JSON.stringify(commit.body)).toBe(201);
    expect(commit.body.branch).toBe("new/edit-readme");
    expect((await agent.post(`${ws(p.id)}/commits`, { message: "nothing" })).status).toBe(409);

    const history = await agent.get(`${ws(p.id)}/history?path=README.txt`);
    expect(history.body.commits.map((c: { subject: string }) => c.subject)).toContain("Update readme");
    const detail = await agent.get(`${ws(p.id)}/commits/${commit.body.sha}`);
    expect(detail.status).toBe(200);
    expect(detail.body.files.map((f: { path: string }) => f.path)).toEqual(
      expect.arrayContaining(["README.txt", "untracked.txt"]),
    );
    expect(detail.body.patch).toContain("changed readme");
    expect((await agent.get(`${ws(p.id)}/commits/not-a-sha`)).status).toBe(404);
    expect((await agent.get(`${ws(p.id)}/commits/${"0".repeat(40)}`)).status).toBe(404);
    expect((await agent.get(`${ws(p.id)}/diff`)).body.patch).toBe("");
  });

  it("applies project roles: viewers read but cannot edit or commit; strangers see nothing", async () => {
    const p = await project();
    const viewer = await member("viewer@asaa.test", "VIEWER", p.id);
    const editor = await member("editor@asaa.test", "EDITOR", p.id);
    await h.ctx.prisma.owner.create({
      data: {
        email: "stranger@asaa.test",
        displayName: "stranger",
        role: "EMPLOYEE",
        passwordHash: await hashPassword(PASSWORD),
        passwordChangedAt: new Date(h.clock.now.getTime() - 1000),
        createdAt: new Date(h.clock.now.getTime() - 1000),
      },
    });
    const stranger = h.agent();
    await stranger.post("/api/auth/login", { email: "stranger@asaa.test", password: PASSWORD });
    const edit = { path: "notes.txt", content: "x", expectedSha256: null };
    expect((await viewer.get(`${ws(p.id)}/files/tree`)).status).toBe(200);
    expect((await viewer.get(`${ws(p.id)}/files/content?path=package.json`)).status).toBe(200);
    expect((await viewer.get(`${ws(p.id)}/diff`)).status).toBe(200);
    expect((await viewer.put(`${ws(p.id)}/files/content`, edit)).status).toBe(404);
    expect((await viewer.post(`${ws(p.id)}/commits`, { message: "x" })).status).toBe(404);
    expect((await editor.put(`${ws(p.id)}/files/content`, edit)).status).toBe(200);
    for (const url of ["/files/tree", "/files/content?path=package.json", "/diff", "/history"]) {
      expect((await stranger.get(`${ws(p.id)}${url}`)).status, url).toBe(404);
    }
    expect((await stranger.put(`${ws(p.id)}/files/content`, edit)).status).toBe(404);
    expect((await h.agent().get(`${ws(p.id)}/files/tree`)).status).toBe(401);
  });

  it("explains missing repositories instead of failing", async () => {
    const p = await project(false);
    expect((await agent.get(`${ws(p.id)}/diff`)).status).toBe(409);
    expect((await agent.get(`${ws(p.id)}/history`)).status).toBe(409);
    expect((await agent.get(`${ws(p.id)}/files/tree`)).status).toBe(200);
  });
});
