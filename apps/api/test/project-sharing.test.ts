import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { hashPassword } from "../src/lib/password.js";
import { createHarness, OWNER_EMAIL } from "./helpers.js";

const h = createHarness();
afterAll(() => h.close());
beforeEach(async () => {
  await h.reset();
  await h.createOwner();
});

async function member(email: string) {
  return h.ctx.prisma.owner.create({
    data: {
      email,
      displayName: email.split("@")[0]!,
      role: "EMPLOYEE",
      passwordHash: await hashPassword("a sufficiently long test password"),
      passwordChangedAt: new Date(h.clock.now.getTime() - 1000),
      createdAt: new Date(h.clock.now.getTime() - 1000),
    },
  });
}

async function login(email: string) {
  const agent = h.agent();
  const response = await agent.post("/api/auth/login", {
    email,
    password: "a sufficiently long test password",
  });
  expect(response.status).toBe(200);
  return agent;
}

async function project() {
  const agent = await h.signedIn();
  const response = await agent.post("/api/projects", {
    key: "SHARED",
    name: "Shared project",
    purpose: "Verify resource-level permissions",
  });
  expect(response.status).toBe(201);
  return { agent, project: response.body.project };
}

describe("project-level sharing and isolation", () => {
  it("allows a viewer to discover and read only a shared project, never mutate it", async () => {
    const { agent: ownerAgent, project: item } = await project();
    const viewer = await member("viewer@asaa.test");
    const added = await ownerAgent.post(`/api/projects/${item.id}/members`, {
      email: viewer.email,
      role: "VIEWER",
    });
    expect(added.status).toBe(200);
    expect(added.body.membership.role).toBe("VIEWER");

    const viewerAgent = await login(viewer.email);
    expect((await viewerAgent.get("/api/projects")).body.projects.map((p: { id: string }) => p.id)).toContain(item.id);
    const stranger = await member("private.owner@asaa.test");
    const strangerAgent = await login(stranger.email);
    await strangerAgent.post("/api/projects", { key: "PRIVATE", name: "Shared project private" });
    const search = await viewerAgent.get("/api/projects?q=Shared");
    expect(search.body.projects.map((p: { id: string }) => p.id)).toEqual([item.id]);
    const viewerRead = await viewerAgent.get(`/api/projects/${item.id}`);
    expect(viewerRead.status).toBe(200);
    expect(viewerRead.body.access).toBe("VIEWER");
    expect(
      (
        await viewerAgent.patch(`/api/projects/${item.id}`, {
          expectedVersion: 1,
          name: "Unauthorized edit",
        })
      ).status,
    ).toBe(404);
    expect(
      (
        await viewerAgent.post(`/api/projects/${item.id}/members`, {
          email: OWNER_EMAIL,
          role: "EDITOR",
        })
      ).status,
    ).toBe(404);
  });

  it("allows an editor to update shared project data but not manage membership", async () => {
    const { agent: ownerAgent, project: item } = await project();
    const editor = await member("editor@asaa.test");
    expect(
      (
        await ownerAgent.post(`/api/projects/${item.id}/members`, {
          email: editor.email,
          role: "EDITOR",
        })
      ).status,
    ).toBe(200);

    const editorAgent = await login(editor.email);
    const updated = await editorAgent.patch(`/api/projects/${item.id}`, {
      expectedVersion: 1,
      name: "Edited by member",
    });
    expect(updated.status).toBe(200);
    expect(updated.body.project.name).toBe("Edited by member");
    expect((await editorAgent.get(`/api/projects/${item.id}`)).body.access).toBe("EDITOR");
    expect((await editorAgent.get(`/api/projects/${item.id}/members`)).status).toBe(404);
    expect((await editorAgent.delete(`/api/projects/${item.id}/members/${editor.id}`)).status).toBe(404);
  });

  it("enforces viewer/editor permissions on nested requirements", async () => {
    const { agent: ownerAgent, project: item } = await project();
    const base = `/api/projects/${item.id}/requirements`;
    const created = await ownerAgent.post(base, {
      title: "Protect project data",
      acceptanceCriteria: ["Only authorized members can edit requirements"],
    });
    expect(created.status).toBe(201);
    const requirementId = created.body.requirement.id;

    const viewer = await member("nested.viewer@asaa.test");
    await ownerAgent.post(`/api/projects/${item.id}/members`, { email: viewer.email, role: "VIEWER" });
    const viewerAgent = await login(viewer.email);
    expect((await viewerAgent.get(base)).status).toBe(200);
    expect((await viewerAgent.get(`${base}/${requirementId}`)).status).toBe(200);
    expect((await viewerAgent.post(base, { title: "Viewer cannot create" })).status).toBe(404);
    expect(
      (await viewerAgent.patch(`${base}/${requirementId}`, { title: "Viewer cannot edit", expectedVersion: 1 })).status,
    ).toBe(404);
    expect(
      (await viewerAgent.post(`${base}/${requirementId}/flag`, { flagged: true, reason: "No permission" })).status,
    ).toBe(404);

    const editor = await member("nested.editor@asaa.test");
    await ownerAgent.post(`/api/projects/${item.id}/members`, { email: editor.email, role: "EDITOR" });
    const editorAgent = await login(editor.email);
    const updated = await editorAgent.patch(`${base}/${requirementId}`, {
      title: "Edited by project editor",
      expectedVersion: 1,
    });
    expect(updated.status).toBe(200);
    expect(updated.body.requirement.title).toBe("Edited by project editor");
  });

  it("applies shared project roles to the engineering workspace", async () => {
    const { agent: ownerAgent, project: item } = await project();
    const environmentUrl = `/api/projects/${item.id}/workspace/environment`;
    const spec = {
      spec: {
        schemaVersion: 1,
        tools: [],
        packageManager: { name: "none", version: "*" },
        commands: { install: [], dev: [], build: [], test: [] },
        variables: [],
        database: { engine: "none", version: "*" },
        notes: "Shared workspace access test",
      },
      expectedVersion: 0,
    };

    const viewer = await member("workspace.viewer@asaa.test");
    await ownerAgent.post(`/api/projects/${item.id}/members`, { email: viewer.email, role: "VIEWER" });
    const viewerAgent = await login(viewer.email);
    const viewerWorkspace = await viewerAgent.get(`/api/projects/${item.id}/workspace`);
    expect(viewerWorkspace.status).toBe(200);
    expect(viewerWorkspace.body.workspace.project.access).toBe("VIEWER");
    expect((await viewerAgent.put(environmentUrl, spec)).status).toBe(404);

    const editor = await member("workspace.editor@asaa.test");
    await ownerAgent.post(`/api/projects/${item.id}/members`, { email: editor.email, role: "EDITOR" });
    const editorAgent = await login(editor.email);
    const editorWorkspace = await editorAgent.get(`/api/projects/${item.id}/workspace`);
    expect(editorWorkspace.status).toBe(200);
    expect(editorWorkspace.body.workspace.project.access).toBe("EDITOR");
    const saved = await editorAgent.put(environmentUrl, spec);
    expect(saved.status).toBe(200);
    expect(saved.body.environment.version).toBe(1);
  });
  it("removes access immediately when membership is revoked", async () => {
    const { agent: ownerAgent, project: item } = await project();
    const viewer = await member("revoked@asaa.test");
    await ownerAgent.post(`/api/projects/${item.id}/members`, { email: viewer.email, role: "VIEWER" });
    const viewerAgent = await login(viewer.email);
    expect((await viewerAgent.get(`/api/projects/${item.id}`)).status).toBe(200);

    expect((await ownerAgent.delete(`/api/projects/${item.id}/members/${viewer.id}`)).status).toBe(204);
    expect((await viewerAgent.get(`/api/projects/${item.id}`)).status).toBe(404);
  });

  it("does not expose unshared projects to another employee", async () => {
    const { project: item } = await project();
    const stranger = await member("stranger@asaa.test");
    const strangerAgent = await login(stranger.email);
    expect((await strangerAgent.get(`/api/projects/${item.id}`)).status).toBe(404);
  });
});
