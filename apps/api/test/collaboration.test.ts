import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { hashPassword } from "../src/lib/password.js";
import { createHarness } from "./helpers.js";

const PASSWORD = "a sufficiently long test password";
let base: string;
let output: string;
let h: ReturnType<typeof createHarness>;

beforeAll(async () => {
  base = await mkdtemp(path.join(tmpdir(), "asaa-collab-"));
  output = path.join(base, "output");
  h = createHarness({ GENERATION_OUTPUT_DIR: output });
});
afterAll(async () => {
  await h.close();
  await rm(base, { recursive: true, force: true, maxRetries: 8, retryDelay: 250 });
});

async function account(email: string, role: "DEVELOPER" | "TESTER" | "EMPLOYEE") {
  return h.ctx.prisma.owner.create({
    data: {
      email,
      displayName: email.split("@")[0]!,
      role,
      passwordHash: await hashPassword(PASSWORD),
      passwordChangedAt: new Date(h.clock.now.getTime() - 1000),
      createdAt: new Date(h.clock.now.getTime() - 1000),
    },
  });
}
async function login(email: string) {
  const agent = h.agent();
  expect((await agent.post("/api/auth/login", { email, password: PASSWORD })).status).toBe(200);
  return agent;
}

async function world() {
  await h.reset();
  await h.createOwner();
  await account("po@asaa.test", "EMPLOYEE");
  await account("editor@asaa.test", "DEVELOPER");
  await account("viewer@asaa.test", "TESTER");
  await account("stranger@asaa.test", "EMPLOYEE");
  const po = await login("po@asaa.test");
  const created = await po.post("/api/projects", { key: "COLLAB", name: "Collab project" });
  expect(created.status).toBe(201);
  const projectId = created.body.project.id as string;
  expect(
    (await po.post(`/api/projects/${projectId}/members`, { email: "editor@asaa.test", role: "EDITOR" })).status,
  ).toBe(200);
  expect(
    (await po.post(`/api/projects/${projectId}/members`, { email: "viewer@asaa.test", role: "VIEWER" })).status,
  ).toBe(200);
  return {
    projectId,
    po,
    editor: await login("editor@asaa.test"),
    viewer: await login("viewer@asaa.test"),
    stranger: await login("stranger@asaa.test"),
  };
}

describe("project collaboration (comments)", () => {
  it("supports threads, edit-own, delete-own, resolve and member-only mentions", async () => {
    const w = await world();
    const c = `/api/projects/${w.projectId}/collaboration`;
    const file = { targetType: "FILE", targetRef: "src/index.ts" };

    const root = await w.viewer.post(`${c}/comments`, { ...file, body: "Why is this exported?" });
    expect(root.status).toBe(201);
    const rootId = root.body.comment.id as string;

    const reply = await w.editor.post(`${c}/comments`, {
      ...file,
      body: "Ask @po@asaa.test, they wrote it.",
      parentId: rootId,
    });
    expect(reply.status).toBe(201);
    expect(reply.body.comment.mentions).toHaveLength(1);

    // Mentioning someone outside the project is refused, and so is a reply across targets.
    expect((await w.editor.post(`${c}/comments`, { ...file, body: "cc @stranger@asaa.test" })).status).toBe(400);
    expect((await w.editor.post(`${c}/comments`, { targetType: "PROJECT", body: "x", parentId: rootId })).status).toBe(
      400,
    );

    const list = await w.po.get(`${c}/comments?targetType=FILE&targetRef=src/index.ts`);
    expect(list.body.comments.map((x: { body: string }) => x.body)).toEqual([
      "Why is this exported?",
      "Ask @po@asaa.test, they wrote it.",
    ]);

    // Edit and delete are author-only; even the project owner cannot rewrite someone else's comment.
    expect((await w.po.patch(`${c}/comments/${rootId}`, { body: "hijack" })).status).toBe(403);
    expect((await w.po.delete(`${c}/comments/${rootId}`)).status).toBe(403);
    const edited = await w.viewer.patch(`${c}/comments/${rootId}`, { body: "Why is this exported at all?" });
    expect(edited.status).toBe(200);
    expect(edited.body.comment.editedAt).not.toBeNull();

    // Resolve: a VIEWER who is not the author cannot; an EDITOR can; the author can too.
    expect((await w.viewer.post(`${c}/comments/${reply.body.comment.id}/resolve`, { resolved: true })).status).toBe(
      400,
    );
    const other = await w.po.post(`${c}/comments`, { targetType: "PROJECT", body: "Kickoff notes" });
    expect((await w.viewer.post(`${c}/comments/${other.body.comment.id}/resolve`, { resolved: true })).status).toBe(
      403,
    );
    expect((await w.editor.post(`${c}/comments/${rootId}/resolve`, { resolved: true })).status).toBe(200);
    const hidden = await w.po.get(`${c}/comments?targetType=FILE&targetRef=src/index.ts`);
    expect(hidden.body.comments).toEqual([]);
    const shown = await w.po.get(`${c}/comments?targetType=FILE&targetRef=src/index.ts&includeResolved=true`);
    expect(shown.body.comments).toHaveLength(2);
    expect((await w.viewer.post(`${c}/comments/${rootId}/resolve`, { resolved: false })).status).toBe(200);

    // Delete keeps the thread shape but blanks the text.
    expect((await w.editor.delete(`${c}/comments/${reply.body.comment.id}`)).status).toBe(204);
    const after = await w.po.get(`${c}/comments?targetType=FILE&targetRef=src/index.ts`);
    expect(after.body.comments[1]).toMatchObject({ deleted: true, body: "" });

    // Template and validation targets.
    expect(
      (await w.po.post(`${c}/comments`, { targetType: "TEMPLATE", targetRef: "landing-page@1.0.0", body: "ok" }))
        .status,
    ).toBe(201);
    expect(
      (await w.po.post(`${c}/comments`, { targetType: "TEMPLATE", targetRef: "nonsense", body: "ok" })).status,
    ).toBe(400);
    expect(
      (await w.po.post(`${c}/comments`, { targetType: "FILE", targetRef: "../etc/passwd", body: "ok" })).status,
    ).toBe(400);

    const audits = await h.ctx.prisma.auditEvent.findMany({ where: { action: { startsWith: "comment." } } });
    expect(audits.map((a) => a.action)).toEqual(
      expect.arrayContaining(["comment.create", "comment.edit", "comment.delete"]),
    );
  });

  it("hides everything from non-members (404) and never crosses projects", async () => {
    const w = await world();
    const c = `/api/projects/${w.projectId}/collaboration`;
    const made = await w.po.post(`${c}/comments`, { targetType: "PROJECT", body: "SECRETMARK" });
    const id = made.body.comment.id as string;
    for (const response of [
      await w.stranger.get(`${c}/comments`),
      await w.stranger.post(`${c}/comments`, { targetType: "PROJECT", body: "hi" }),
      await w.stranger.patch(`${c}/comments/${id}`, { body: "x" }),
      await w.stranger.delete(`${c}/comments/${id}`),
      await w.stranger.post(`${c}/comments/${id}/resolve`, { resolved: true }),
      await w.stranger.get(`${c}/presence`),
      await w.stranger.post(`${c}/presence`, {}),
    ]) {
      expect(response.status).toBe(404);
      expect(JSON.stringify(response.body)).not.toContain("SECRETMARK");
    }
    // A comment of project A addressed through the stranger's own project B does not resolve.
    const own = await w.stranger.post("/api/projects", { key: "OTHERP", name: "Other" });
    const otherId = own.body.project.id as string;
    expect(
      (await w.stranger.patch(`/api/projects/${otherId}/collaboration/comments/${id}`, { body: "x" })).status,
    ).toBe(404);
    expect((await h.agent().get(`${c}/comments`)).status).toBe(401);
  });
});

describe("project collaboration (presence)", () => {
  it("tracks who is viewing or editing a file by heartbeat and expires stale entries", async () => {
    const w = await world();
    const c = `/api/projects/${w.projectId}/collaboration`;
    expect((await w.viewer.post(`${c}/presence`, { filePath: "README.md", mode: "VIEWING" })).status).toBe(200);
    expect((await w.editor.post(`${c}/presence`, { filePath: "README.md", mode: "EDITING" })).status).toBe(200);
    // A VIEWER cannot claim to be editing.
    expect((await w.viewer.post(`${c}/presence`, { filePath: "README.md", mode: "EDITING" })).status).toBe(403);
    expect((await w.viewer.post(`${c}/presence`, { filePath: "../x" })).status).toBe(400);

    const now = await w.po.get(`${c}/presence?filePath=README.md`);
    expect(now.body.presence.map((p: { name: string; mode: string }) => [p.name, p.mode]).sort()).toEqual([
      ["editor", "EDITING"],
      ["viewer", "VIEWING"],
    ]);
    expect(now.body.presence.every((p: { you: boolean }) => p.you === false)).toBe(true);

    h.clock.now = new Date(h.clock.now.getTime() + 61_000);
    const later = await w.po.get(`${c}/presence`);
    expect(later.body.presence).toEqual([]);
    h.clock.now = new Date();
  });
});

describe("workspace git: branch switching", () => {
  it("switches branches safely, refuses dirty trees and unknown branches, and audits", async () => {
    await h.reset();
    await h.createOwner();
    const agent = await h.signedIn();
    const gen = await agent.post("/api/generations", {
      mode: "SCRATCH",
      projectType: "web-app",
      project: { key: "SWITCH", name: "Switch app", purpose: "x" },
      inputs: {},
    });
    expect(gen.status).toBe(201);
    const projectId = gen.body.generation.projectId as string;
    const ws = `/api/projects/${projectId}/workspace`;
    expect(
      (await agent.post(`${ws}/repository`, { identity: { name: "Owner", email: "owner@asaa.test" } })).status,
    ).toBe(201);
    expect((await agent.post(`${ws}/branches`, { kind: "feature", topic: "alpha", switchTo: true })).status).toBe(201);

    // Dirty tree blocks a switch.
    await writeFile(path.join(output, gen.body.generation.outputDir, "dirty.txt"), "x");
    const dirty = await agent.post(`${ws}/branches/switch`, { name: "main" });
    expect(dirty.status).toBe(409);
    await rm(path.join(output, gen.body.generation.outputDir, "dirty.txt"));

    expect((await agent.post(`${ws}/branches/switch`, { name: "nope" })).status).toBe(400);
    expect((await agent.post(`${ws}/branches/switch`, { name: "new/alpha" })).status).toBe(409);
    const ok = await agent.post(`${ws}/branches/switch`, { name: "main" });
    expect(ok.status).toBe(200);
    expect(ok.body.branch).toMatchObject({ name: "main", current: true, protected: true });

    // Switching to production is fine for reading, but committing there stays refused.
    const overview = await agent.get(ws);
    expect(overview.body.workspace.state.head.branch).toBe("main");
    const events = await h.ctx.prisma.auditEvent.findMany({ where: { action: "repository.branch_switch" } });
    expect(events).toHaveLength(1);
  });
});
