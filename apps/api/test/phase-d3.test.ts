import { cp, mkdtemp, readdir, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Request } from "express";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createJarvisClient, HttpJarvisClient } from "../src/integrations/jarvis.js";
import { hashPassword } from "../src/lib/password.js";
import { AuthoringService, extractJsonObject, unsafeSourcePath } from "../src/modules/authoring/authoring.js";
import { TemplateLibrary } from "../src/modules/generation/library.js";
import { diffManifests } from "../src/modules/generation/release-diff.js";
import { createHarness } from "./helpers.js";

/** Phase D3 sanity coverage: delivery ledger, taxonomy/sectors, authoring, JARVIS, connectors, ops overview. */
const BUNDLED = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../template-library");
const PASSWORD = "a sufficiently long test password";

let base: string;
let library: string;
let output: string;
let delivery: string;
let h: ReturnType<typeof createHarness>;
let owner: Awaited<ReturnType<typeof h.signedIn>>;

beforeAll(async () => {
  base = await mkdtemp(path.join(tmpdir(), "asaa-d3-"));
  library = path.join(base, "library");
  output = path.join(base, "output");
  delivery = path.join(base, "delivery");
  h = createHarness({ TEMPLATE_LIBRARY_DIR: library, GENERATION_OUTPUT_DIR: output, DELIVERY_DIR: delivery });
});
afterAll(async () => {
  await h.close();
  await rm(base, { recursive: true, force: true, maxRetries: 8, retryDelay: 250 });
});
beforeEach(async () => {
  for (const dir of [library, output, delivery])
    await rm(dir, { recursive: true, force: true, maxRetries: 8, retryDelay: 250 });
  await cp(BUNDLED, library, { recursive: true });
  await h.reset();
  await h.ctx.prisma.$executeRawUnsafe('TRUNCATE "TaxonomyTerm", "DeliveryRequest" RESTART IDENTITY CASCADE');
  await h.createOwner();
  owner = await h.signedIn();
});

async function account(email: string, role: "ADMIN" | "EMPLOYEE" | "DEVELOPER") {
  const user = await h.ctx.prisma.owner.create({
    data: {
      email,
      displayName: email,
      role,
      passwordHash: await hashPassword(PASSWORD),
      passwordChangedAt: new Date(h.clock.now.getTime() - 1000),
      createdAt: new Date(h.clock.now.getTime() - 1000),
    },
  });
  const agent = h.agent();
  expect((await agent.post("/api/auth/login", { email, password: PASSWORD })).status).toBe(200);
  return { user, agent };
}

async function generatedProject(agent: ReturnType<typeof h.agent>, key = "DELIVER") {
  const created = await agent.post("/api/generations", {
    mode: "SCRATCH",
    projectType: "web-app",
    project: { key, name: "Delivery demo", purpose: "delivery" },
    inputs: {},
  });
  expect(created.status).toBe(201);
  return created.body.generation.projectId as string;
}

describe("delivery workflows (D3.12-D3.14)", () => {
  it("requires explicit confirmation to export and records the export in the ledger", async () => {
    const { agent } = await account("employee@asaa.test", "EMPLOYEE");
    const projectId = await generatedProject(agent);
    const refused = await agent.post(`/api/projects/${projectId}/delivery/export`, { scope: "ZIP_EXPORT" });
    expect(refused.status).toBe(422);
    const response = await agent.post(`/api/projects/${projectId}/delivery/export`, {
      scope: "WORKSPACE_EXPORT",
      confirm: true,
    });
    expect(response.status).toBe(200);
    expect(response.headers["content-type"]).toBe("application/zip");
    const list = await agent.get(`/api/projects/${projectId}/delivery`);
    expect(list.body.requests[0]).toMatchObject({ kind: "WORKSPACE_EXPORT", status: "EXECUTED", provider: "download" });
  });

  it("executes repository handoff and deployment only after a management approval", async () => {
    const { agent, user } = await account("employee@asaa.test", "EMPLOYEE");
    const projectId = await generatedProject(agent);
    const handoff = await agent.post(`/api/projects/${projectId}/delivery/requests`, {
      kind: "REPOSITORY_HANDOFF",
      target: "delivery-demo",
    });
    expect(handoff.status).toBe(201);
    expect(handoff.body.request.status).toBe("REQUESTED");
    // Employees cannot decide, and nothing was created yet.
    expect((await agent.post(`/api/delivery/requests/${handoff.body.request.id}/approve`, {})).status).toBe(403);
    await expect(stat(path.join(delivery, "repositories", "delivery-demo"))).rejects.toThrow();
    // Duplicate open requests are refused; unknown environments are refused.
    expect(
      (
        await agent.post(`/api/projects/${projectId}/delivery/requests`, {
          kind: "REPOSITORY_HANDOFF",
          target: "delivery-demo",
        })
      ).status,
    ).toBe(409);
    expect(
      (await agent.post(`/api/projects/${projectId}/delivery/requests`, { kind: "DEPLOYMENT", target: "mars" })).status,
    ).toBe(422);

    const approved = await owner.post(`/api/delivery/requests/${handoff.body.request.id}/approve`, { note: "ok" });
    expect(approved.status).toBe(200);
    expect(approved.body.request).toMatchObject({ status: "EXECUTED", provider: "local-git-host" });
    expect(approved.body.request.result.commit).toMatch(/^[0-9a-f]{40}$/);
    const repo = path.join(delivery, "repositories", "delivery-demo");
    expect((await stat(path.join(repo, ".git"))).isDirectory()).toBe(true);
    expect((await readdir(repo)).includes("package.json")).toBe(true);
    // A second decision is refused.
    expect((await owner.post(`/api/delivery/requests/${handoff.body.request.id}/approve`, {})).status).toBe(409);

    const deploy = await agent.post(`/api/projects/${projectId}/delivery/requests`, {
      kind: "DEPLOYMENT",
      target: "staging",
    });
    expect(deploy.status).toBe(201);
    const rejected = await owner.post(`/api/delivery/requests/${deploy.body.request.id}/reject`, { note: "not now" });
    expect(rejected.body.request.status).toBe("REJECTED");
    const again = await agent.post(`/api/projects/${projectId}/delivery/requests`, {
      kind: "DEPLOYMENT",
      target: "staging",
    });
    const done = await owner.post(`/api/delivery/requests/${again.body.request.id}/approve`, {});
    expect(done.body.request.status).toBe("EXECUTED");
    expect((await stat(done.body.request.result.location)).isFile()).toBe(true);
    const audits = await h.ctx.prisma.auditEvent.findMany({ where: { action: { startsWith: "delivery." } } });
    expect(audits.map((event) => event.action)).toEqual(
      expect.arrayContaining(["delivery.request", "delivery.execute", "delivery.reject"]),
    );
    expect(user.id).toBeTruthy();
  });
});

describe("taxonomy and sectors (D3.6, D3.7)", () => {
  it("lets management manage sectors and assign catalogue items; employees only read", async () => {
    const { agent } = await account("employee@asaa.test", "EMPLOYEE");
    expect((await agent.post("/api/catalog/taxonomy", { kind: "SECTOR", key: "retail", label: "Retail" })).status).toBe(
      403,
    );
    const created = await owner.post("/api/catalog/taxonomy", { kind: "SECTOR", key: "retail", label: "Retail" });
    expect(created.status).toBe(201);
    expect((await owner.post("/api/catalog/taxonomy", { kind: "SECTOR", key: "retail", label: "Again" })).status).toBe(
      409,
    );
    const item = await owner.post("/api/catalog", {
      slug: "demo-tpl",
      title: "Demo",
      category: "Retail",
      license: "MIT",
      ownership: "Team",
    });
    expect(item.status).toBe(201);
    expect(
      (
        await owner.post("/api/catalog", {
          slug: "bad-sector",
          title: "Bad",
          category: "x",
          license: "MIT",
          ownership: "T",
          sector: "nope",
        })
      ).status,
    ).toBe(400);
    const assigned = await owner.post("/api/catalog/taxonomy/assign-sector", {
      sector: "retail",
      itemIds: [item.body.item.id],
    });
    expect(assigned.body.updated).toBe(1);
    const filtered = await agent.get("/api/catalog?sector=retail");
    expect(filtered.body.items.map((entry: { slug: string }) => entry.slug)).toEqual(["demo-tpl"]);
    const listing = await agent.get("/api/catalog/taxonomy");
    expect(listing.body.terms[0]).toMatchObject({ key: "retail", itemCount: 1 });
    expect(listing.body.unmanagedCategories).toEqual(["Retail"]);
    const adopted = await owner.post("/api/catalog/taxonomy/adopt-categories", {});
    expect(adopted.body.created).toEqual(["retail"]);
    // A sector with items cannot be deleted.
    expect((await owner.delete(`/api/catalog/taxonomy/${created.body.term.id}`)).status).toBe(409);
  });
});

describe("template authoring (D3.1-D3.4)", () => {
  it("validates paths and AI output parsing", () => {
    expect(unsafeSourcePath("src/index.ts")).toBeNull();
    for (const bad of ["../x", "/abs", ".env", "node_modules/x.js", "a\\b", "keys/server.pem"]) {
      expect(unsafeSourcePath(bad), bad).not.toBeNull();
    }
    expect(extractJsonObject('noise {"a":1} tail')).toEqual({ a: 1 });
    expect(() => extractJsonObject("no json here")).toThrow();
  });

  it("takes a draft from blank to a reviewed, published template with visual and source edits", async () => {
    const { agent } = await account("author@asaa.test", "EMPLOYEE");
    const created = await agent.post("/api/templates/authoring/drafts", {
      mode: "blank",
      slug: "authored-demo",
      title: "Authored demo",
      category: "Demos",
    });
    expect(created.status).toBe(201);
    const id = created.body.draft.id as string;
    expect(created.body.draft).toMatchObject({ aiGenerated: false, status: "DRAFT", revision: 1 });
    // Visual edit: add an input, then use it from the source editor.
    const meta = await agent.patch(`/api/templates/authoring/drafts/${id}/metadata`, {
      expectedRevision: 1,
      license: "MIT",
      inputs: [{ id: "greeting", label: "Greeting", type: "string", required: false, default: "hi" }],
    });
    expect(meta.status).toBe(200);
    const stale = await agent.patch(`/api/templates/authoring/drafts/${id}/metadata`, {
      expectedRevision: 1,
      title: "Stale",
    });
    expect(stale.status).toBe(409);
    const edited = await agent.put(`/api/templates/authoring/drafts/${id}/file`, {
      path: "docs/hello.txt",
      content: "{{greeting}} from {{projectName}}",
      expectedRevision: 2,
    });
    expect(edited.status).toBe(200);
    expect(edited.body.draft.problems).toEqual([]);
    expect(edited.body.draft.manifest.files.map((file: { source: string }) => file.source)).toContain("docs/hello.txt");
    const unsafe = await agent.put(`/api/templates/authoring/drafts/${id}/file`, {
      path: "../x",
      content: "x",
      expectedRevision: 3,
    });
    expect(unsafe.status).toBe(400);
    const undeclared = await agent.put(`/api/templates/authoring/drafts/${id}/file`, {
      path: "bad.txt",
      content: "{{nope}}",
      expectedRevision: 3,
    });
    expect(undeclared.body.draft.problems.join(" ")).toContain("undeclared placeholder");
    // Problems block submission; so does missing confirmation.
    const blocked = await agent.post(`/api/templates/authoring/drafts/${id}/submit`, {
      customerPermission: true,
      rightsConfirmed: true,
      secretsChecked: true,
      expectedRevision: 4,
    });
    expect(blocked.status).toBe(400);
    const fixed = await agent.post(`/api/templates/authoring/drafts/${id}/file/delete`, {
      path: "bad.txt",
      expectedRevision: 4,
    });
    expect(fixed.body.draft.problems).toEqual([]);
    const needsConfirm = await agent.post(`/api/templates/authoring/drafts/${id}/submit`, { expectedRevision: 5 });
    expect(needsConfirm.status).toBe(400);
    const submitted = await agent.post(`/api/templates/authoring/drafts/${id}/submit`, {
      customerPermission: true,
      rightsConfirmed: true,
      secretsChecked: true,
      expectedRevision: 5,
    });
    expect(submitted.status).toBe(201);
    // Still not in the catalogue until an authorized reviewer approves.
    expect((await owner.get("/api/catalog")).body.items).toEqual([]);
    expect(
      (await agent.post(`/api/projects/template-submissions/${submitted.body.submissionId}/approve`, {})).status,
    ).toBe(403);
    const approved = await owner.post(`/api/projects/template-submissions/${submitted.body.submissionId}/approve`, {});
    expect(approved.status).toBe(201);
    expect(approved.body.item).toMatchObject({ slug: "authored-demo", lifecycle: "ACTIVE" });
    const pending = await owner.get("/api/projects/template-submissions");
    expect(pending.body.submissions[0]).toMatchObject({ aiGenerated: false, status: "APPROVED" });
    // Authors see only their own drafts; the draft is read-only after submission.
    expect((await owner.get("/api/templates/authoring/drafts")).body.drafts).toHaveLength(1);
    expect(
      (
        await agent.put(`/api/templates/authoring/drafts/${id}/file`, {
          path: "a.txt",
          content: "x",
          expectedRevision: 6,
        })
      ).status,
    ).toBe(409);
  });

  it("flags AI-generated drafts and requires a person's review before submission", async () => {
    const { user } = await account("ai-author@asaa.test", "EMPLOYEE");
    const reply = JSON.stringify({
      title: "AI starter",
      description: "From a brief",
      technologies: [{ name: "Static", version: "1" }],
      inputs: [],
      files: [{ path: "index.html", content: "<h1>{{projectName}}</h1>" }],
    });
    const calls: string[] = [];
    const fakeFetch = (async (url: URL | string) => {
      calls.push(String(url));
      return new Response(JSON.stringify({ response: reply }), { status: 200 });
    }) as typeof fetch;
    const ctx = { ...h.ctx, config: { ...h.ctx.config, AI_ENABLED: true } };
    const service = new AuthoringService(ctx, new TemplateLibrary(library), fakeFetch);
    const req = {
      owner: { id: user.id, role: "EMPLOYEE", displayName: "AI Author", email: user.email },
      requestId: "r1",
    } as unknown as Request;
    const draft = await service.create(req, {
      mode: "ai",
      slug: "ai-starter",
      category: "Demos",
      brief: "A static landing page",
    });
    expect(calls[0]).toContain("/api/generate");
    expect(draft).toMatchObject({ aiGenerated: true, aiFiles: ["index.html"], status: "DRAFT" });
    const body = {
      customerPermission: true,
      rightsConfirmed: true,
      secretsChecked: true,
      expectedRevision: draft.revision,
    };
    await expect(service.submit(req, draft.id, body)).rejects.toThrow(/AI-generated/);
    const meta = await service.updateMetadata(req, draft.id, { expectedRevision: draft.revision, license: "MIT" });
    const done = await service.submit(req, draft.id, { ...body, expectedRevision: meta.revision, aiReviewed: true });
    const event = await h.ctx.prisma.auditEvent.findFirst({
      where: { action: "template.submission_create", targetId: done.submissionId },
    });
    expect(event?.metadata).toMatchObject({ aiGenerated: true, aiFiles: ["index.html"], source: "authoring-draft" });
    // AI off: creation is refused with a clear message.
    const off = new AuthoringService(h.ctx, new TemplateLibrary(library), fakeFetch);
    await expect(off.create(req, { mode: "ai", slug: "ai-two", category: "Demos", brief: "x" })).rejects.toThrow(
      /turned off/,
    );
  });
});

describe("JARVIS mini-features (D3.5)", () => {
  it("is disabled by default and works only through the configured local gateway when enabled", async () => {
    const status = await owner.get("/api/jarvis/status");
    expect(status.body.status).toMatchObject({ enabled: false, reachable: null });
    expect((await owner.post("/api/jarvis/invoke", { feature: "summarize-template", content: "x" })).status).toBe(422);
    const seen: { url: string; auth: string | null }[] = [];
    const client = createJarvisClient(
      {
        JARVIS_FEATURES_ENABLED: true,
        JARVIS_AI_URL: "http://127.0.0.1:3100",
        JARVIS_AI_KEY: "jrv_abcdef012345_" + "A".repeat(43),
        AI_TIMEOUT_MS: 5000,
      },
      (async (url: URL | string, init?: RequestInit) => {
        seen.push({ url: String(url), auth: new Headers(init?.headers).get("authorization") });
        return new Response(JSON.stringify({ choices: [{ message: { content: "- summary" } }] }), { status: 200 });
      }) as typeof fetch,
    );
    expect(client).toBeInstanceOf(HttpJarvisClient);
    expect(await client.invoke("summarize-template", "text", "r1")).toBe("- summary");
    expect(seen[0]!.url).toBe("http://127.0.0.1:3100/v1/chat/completions");
    expect(seen[0]!.auth).toMatch(/^Bearer jrv_/);
  });
});

describe("connectors and operations (D3.20, D3.21)", () => {
  it("runs a mock build and publishes a project archive under management approval only", async () => {
    const { agent } = await account("employee@asaa.test", "EMPLOYEE");
    expect((await agent.get("/api/connectors")).status).toBe(403);
    const list = await owner.get("/api/connectors");
    expect(list.body.connectors.map((connector: { id: string }) => connector.id)).toEqual([
      "local-build",
      "local-registry",
    ]);
    expect((await owner.get("/api/connectors/local-build/health")).body.health.ok).toBe(true);
    const outside = await owner.post("/api/connectors/local-build/builds", { job: "other-job" });
    expect(outside.status).toBe(403);
    const build = await owner.post("/api/connectors/local-build/builds", { job: "templates-ci" });
    expect(build.status).toBe(201);
    const status = await owner.get(`/api/connectors/local-build/builds/${build.body.build.buildId}?job=templates-ci`);
    expect(["QUEUED", "RUNNING", "SUCCESS"]).toContain(status.body.status.state);
    const projectId = await generatedProject(owner, "CONNECT");
    const published = await owner.post("/api/connectors/local-registry/artifacts", {
      repository: "templates-artifacts",
      path: "connect.zip",
      projectId,
    });
    expect(published.status).toBe(201);
    const listed = await owner.get("/api/connectors/local-registry/artifacts?repository=templates-artifacts");
    expect(listed.body.artifacts).toEqual(["connect.zip"]);
    await owner.post("/api/connectors/local-registry/revoke", {});
    expect((await owner.get("/api/connectors/local-registry/artifacts?repository=templates-artifacts")).status).toBe(
      403,
    );
  });

  it("summarises operations and assets for management only", async () => {
    const { agent } = await account("employee@asaa.test", "EMPLOYEE");
    expect((await agent.get("/api/ops/overview")).status).toBe(403);
    await owner.post("/api/catalog", {
      slug: "stale-one",
      title: "Imported",
      category: "x",
      license: "MIT",
      ownership: "T",
      sourceType: "IMPORTED",
      sourceReference: "somewhere",
    });
    const overview = (await owner.get("/api/ops/overview")).body.overview;
    expect(overview.assets).toMatchObject({ total: 1, unsectored: 1 });
    expect(overview.assets.attention[0].reason).toContain("Not trusted");
    expect(overview.integrations).toMatchObject({ jarvisEnabled: false });
    expect(overview.integrations.connectors.map((connector: { id: string }) => connector.id)).toContain("local-build");
  });
});

describe("release comparison (D3.10)", () => {
  it("reports changed fields and added or removed inputs, files and dependencies", () => {
    const from = {
      title: "A",
      license: { spdx: "MIT" },
      inputs: [{ id: "name" }],
      files: [{ source: "a.txt" }],
      dependencies: [{ name: "x", version: "1" }],
    };
    const to = {
      title: "B",
      license: { spdx: "MIT" },
      inputs: [{ id: "name" }, { id: "color" }],
      files: [{ source: "b.txt" }],
      dependencies: [],
    };
    const changes = diffManifests(from, to);
    expect(changes.fields).toEqual([{ field: "title", from: "A", to: "B" }]);
    expect(changes.inputs).toEqual({ added: ["color"], removed: [] });
    expect(changes.files).toEqual({ added: ["b.txt"], removed: ["a.txt"] });
    expect(changes.dependencies).toEqual({ added: [], removed: ["x@1"] });
    expect(diffManifests(from, from).fields).toEqual([]);
  });

  it("serves a comparison of two ledger versions to template readers", async () => {
    const { agent } = await account("reader@asaa.test", "EMPLOYEE");
    const manifest = (title: string) => ({ title, license: { spdx: "MIT" }, inputs: [], files: [], dependencies: [] });
    const creator = (await h.ctx.prisma.owner.findFirstOrThrow()).id;
    for (const [version, title] of [
      ["1.0.0", "One"],
      ["1.1.0", "Two"],
    ] as const) {
      await h.ctx.prisma.templateRelease.create({
        data: {
          templateId: "cmp-demo",
          version,
          status: "DRAFT",
          contentDigest: "a".repeat(64),
          manifest: manifest(title),
          createdById: creator,
        },
      });
    }
    const response = await agent.get("/api/templates/releases/compare?templateId=cmp-demo&from=1.0.0&to=1.1.0");
    expect(response.status).toBe(200);
    expect(response.body.comparison.changes.fields).toEqual([{ field: "title", from: "One", to: "Two" }]);
    expect((await agent.get("/api/templates/releases/compare?templateId=cmp-demo&from=1.0.0&to=9.9.9")).status).toBe(
      404,
    );
    expect((await agent.get("/api/templates/releases/compare?templateId=cmp-demo")).status).toBe(400);
  });
});
