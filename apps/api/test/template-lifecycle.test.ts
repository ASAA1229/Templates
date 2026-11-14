import { cp, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { renderWithAdapter } from "../src/modules/generation/adapters.js";
import { isUsable, TemplateLibrary } from "../src/modules/generation/library.js";
import { hashPassword } from "../src/lib/password.js";
import { createHarness } from "./helpers.js";

/** RG-05 (blueprint/generator reproducibility) and RG-06 (template release lifecycle). */
const BUNDLED = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../template-library");
const TEMPLATE = "restaurant-essential";
const PASSWORD = "a sufficiently long test password";

let base: string;
let library: string;
let output: string;
let h: ReturnType<typeof createHarness>;
let owner: Awaited<ReturnType<typeof h.signedIn>>;
let admin: ReturnType<typeof h.agent>;
let developer: ReturnType<typeof h.agent>;

beforeAll(async () => {
  base = await mkdtemp(path.join(tmpdir(), "asaa-lifecycle-"));
  library = path.join(base, "library");
  output = path.join(base, "output");
  h = createHarness({ TEMPLATE_LIBRARY_DIR: library, GENERATION_OUTPUT_DIR: output });
});
afterAll(async () => {
  await h.close();
  await rm(base, { recursive: true, force: true, maxRetries: 8, retryDelay: 250 });
});

async function account(email: string, role: "ADMIN" | "DEVELOPER") {
  await h.ctx.prisma.owner.create({
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
  return agent;
}

beforeEach(async () => {
  await rm(library, { recursive: true, force: true, maxRetries: 8, retryDelay: 250 });
  await rm(output, { recursive: true, force: true, maxRetries: 8, retryDelay: 250 });
  await cp(BUNDLED, library, { recursive: true });
  await h.reset();
  await h.createOwner();
  owner = await h.signedIn();
  admin = await account("admin@asaa.test", "ADMIN");
  developer = await account("dev@asaa.test", "DEVELOPER");
});

/** A new library version: same content plus a marker, so digests and outputs differ from 1.0.0. */
async function addVersion(version: string) {
  const from = path.join(library, TEMPLATE, "1.0.0");
  const to = path.join(library, TEMPLATE, version);
  await cp(from, to, { recursive: true });
  const manifestPath = path.join(to, "manifest.json");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  manifest.version = version;
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2));
  const readme = path.join(to, "files", "README.md");
  await writeFile(readme, `${await readFile(readme, "utf8")}\nRelease ${version} notes.\n`);
}

async function release(version: string, author = developer, approver = admin) {
  const draft = await author.post("/api/templates/releases", { templateId: TEMPLATE, version, notes: "initial" });
  expect(draft.status, JSON.stringify(draft.body)).toBe(201);
  const id = draft.body.release.id as string;
  expect((await author.post(`/api/templates/releases/${id}/submit`)).status).toBe(200);
  expect((await approver.post(`/api/templates/releases/${id}/approve`, { note: "looks good" })).status).toBe(200);
  const released = await approver.post(`/api/templates/releases/${id}/release`);
  expect(released.status, JSON.stringify(released.body)).toBe(200);
  return { id, itemId: released.body.item.id as string, release: released.body.release };
}

const generate = (agent: typeof owner, itemId: string, key: string, extra: Record<string, unknown> = {}) =>
  agent.post("/api/generations", {
    mode: "TEMPLATE",
    catalogItemId: itemId,
    project: { key, name: `${key} site`, purpose: "Lifecycle test" },
    inputs: {},
    ...extra,
  });

describe("RG-06 template release lifecycle", () => {
  it("moves draft -> review -> approved -> released with separate people and audit", async () => {
    const draft = await developer.post("/api/templates/releases", { templateId: TEMPLATE, version: "1.0.0" });
    expect(draft.status).toBe(201);
    expect(draft.body.release).toMatchObject({ status: "DRAFT", templateId: TEMPLATE, version: "1.0.0" });
    const id = draft.body.release.id;

    // Out-of-order steps are refused.
    expect((await admin.post(`/api/templates/releases/${id}/approve`)).status).toBe(409);
    expect((await admin.post(`/api/templates/releases/${id}/release`)).status).toBe(409);
    expect((await developer.post(`/api/templates/releases/${id}/submit`)).status).toBe(200);
    // Developers cannot approve; rejection needs a reason and returns the draft to its author.
    expect((await developer.post(`/api/templates/releases/${id}/approve`)).status).toBe(403);
    expect((await admin.post(`/api/templates/releases/${id}/reject`, {})).status).toBe(400);
    const rejected = await admin.post(`/api/templates/releases/${id}/reject`, { note: "add contact details" });
    expect(rejected.body.release).toMatchObject({ status: "DRAFT", reviewNote: "add contact details" });
    await developer.post(`/api/templates/releases/${id}/submit`);
    expect((await admin.post(`/api/templates/releases/${id}/approve`)).body.release.status).toBe("APPROVED");

    const released = await admin.post(`/api/templates/releases/${id}/release`);
    expect(released.body.release).toMatchObject({ status: "RELEASED" });
    const item = await h.ctx.prisma.catalogItem.findUniqueOrThrow({ where: { slug: TEMPLATE } });
    expect(item).toMatchObject({ lifecycle: "ACTIVE", trustStatus: "TRUSTED", version: "1.0.0" });
    const actions = (
      await h.ctx.prisma.auditEvent.findMany({ where: { action: { startsWith: "template.release." } } })
    ).map((event) => event.action);
    expect(actions).toEqual(
      expect.arrayContaining([
        "template.release.draft",
        "template.release.submit",
        "template.release.reject",
        "template.release.approve",
      ]),
    );
    expect((await developer.get("/api/templates/releases?status=RELEASED")).body.releases).toHaveLength(1);
  });

  it("requires a second person: the author cannot approve their own release unless they are the OWNER", async () => {
    const draft = await admin.post("/api/templates/releases", { templateId: TEMPLATE, version: "1.0.0" });
    const id = draft.body.release.id;
    await admin.post(`/api/templates/releases/${id}/submit`);
    expect((await admin.post(`/api/templates/releases/${id}/approve`)).status).toBe(403);
    expect((await owner.post(`/api/templates/releases/${id}/approve`)).status).toBe(200);
  });

  it("makes a released version immutable in the API and in the database", async () => {
    const { id } = await release("1.0.0");
    // The same version with different content cannot be re-approved or re-drafted.
    await writeFile(path.join(library, TEMPLATE, "1.0.0", "files", "README.md"), "tampered");
    const again = await owner.post(`/api/templates/library/${TEMPLATE}/1.0.0/approve`);
    expect(again.status).toBe(409);
    expect(again.body.error.message).toMatch(/immutable/);
    expect((await developer.post("/api/templates/releases", { templateId: TEMPLATE, version: "1.0.0" })).status).toBe(
      409,
    );

    // Catalog metadata of a released item cannot be renumbered or relicensed.
    const item = await h.ctx.prisma.catalogItem.findUniqueOrThrow({ where: { slug: TEMPLATE } });
    const patch = await owner.patch(`/api/catalog/${item.id}`, { license: "MIT", expectedVersion: item.rowVersion });
    expect(patch.status).toBe(400);

    // Even direct SQL cannot rewrite a released version.
    await expect(
      h.ctx.prisma.templateRelease.update({ where: { id }, data: { contentDigest: "0".repeat(64) } }),
    ).rejects.toThrow(/immutable/);
    await expect(h.ctx.prisma.templateRelease.update({ where: { id }, data: { status: "DRAFT" } })).rejects.toThrow(
      /return to review/,
    );
    await expect(h.ctx.prisma.templateRelease.delete({ where: { id } })).rejects.toThrow(/cannot be deleted/);
  });

  it("detects content that changed between draft and approval", async () => {
    const draft = await developer.post("/api/templates/releases", { templateId: TEMPLATE, version: "1.0.0" });
    const id = draft.body.release.id;
    await developer.post(`/api/templates/releases/${id}/submit`);
    await writeFile(path.join(library, TEMPLATE, "1.0.0", "files", "README.md"), "changed after submission");
    const approve = await admin.post(`/api/templates/releases/${id}/approve`);
    expect(approve.status).toBe(409);
    expect(approve.body.error.message).toMatch(/changed since this draft/);
  });

  it("refuses to draft packages that fail certification checks", async () => {
    const manifestPath = path.join(library, TEMPLATE, "1.0.0", "manifest.json");
    const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
    manifest.license = { spdx: "GPL-3.0-only" };
    await writeFile(manifestPath, JSON.stringify(manifest));
    const draft = await developer.post("/api/templates/releases", { templateId: TEMPLATE, version: "1.0.0" });
    expect(draft.status).toBe(400);
    expect(JSON.stringify(draft.body)).toMatch(/license/);
  });

  it("pins prior versions: new releases move the catalog forward while older releases stay generatable", async () => {
    const v1 = await release("1.0.0");
    await addVersion("1.1.0");
    const v2 = await release("1.1.0");
    expect(v2.itemId).toBe(v1.itemId);

    const latest = await generate(owner, v1.itemId, "NEWEST");
    expect(latest.status, JSON.stringify(latest.body)).toBe(201);
    expect(latest.body.generation.templateVersion).toBe("1.1.0");

    const pinned = await generate(owner, v1.itemId, "PINNED", { templateVersion: "1.0.0" });
    expect(pinned.status, JSON.stringify(pinned.body)).toBe(201);
    expect(pinned.body.generation.templateVersion).toBe("1.0.0");
    expect(pinned.body.generation.outputDigest).not.toBe(latest.body.generation.outputDigest);
    expect(
      (await owner.post(`/api/generations/${pinned.body.generation.id}/verify`)).body.verification.reproducible,
    ).toBe(true);

    // Unreleased or unknown versions cannot be pinned.
    const missing = await generate(owner, v1.itemId, "MISSING", { templateVersion: "9.9.9" });
    expect(missing.status).toBe(422);

    // Deprecating 1.0.0 blocks new pinned use but not verification of existing projects or the current release.
    const deprecate = await admin.post(`/api/templates/releases/${v1.id}/deprecate`, {
      reason: "superseded by 1.1.0",
      replacedByVersion: "1.1.0",
    });
    expect(deprecate.status).toBe(200);
    expect(deprecate.body.release).toMatchObject({ status: "DEPRECATED", replacedByVersion: "1.1.0" });
    const deprecated = await generate(owner, v1.itemId, "OLDER", { templateVersion: "1.0.0" });
    expect(deprecated.status).toBe(422);
    expect(deprecated.body.error.message).toMatch(/deprecated/);
    expect((await owner.post(`/api/generations/${pinned.body.generation.id}/verify`)).status).toBe(200);
    expect((await generate(owner, v1.itemId, "CURRENT")).status).toBe(201);

    // Deprecating the current release deprecates the catalog item; a bogus replacement is rejected.
    const bad = await admin.post(`/api/templates/releases/${v2.id}/deprecate`, {
      reason: "x",
      replacedByVersion: "5.0.0",
    });
    expect(bad.status).toBe(400);
    expect((await admin.post(`/api/templates/releases/${v2.id}/deprecate`, { reason: "retire all" })).status).toBe(200);
    expect((await h.ctx.prisma.catalogItem.findUniqueOrThrow({ where: { id: v1.itemId } })).lifecycle).toBe(
      "DEPRECATED",
    );
    expect((await generate(owner, v1.itemId, "BLOCKED")).status).toBe(422);
    // A deprecated release can never be restored.
    await expect(
      h.ctx.prisma.templateRelease.update({ where: { id: v2.id }, data: { status: "RELEASED" } }),
    ).rejects.toThrow(/cannot be restored/);
  });

  it("keeps the owner fast-track working and ledgered", async () => {
    const approved = await owner.post(`/api/templates/library/${TEMPLATE}/1.0.0/approve`);
    expect(approved.status).toBe(201);
    const ledger = await h.ctx.prisma.templateRelease.findUniqueOrThrow({
      where: { templateId_version: { templateId: TEMPLATE, version: "1.0.0" } },
    });
    expect(ledger.status).toBe("RELEASED");
    expect((await owner.post(`/api/templates/library/${TEMPLATE}/1.0.0/approve`)).status).toBe(200);
  });
});

describe("RG-05 reproducible generation and preview parity", () => {
  it("renders byte-identical output on repeat and matches preview, disk and verification digests", async () => {
    const { itemId } = await release("1.0.0");
    const body = {
      mode: "TEMPLATE",
      catalogItemId: itemId,
      project: { key: "REPEAT", name: "Repeat site", purpose: "Reproducibility" },
      inputs: { headline: "Same every time", accentColor: "#0f766e" },
    };
    const preview = await owner.post("/api/generations/preview", body);
    expect(preview.status).toBe(200);
    const generated = await owner.post("/api/generations", body);
    expect(generated.status).toBe(201);
    const generation = generated.body.generation;
    expect(generation.outputDigest).toBe(preview.body.preview.outputDigest);
    expect(generation.files.sort()).toEqual(
      preview.body.preview.files.map((file: { path: string }) => file.path).sort(),
    );
    const verification = (await owner.post(`/api/generations/${generation.id}/verify`)).body.verification;
    expect(verification).toMatchObject({ reproducible: true, outputIntact: true, problems: [] });

    // Independent renders of the same inputs are byte-identical, and equal what was written to disk.
    const template = (await new TemplateLibrary(library).get(TEMPLATE, "1.0.0"))!;
    expect(isUsable(template)).toBe(true);
    if (!isUsable(template)) return;
    const context = {
      manifest: template.manifest,
      sources: template.files,
      values: { ...generation.inputs },
      project: {
        projectKey: "REPEAT",
        projectName: "Repeat site",
        projectSlug: "repeat",
        projectPurpose: "Reproducibility",
      },
    };
    const first = renderWithAdapter(context);
    const second = renderWithAdapter({
      ...context,
      sources: new Map([...template.files].map(([k, v]) => [k, Buffer.from(v)])),
    });
    expect(second.files.map((f) => f.path)).toEqual(first.files.map((f) => f.path));
    for (const [index, file] of first.files.entries())
      expect(second.files[index]!.content.equals(file.content)).toBe(true);
    const onDisk = path.join(output, generation.outputDir);
    for (const file of first.files)
      expect((await readFile(path.join(onDisk, file.path))).equals(file.content)).toBe(true);
    expect((await readdir(onDisk)).length).toBeGreaterThan(0);
  });

  it("records a versioned blueprint and rejects incompatible blueprints", async () => {
    const options = await owner.get("/api/templates/options");
    const starter = options.body.starters.find((item: { id: string }) => item.id === "starter-api-service");
    const blueprint = starter.manifest.blueprint;
    const body = (extra: object) => ({
      mode: "SCRATCH",
      projectType: "api-service",
      project: { key: "BLUEPR", name: "Blueprint project", purpose: "Typed inputs" },
      inputs: { nodeVersion: "24", port: "8080" },
      ...extra,
    });
    const ok = await owner.post("/api/generations", body({ blueprint: { ...blueprint, schemaVersion: 1 } }));
    expect(ok.status, JSON.stringify(ok.body)).toBe(201);
    // Newer schema versions than the platform understands, and mismatched families, fail at the boundary.
    expect(
      (await owner.post("/api/generations/preview", body({ blueprint: { ...blueprint, schemaVersion: 2 } }))).status,
    ).toBe(400);
    expect(
      (await owner.post("/api/generations/preview", body({ blueprint: { ...blueprint, family: "web-app" } }))).status,
    ).toBe(400);
    // Typed inputs: wrong option and unknown keys are rejected with field errors.
    const typed = await owner.post(
      "/api/generations/preview",
      body({ inputs: { nodeVersion: "99", port: "8080", extra: "x" } }),
    );
    expect(typed.status).toBe(400);
    expect(Object.keys(typed.body.error.fields ?? {}).length).toBeGreaterThan(0);
  });
});
