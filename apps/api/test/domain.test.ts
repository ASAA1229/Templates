import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createHarness } from "./helpers.js";

const h = createHarness();
afterAll(() => h.close());
let agent: Awaited<ReturnType<typeof h.signedIn>>;
beforeEach(async () => {
  await h.reset();
  await h.createOwner();
  agent = await h.signedIn();
});

async function createProject(key = "WEB") {
  const response = await agent.post("/api/projects", { key, name: `${key} project`, purpose: "Build it" });
  expect(response.status).toBe(201);
  return response.body.project as { id: string; version: number };
}

describe("projects (US-C01)", () => {
  it("creates, lists, searches and validates projects", async () => {
    const project = await createProject("web-app");
    expect(project).toMatchObject({ version: 1 });
    const invalid = await agent.post("/api/projects", { key: "1", name: "" });
    expect(invalid.status).toBe(400);
    expect(Object.keys(invalid.body.error.fields)).toEqual(expect.arrayContaining(["key", "name"]));
    const duplicate = await agent.post("/api/projects", { key: "WEB-APP", name: "Again" });
    expect(duplicate.status).toBe(409);

    await createProject("CRM");
    const searched = await agent.get("/api/projects?q=crm");
    expect(searched.body.projects.map((item: { key: string }) => item.key)).toEqual(["CRM"]);
  });

  it("updates with optimistic concurrency and records audit history", async () => {
    const project = await createProject();
    const updated = await agent.patch(`/api/projects/${project.id}`, {
      name: "Renamed",
      status: "ACTIVE",
      expectedVersion: 1,
    });
    expect(updated.status).toBe(200);
    expect(updated.body.project).toMatchObject({ name: "Renamed", status: "ACTIVE", version: 2 });
    const stale = await agent.patch(`/api/projects/${project.id}`, { name: "Stale", expectedVersion: 1 });
    expect(stale.status).toBe(409);
    const detail = await agent.get(`/api/projects/${project.id}`);
    const update = detail.body.history.find((event: { action: string }) => event.action === "project.update");
    expect(update.metadata).toMatchObject({ before: { name: "WEB project" }, after: { name: "Renamed" } });
  });

  it("archives and restores; archived projects are read-only and hidden by default", async () => {
    const project = await createProject();
    expect((await agent.post(`/api/projects/${project.id}/archive`)).status).toBe(200);
    expect((await agent.post(`/api/projects/${project.id}/archive`)).status).toBe(409);
    expect((await agent.get("/api/projects")).body.projects).toHaveLength(0);
    expect((await agent.get("/api/projects?archived=only")).body.projects).toHaveLength(1);
    expect((await agent.patch(`/api/projects/${project.id}`, { name: "x", expectedVersion: 2 })).status).toBe(409);
    const restored = await agent.post(`/api/projects/${project.id}/restore`);
    expect(restored.body.project.archivedAt).toBeNull();
  });

  it("fails safely for malformed and unknown ids", async () => {
    expect((await agent.get("/api/projects/not-a-uuid")).status).toBe(404);
    expect((await agent.get("/api/projects/00000000-0000-4000-8000-000000000000")).status).toBe(404);
  });
});

describe("requirements and traceability (US-C02, US-C04, US-I03)", () => {
  it("numbers requirements per project and versions every change", async () => {
    const project = await createProject();
    const base = `/api/projects/${project.id}/requirements`;
    const first = await agent.post(base, {
      title: "Sign in",
      acceptanceCriteria: ["Valid credentials create a session"],
    });
    const second = await agent.post(base, { title: "Dashboard", dependencyIds: [first.body.requirement.id] });
    expect(first.body.requirement.code).toBe("REQ-1");
    expect(second.body.requirement.code).toBe("REQ-2");
    expect(second.body.requirement.dependencyIds).toEqual([first.body.requirement.id]);

    const id = first.body.requirement.id;
    const updated = await agent.patch(`${base}/${id}`, {
      status: "READY",
      priority: "P0",
      changeNote: "Ready for build",
      expectedVersion: 1,
    });
    expect(updated.body.requirement).toMatchObject({ status: "READY", priority: "P0", version: 2 });
    expect((await agent.patch(`${base}/${id}`, { title: "x", expectedVersion: 1 })).status).toBe(409);
    const detail = await agent.get(`${base}/${id}`);
    expect(detail.body.versions.map((version: { version: number }) => version.version)).toEqual([2, 1]);
    expect(detail.body.versions[0].changeNote).toBe("Ready for build");
    expect(detail.body.versions[1].snapshot.status).toBe("DRAFT");
  });

  it("rejects self, cross-project and cyclic dependencies", async () => {
    const project = await createProject("ONE");
    const other = await createProject("TWO");
    const base = `/api/projects/${project.id}/requirements`;
    const a = (await agent.post(base, { title: "A" })).body.requirement;
    const b = (await agent.post(base, { title: "B", dependencyIds: [a.id] })).body.requirement;
    const foreign = (await agent.post(`/api/projects/${other.id}/requirements`, { title: "F" })).body.requirement;

    expect((await agent.post(base, { title: "C", dependencyIds: [foreign.id] })).status).toBe(400);
    expect((await agent.patch(`${base}/${a.id}`, { dependencyIds: [a.id], expectedVersion: 1 })).status).toBe(400);
    const cycle = await agent.patch(`${base}/${a.id}`, { dependencyIds: [b.id], expectedVersion: 1 });
    expect(cycle.status).toBe(400);
    expect(cycle.body.error.fields.dependencyIds).toMatch(/cycle/);
    // Requirement of another project cannot be read through this project.
    expect((await agent.get(`${base}/${foreign.id}`)).status).toBe(404);
  });

  it("flags ambiguity and shows missing verification until a passing test is linked", async () => {
    const project = await createProject();
    const base = `/api/projects/${project.id}/requirements`;
    const req = (await agent.post(base, { title: "Export", status: "DEVELOPED" })).body.requirement;
    expect(req.missingVerification).toBe(true);
    expect((await agent.post(`${base}/${req.id}/flag`, { flagged: true })).status).toBe(400);
    const flagged = await agent.post(`${base}/${req.id}/flag`, { flagged: true, reason: "Which formats?" });
    expect(flagged.body.requirement).toMatchObject({ flaggedForReview: true, flagReason: "Which formats?" });

    let dashboard = (await agent.get("/api/dashboard")).body;
    expect(dashboard.requirements).toMatchObject({ total: 1, flaggedForReview: 1, missingVerification: 1 });
    expect(dashboard.alerts.map((alert: { kind: string }) => alert.kind)).toEqual(
      expect.arrayContaining(["FLAGGED", "MISSING_VERIFICATION"]),
    );

    const linked = await agent.post(`${base}/${req.id}/links`, {
      kind: "TEST",
      reference: "apps/api/test/export.test.ts",
      evidenceStatus: "PASSED",
    });
    expect(linked.status).toBe(201);
    expect(linked.body.requirement.missingVerification).toBe(false);
    dashboard = (await agent.get("/api/dashboard")).body;
    expect(dashboard.requirements.missingVerification).toBe(0);

    const linkId = linked.body.requirement.links[0].id;
    const removed = await agent.delete(`${base}/${req.id}/links/${linkId}`);
    expect(removed.body.requirement.missingVerification).toBe(true);
  });

  it("blocks new requirements on archived projects", async () => {
    const project = await createProject();
    await agent.post(`/api/projects/${project.id}/archive`);
    expect((await agent.post(`/api/projects/${project.id}/requirements`, { title: "x" })).status).toBe(409);
  });
});

describe("template catalog (US-D01, US-D02)", () => {
  const base = {
    title: "React starter",
    category: "Web",
    license: "MIT",
    ownership: "ASAA",
    technologies: ["React", "Vite"],
    tags: ["starter"],
  };

  it("registers, searches and filters catalog items", async () => {
    expect((await agent.post("/api/catalog", { ...base, slug: "react-starter", lifecycle: "ACTIVE" })).status).toBe(
      201,
    );
    expect(
      (
        await agent.post("/api/catalog", {
          ...base,
          slug: "express-api",
          title: "Express API",
          category: "API",
          technologies: ["node"],
        })
      ).status,
    ).toBe(201);
    expect((await agent.post("/api/catalog", { ...base, slug: "react-starter" })).status).toBe(409);

    const all = await agent.get("/api/catalog");
    expect(all.body.items).toHaveLength(2);
    expect(all.body.categories).toEqual(["API", "Web"]);
    expect(
      (await agent.get("/api/catalog?technology=react")).body.items.map((item: { slug: string }) => item.slug),
    ).toEqual(["react-starter"]);
    expect((await agent.get("/api/catalog?q=express")).body.items).toHaveLength(1);
    expect((await agent.get("/api/catalog?lifecycle=ACTIVE")).body.items).toHaveLength(1);
    expect((await agent.get("/api/catalog?tag=starter")).body.items).toHaveLength(2);
  });

  it("treats imported source as untrusted until reviewed", async () => {
    const created = await agent.post("/api/catalog", {
      ...base,
      slug: "legacy-crm",
      sourceType: "IMPORTED",
      sourceReference: "git@example:crm.git",
    });
    expect(created.body.item).toMatchObject({ trustStatus: "UNTRUSTED", lifecycle: "DRAFT", metadataSchemaVersion: 1 });
    const id = created.body.item.id;
    const activate = await agent.patch(`/api/catalog/${id}`, { lifecycle: "ACTIVE", expectedVersion: 1 });
    expect(activate.status).toBe(400);
    const trusted = await agent.patch(`/api/catalog/${id}`, {
      trustStatus: "TRUSTED",
      lifecycle: "ACTIVE",
      expectedVersion: 1,
    });
    expect(trusted.body.item).toMatchObject({ trustStatus: "TRUSTED", lifecycle: "ACTIVE", rowVersion: 2 });
    const audit = await agent.get("/api/audit?action=catalog.trust_change");
    expect(audit.body.events).toHaveLength(1);
  });
});

describe("audit log reader", () => {
  it("pages events newest first and filters by outcome", async () => {
    await createProject("A1");
    await createProject("B2");
    const page = await agent.get("/api/audit?limit=2");
    expect(page.body.events).toHaveLength(2);
    expect(page.body.events[0].action).toBe("project.create");
    expect(page.body.nextBefore).not.toBeNull();
    const next = await agent.get(`/api/audit?limit=2&before=${page.body.nextBefore}`);
    expect(next.body.events[0].action).toBe("auth.login");
  });
});
