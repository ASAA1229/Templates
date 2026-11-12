import { cp, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Request } from "express";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { GenerationService } from "../src/modules/generation/generation.service.js";
import { TemplateLibrary } from "../src/modules/generation/library.js";
import { nodeFs } from "../src/modules/generation/writer.js";
import { createHarness, OWNER_EMAIL } from "./helpers.js";

const BUNDLED = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../template-library");
let base: string;
let library: string;
let output: string;
let h: ReturnType<typeof createHarness>;
let agent: Awaited<ReturnType<ReturnType<typeof createHarness>["signedIn"]>>;

beforeAll(async () => {
  base = await mkdtemp(path.join(tmpdir(), "asaa-generation-"));
  library = path.join(base, "library");
  output = path.join(base, "output");
  h = createHarness({ TEMPLATE_LIBRARY_DIR: library, GENERATION_OUTPUT_DIR: output });
});
afterAll(async () => {
  await h.close();
  await rm(base, { recursive: true, force: true });
});
beforeEach(async () => {
  await rm(library, { recursive: true, force: true });
  await rm(output, { recursive: true, force: true });
  await cp(BUNDLED, library, { recursive: true });
  await h.reset();
  await h.createOwner();
  agent = await h.signedIn();
});

const scratch = (key: string, extra: Record<string, unknown> = {}) => ({
  mode: "SCRATCH",
  projectType: "web-app",
  project: { key, name: `${key} app`, purpose: "Customer portal" },
  inputs: { nodeVersion: "24", includeTests: true },
  requirements: ["Sign in", "View orders"],
  ...extra,
});

async function approveLanding() {
  const response = await agent.post("/api/templates/library/landing-page/1.0.0/approve");
  expect(response.status).toBe(201);
  return response.body.item as { id: string; rowVersion: number; contentDigest: string };
}

const landing = (catalogItemId: string, key = "SITE", inputs: Record<string, unknown> = {}) => ({
  mode: "TEMPLATE",
  catalogItemId,
  project: { key, name: "Acme site", purpose: "Marketing site" },
  inputs: { headline: "Build faster", contactEmail: "hello@acme.test", ...inputs },
});

describe("start from scratch (US-E02)", () => {
  it("generates an independent project with provenance, requirements and audit", async () => {
    const response = await agent.post("/api/generations", scratch("PORTAL"));
    expect(response.status).toBe(201);
    const generation = response.body.generation;
    expect(generation).toMatchObject({
      status: "SUCCEEDED",
      mode: "SCRATCH",
      templateId: "starter-web-app",
      templateVersion: "1.0.0",
      outputDir: "portal",
      projectKey: "PORTAL",
      inputs: { nodeVersion: "24", includeTests: true },
      requirements: ["Sign in", "View orders"],
      attempts: 1,
      error: null,
    });
    expect(generation.blueprint).toMatchObject({
      family: "web-app",
      architecture: "single-page-app",
      packageManager: "npm",
    });
    expect(generation.outputDigest).toMatch(/^[0-9a-f]{64}$/);
    expect(generation.files).toContain("src/App.test.ts");

    const out = path.join(output, "portal");
    const pkg = JSON.parse(await readFile(path.join(out, "package.json"), "utf8"));
    expect(pkg).toMatchObject({ name: "portal", description: "Customer portal" });
    const provenance = JSON.parse(await readFile(path.join(out, ".asaa", "generation.json"), "utf8"));
    expect(provenance).toMatchObject({
      generationId: generation.id,
      project: {
        blueprint: {
          family: "web-app",
          architecture: "single-page-app",
          packageManager: "npm",
        },
      },
      template: { id: "starter-web-app", version: "1.0.0", digest: generation.templateDigest },
      inputsHash: generation.inputsHash,
      outputDigest: generation.outputDigest,
    });

    const projectDetail = await agent.get(`/api/projects/${generation.projectId}`);
    expect(projectDetail.body.project.blueprint).toMatchObject({
      family: "web-app",
      architecture: "single-page-app",
      frameworks: [
        { name: "React", version: "19" },
        { name: "Vite", version: "7" },
      ],
    });
    const requirements = await agent.get(`/api/projects/${generation.projectId}/requirements`);
    expect(requirements.body.requirements.map((r: { code: string; title: string }) => `${r.code} ${r.title}`)).toEqual([
      "REQ-1 Sign in",
      "REQ-2 View orders",
    ]);
    // Later requirements continue the numbering.
    const next = await agent.post(`/api/projects/${generation.projectId}/requirements`, { title: "Pay" });
    expect(next.body.requirement.code).toBe("REQ-3");

    const actions = (await h.ctx.prisma.auditEvent.findMany({ orderBy: { id: "asc" } })).map((e) => e.action);
    expect(actions).toEqual(expect.arrayContaining(["project.create", "generation.complete"]));
    // Nothing was written outside the configured generation root.
    expect(await readdir(output)).toEqual(["portal"]);
  });

  it("is reproducible: same inputs give the same output digest, and verify confirms it", async () => {
    const first = (await agent.post("/api/generations", scratch("ONE"))).body.generation;
    const preview = await agent.post("/api/generations/preview", scratch("ONE"));
    expect(preview.body.preview.outputDigest).toBe(first.outputDigest);
    expect(preview.body.preview.conflicts).toEqual([
      "A project with key ONE already exists.",
      'An output folder named "one" already exists.',
    ]);
    const verification = await agent.post(`/api/generations/${first.id}/verify`);
    expect(verification.body.verification).toMatchObject({ reproducible: true, outputIntact: true, problems: [] });

    await writeFile(path.join(output, "one", "README.txt"), "tampered");
    const tampered = await agent.post(`/api/generations/${first.id}/verify`);
    expect(tampered.body.verification).toMatchObject({ reproducible: true, outputIntact: false });
  });

  it("validates required, optional and unknown configuration on the server", async () => {
    const missing = await agent.post(
      "/api/generations",
      scratch("API", { projectType: "api-service", inputs: { port: "1" } }),
    );
    expect(missing.status).toBe(400);
    expect(missing.body.error.fields).toHaveProperty("inputs.port");
    const unknown = await agent.post("/api/generations", scratch("WEB", { inputs: { evil: "x" } }));
    expect(unknown.status).toBe(400);
    expect(unknown.body.error.fields).toHaveProperty("inputs");
    const badType = await agent.post("/api/generations", scratch("WEB", { projectType: "mainframe" }));
    expect(badType.status).toBe(400);
    const defaults = await agent.post("/api/generations", scratch("BLANK", { projectType: "blank", inputs: {} }));
    expect(defaults.status).toBe(201);
    expect(defaults.body.generation.inputs).toEqual({ summary: "" });
    expect(await h.ctx.prisma.project.count()).toBe(1);
  });

  it("resolves the exact starter ID and version selected by the builder", async () => {
    const options = await agent.get("/api/templates/options");
    const starter = options.body.starters.find((item: { id: string }) => item.id === "starter-api-service");
    expect(starter).toMatchObject({ id: "starter-api-service", version: "1.0.0", projectType: "api-service" });
    const response = await agent.post(
      "/api/generations",
      scratch("EXACTAPI", {
        projectType: "api-service",
        starterId: starter.id,
        starterVersion: starter.version,
        blueprint: starter.manifest.blueprint,
        inputs: { port: "8080" },
      }),
    );
    expect(response.status).toBe(201);
    expect(response.body.generation).toMatchObject({
      templateId: "starter-api-service",
      templateVersion: "1.0.0",
      blueprint: { family: "backend-service", architecture: "layered-service" },
    });
  });

  it("rejects a blueprint that does not match the selected starter", async () => {
    const incompatible = {
      family: "backend-service",
      architecture: "layered-service",
      runtimes: [{ name: "Node.js", version: "24" }],
      languages: [{ name: "TypeScript", version: "5.9" }],
      frameworks: [{ name: "Express", version: "5" }],
      packageManager: "npm",
      databases: [],
      apis: [{ name: "REST HTTP", version: "1" }],
      infrastructure: [{ name: "Node.js server", version: "1" }],
      operatingSystems: ["linux", "windows", "macos"],
    };
    const response = await agent.post("/api/generations", scratch("MISMATCH", { blueprint: incompatible }));
    expect(response.status).toBe(400);
    expect(response.body.error.fields).toHaveProperty("blueprint");
    expect(await h.ctx.prisma.project.count()).toBe(0);
  });

  it("previews without writing anything", async () => {
    const preview = await agent.post("/api/generations/preview", scratch("DRY"));
    expect(preview.status).toBe(200);
    expect(preview.body.preview).toMatchObject({
      outputDir: "dry",
      conflicts: [],
      blueprint: { family: "web-app", architecture: "single-page-app" },
    });
    expect(preview.body.preview.files.map((f: { path: string }) => f.path)).toContain("package.json");
    expect(await h.ctx.prisma.project.count()).toBe(0);
    expect(await readdir(output).catch(() => [])).toEqual([]);
  });
});

describe("start from a template (US-E01)", () => {
  it("generates only from approved, trusted, active content and records provenance", async () => {
    const options = await agent.get("/api/templates/options");
    expect(options.body.templates).toEqual([]);
    expect(options.body.starters.map((s: { projectType: string }) => s.projectType).sort()).toEqual([
      "api-service",
      "blank",
      "web-app",
    ]);

    const item = await approveLanding();
    const listed = await agent.get("/api/templates/options");
    expect(listed.body.templates[0]).toMatchObject({
      eligible: true,
      reasons: [],
      catalogItem: { contentRef: "landing-page" },
    });

    const response = await agent.post("/api/generations", landing(item.id));
    expect(response.status).toBe(201);
    expect(response.body.generation).toMatchObject({
      status: "SUCCEEDED",
      mode: "TEMPLATE",
      catalogItemId: item.id,
      templateId: "landing-page",
      templateVersion: "1.0.0",
      templateDigest: item.contentDigest,
    });
    const html = await readFile(path.join(output, "site", "index.html"), "utf8");
    expect(html).toContain("<h1>Build faster</h1>");
    // Source template is untouched and independent of the output.
    expect(await readFile(path.join(library, "landing-page", "1.0.0", "files", "index.html"), "utf8")).toContain(
      "{{headline}}",
    );
  });

  it("rejects untrusted, deprecated and changed template content with audit", async () => {
    const item = await approveLanding();
    const untrusted = await agent.patch(`/api/catalog/${item.id}`, {
      trustStatus: "UNDER_REVIEW",
      lifecycle: "DRAFT",
      expectedVersion: item.rowVersion,
    });
    expect(untrusted.status).toBe(200);
    const rejected = await agent.post("/api/generations", landing(item.id));
    expect(rejected.status).toBe(422);
    expect(rejected.body.error.code).toBe("NOT_ELIGIBLE");
    expect(rejected.body.error.message).toMatch(/not been reviewed and trusted/);

    // Re-approving existing content updates the same record (200) and restores ACTIVE + TRUSTED.
    const again = await agent.post("/api/templates/library/landing-page/1.0.0/approve");
    expect(again.status).toBe(200);
    const reapproved = again.body.item;
    expect(reapproved).toMatchObject({ id: item.id, trustStatus: "TRUSTED", lifecycle: "ACTIVE" });
    const deprecated = await agent.patch(`/api/catalog/${reapproved.id}`, {
      lifecycle: "DEPRECATED",
      expectedVersion: reapproved.rowVersion,
    });
    expect(deprecated.status).toBe(200);
    expect((await agent.post("/api/generations", landing(item.id))).body.error.message).toMatch(/deprecated/);

    // Approve again, then change the content on disk: the approval no longer covers it.
    const fresh = (await agent.post("/api/templates/library/landing-page/1.0.0/approve")).body.item;
    expect(fresh.lifecycle).toBe("ACTIVE");
    await writeFile(path.join(library, "landing-page", "1.0.0", "files", "README.txt"), "changed {{projectName}}");
    const changed = await agent.post("/api/generations", landing(item.id));
    expect(changed.status).toBe(422);
    expect(changed.body.error.message).toMatch(/changed since it was approved/);

    const denied = await h.ctx.prisma.auditEvent.count({ where: { action: "generation.rejected", outcome: "DENIED" } });
    expect(denied).toBe(3);
    expect(await h.ctx.prisma.project.count()).toBe(0);
  });

  it("rejects version mismatches, unsupported generators and non-template records", async () => {
    const item = await approveLanding();
    const bumped = await agent.patch(`/api/catalog/${item.id}`, { version: "2.0.0", expectedVersion: item.rowVersion });
    expect(bumped.status).toBe(200);
    expect((await agent.post("/api/generations", landing(item.id))).body.error.message).toMatch(
      /not in the local template library/,
    );

    const manifestPath = path.join(library, "landing-page", "1.0.0", "manifest.json");
    const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
    await writeFile(manifestPath, JSON.stringify({ ...manifest, compatibility: { generator: 2 } }));
    const invalid = await agent.post("/api/templates/library/landing-page/1.0.0/approve");
    expect(invalid.status).toBe(422);
    expect(invalid.body.error.message).toMatch(/Requires generator 2\.x/);

    const component = await agent.post("/api/catalog", {
      slug: "button-kit",
      title: "Button kit",
      kind: "COMPONENT",
      category: "UI",
      license: "MIT",
      ownership: "Owner",
      lifecycle: "ACTIVE",
    });
    const notTemplate = await agent.post("/api/generations", landing(component.body.item.id));
    expect(notTemplate.status).toBe(422);
    expect(notTemplate.body.error.message).toMatch(/Only template catalog items/);

    expect((await agent.post("/api/templates/library/starter-blank/1.0.0/approve")).status).toBe(422);
    expect((await agent.post("/api/templates/library/missing/1.0.0/approve")).status).toBe(404);
  });

  it("validates template inputs including formats and placeholder injection", async () => {
    const item = await approveLanding();
    const response = await agent.post(
      "/api/generations",
      landing(item.id, "SITE", { headline: "{{projectKey}}", accentColor: "red", contactEmail: "nope" }),
    );
    expect(response.status).toBe(400);
    expect(Object.keys(response.body.error.fields).sort()).toEqual([
      "inputs.accentColor",
      "inputs.contactEmail",
      "inputs.headline",
    ]);
    const missing = await agent.post("/api/generations", landing(item.id, "SITE", { headline: "" }));
    expect(missing.body.error.fields["inputs.headline"]).toBe("Headline is required.");
  });
});

describe("conflicts, failures and recovery", () => {
  it("refuses duplicate project keys and existing output folders without side effects", async () => {
    expect((await agent.post("/api/generations", scratch("DUP"))).status).toBe(201);
    const duplicate = await agent.post("/api/generations", scratch("DUP"));
    expect(duplicate.status).toBe(409);

    await mkdir(path.join(output, "taken"), { recursive: true });
    await writeFile(path.join(output, "taken", "notes.txt"), "keep me");
    const conflict = await agent.post("/api/generations", scratch("TAKEN"));
    expect(conflict.status).toBe(409);
    expect(conflict.body.error.message).toMatch(/output folder named "taken" already exists/);
    expect(await readdir(path.join(output, "taken"))).toEqual(["notes.txt"]);
    expect(await h.ctx.prisma.project.count()).toBe(1);
  });

  it("records a failed write as FAILED with no output, then succeeds on retry", async () => {
    let fail = true;
    const service = new GenerationService(h.ctx, {
      library: new TemplateLibrary(library),
      outputRoot: output,
      fs: {
        ...nodeFs,
        writeFile: (async (...args: Parameters<typeof nodeFs.writeFile>) => {
          if (fail) throw Object.assign(new Error("EIO: disk failure"), { code: "EIO" });
          return nodeFs.writeFile(...args);
        }) as typeof nodeFs.writeFile,
      },
    });
    const owner = await h.ctx.prisma.owner.findUniqueOrThrow({ where: { email: OWNER_EMAIL } });
    const req = {
      owner: { id: owner.id, email: owner.email, displayName: "Owner", role: "OWNER" },
      requestId: "test",
    } as Request;

    const failed = await service.generate(req, scratch("FLAKY"));
    expect(failed).toMatchObject({ status: "FAILED", outputDigest: null, completedAt: null });
    expect(failed.error).toMatch(/No partial output was kept/);
    expect(await readdir(output)).toEqual([]);

    // The API reports the failure without claiming success.
    const viaApi = await agent.get(`/api/generations/${failed.id}`);
    expect(viaApi.body.generation).toMatchObject({ status: "FAILED", files: [] });
    expect(
      (await agent.post(`/api/generations/${failed.id}/retry`, { expectedVersion: failed.version + 5 })).status,
    ).toBe(409);

    fail = false;
    const retried = await service.retry(req, failed.id, failed.version);
    expect(retried).toMatchObject({ status: "SUCCEEDED", attempts: 2, error: null });
    expect(await readdir(output)).toEqual(["flaky"]);
    expect((await agent.post(`/api/generations/${failed.id}/retry`, { expectedVersion: retried.version })).status).toBe(
      409,
    );
  });

  it("rolls back the project and requirements when the database transaction fails", async () => {
    const prisma = h.ctx.prisma;
    const failingPrisma = new Proxy(prisma, {
      get(target, prop, receiver) {
        if (prop !== "$transaction") return Reflect.get(target, prop, receiver);
        return (callback: (tx: unknown) => Promise<unknown>) =>
          target.$transaction((tx) =>
            callback(
              new Proxy(tx, {
                get(txTarget, txProp, txReceiver) {
                  if (txProp === "projectGeneration") {
                    return { create: () => Promise.reject(new Error("simulated database failure")) };
                  }
                  return Reflect.get(txTarget, txProp, txReceiver);
                },
              }),
            ),
          );
      },
    });
    const service = new GenerationService(
      { ...h.ctx, prisma: failingPrisma },
      {
        library: new TemplateLibrary(library),
        outputRoot: output,
      },
    );
    const owner = await prisma.owner.findUniqueOrThrow({ where: { email: OWNER_EMAIL } });
    const req = {
      owner: { id: owner.id, email: owner.email, displayName: "Owner", role: "OWNER" },
      requestId: "test",
    } as Request;
    await expect(service.generate(req, scratch("ROLLBACK"))).rejects.toThrow("simulated database failure");
    expect(await prisma.project.count()).toBe(0);
    expect(await prisma.requirement.count()).toBe(0);
    expect(await readdir(output).catch(() => [])).toEqual([]);
  });

  it("allows only one of two simultaneous generations for the same project key", async () => {
    const responses = await Promise.all([
      agent.post("/api/generations", scratch("TWIN")),
      agent.post("/api/generations", scratch("TWIN")),
    ]);
    expect(responses.map((response) => response.status).sort()).toEqual([201, 409]);
    expect(await h.ctx.prisma.project.count()).toBe(1);
    expect(await h.ctx.prisma.projectGeneration.count()).toBe(1);
    expect((await readdir(output)).filter((name) => !name.startsWith("."))).toEqual(["twin"]);
  });

  it("retry adopts an intact output this generation already published, but never a changed one", async () => {
    const generated = (await agent.post("/api/generations", scratch("ADOPT"))).body.generation;
    // Simulate a crash after publishing but before the success was recorded.
    const markFailed = () =>
      h.ctx.prisma.projectGeneration.update({
        where: { id: generated.id },
        data: { status: "FAILED", outputDigest: null, completedAt: null, version: { increment: 1 } },
      });
    const failed = await markFailed();
    const adopted = await agent.post(`/api/generations/${generated.id}/retry`, { expectedVersion: failed.version });
    expect(adopted.body.generation).toMatchObject({
      status: "SUCCEEDED",
      attempts: 2,
      outputDigest: generated.outputDigest,
    });

    await writeFile(path.join(output, "adopt", "README.txt"), "edited by hand");
    const failedAgain = await markFailed();
    const refused = await agent.post(`/api/generations/${generated.id}/retry`, {
      expectedVersion: failedAgain.version,
    });
    expect(refused.body.generation).toMatchObject({ status: "FAILED", attempts: 3 });
    expect(refused.body.generation.error).toMatch(/already exists/);
    expect(await readFile(path.join(output, "adopt", "README.txt"), "utf8")).toBe("edited by hand");
  });

  it("blocks anonymous and cross-site generation attempts", async () => {
    const anonymous = h.agent();
    expect((await anonymous.post("/api/generations", scratch("ANON"))).status).toBe(401);
    expect((await anonymous.get("/api/templates/options")).status).toBe(401);
    const noCsrf = await agent.raw.post("/api/generations").send(scratch("CSRF"));
    expect(noCsrf.status).toBe(403);
    expect((await agent.get("/api/generations/not-a-uuid")).status).toBe(404);
    expect(await h.ctx.prisma.project.count()).toBe(0);
  });

  it("lists generations per project and exposes library status", async () => {
    const generation = (await agent.post("/api/generations", scratch("LISTED"))).body.generation;
    const list = await agent.get(`/api/generations?projectId=${generation.projectId}`);
    expect(list.body.generations.map((g: { id: string }) => g.id)).toEqual([generation.id]);
    const libraryView = await agent.get("/api/templates/library");
    const landingSummary = libraryView.body.templates.find((t: { id: string }) => t.id === "landing-page");
    expect(landingSummary).toMatchObject({ valid: true, approved: false, kind: "template" });
  });
});

describe("project-to-template contribution (US-X03)", () => {
  it("captures developed project files as a pending candidate and only adds it after owner approval", async () => {
    const generated = (await agent.post("/api/generations", scratch("CONTRIB"))).body.generation;
    const submitted = await agent.post("/api/projects/" + generated.projectId + "/template-submissions", {
      title: "Customer portal starter",
      slug: "customer-portal-starter",
      description: "Reusable baseline from a completed customer portal project.",
      category: "web-app",
      version: "1.0.0",
      license: "UNLICENSED",
      customerPermission: true,
      rightsConfirmed: true,
      secretsChecked: true,
      inputs: [{ id: "projectName", label: "Project name", type: "string", required: true, maxLength: 80 }],
    });
    expect(submitted.status).toBe(201);
    expect(submitted.body.submission).toMatchObject({
      status: "PENDING_REVIEW",
      templateId: "customer-portal-starter",
    });
    expect((await agent.get("/api/templates/options")).body.templates).toEqual([]);
    const pending = await agent.get("/api/projects/template-submissions");
    expect(pending.body.submissions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: submitted.body.submission.id, status: "PENDING_REVIEW", projectKey: "CONTRIB" }),
      ]),
    );
    const approved = await agent.post(
      "/api/projects/template-submissions/" + submitted.body.submission.id + "/approve",
    );
    expect(approved.status).toBe(201);
    expect(approved.body).toMatchObject({
      status: "APPROVED",
      item: { slug: "customer-portal-starter", trustStatus: "TRUSTED", lifecycle: "ACTIVE" },
    });
    const options = await agent.get("/api/templates/options");
    expect(options.body.templates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          catalogItem: expect.objectContaining({ slug: "customer-portal-starter" }),
          eligible: true,
        }),
      ]),
    );
  });
  it("rejects submissions without customer permission, contribution rights and secret-review attestations", async () => {
    const generated = (await agent.post("/api/generations", scratch("NOATTEST"))).body.generation;
    const response = await agent.post("/api/projects/" + generated.projectId + "/template-submissions", {
      title: "Unsafe candidate",
      slug: "unsafe-candidate",
      description: "",
      category: "web-app",
      version: "1.0.0",
      license: "UNLICENSED",
      customerPermission: false,
      rightsConfirmed: false,
      secretsChecked: false,
    });
    expect(response.status).toBe(400);
    expect(response.body.error.fields).toHaveProperty("customerPermission");
  });
});
