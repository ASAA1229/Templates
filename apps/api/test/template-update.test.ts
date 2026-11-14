import { cp, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { hashPassword } from "../src/lib/password.js";
import { planUpdate } from "../src/modules/generation/update-plan.js";
import { createHarness } from "./helpers.js";

/** US-E05: impact analysis and safe, opt-in update of a generated project to a newer template release. */
const BUNDLED = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../template-library");
const TEMPLATE = "restaurant-essential";
const buf = (text: string) => Buffer.from(text);

describe("update plan (three-way)", () => {
  it("classifies every combination without ever overwriting local work", () => {
    const base = new Map([
      ["same", buf("a")],
      ["upstream-changed", buf("a")],
      ["both-changed", buf("a")],
      ["removed-clean", buf("a")],
      ["removed-edited", buf("a")],
      ["deleted-local", buf("a")],
    ]);
    const current = new Map([
      ["same", buf("local edit")],
      ["upstream-changed", buf("a")],
      ["both-changed", buf("mine")],
      ["removed-clean", buf("a")],
      ["removed-edited", buf("edited")],
      ["team-file", buf("x")],
      ["new-clash", buf("different")],
    ]);
    const target = new Map([
      ["same", buf("a")],
      ["upstream-changed", buf("b")],
      ["both-changed", buf("theirs")],
      ["deleted-local", buf("b")],
      ["brand-new", buf("n")],
      ["new-clash", buf("upstream")],
    ]);
    const plan = planUpdate(base, current, target);
    const action = (name: string) => plan.entries.find((entry) => entry.path === name)!.action;
    expect(action("same")).toBe("unchanged");
    expect(action("upstream-changed")).toBe("update");
    expect(action("both-changed")).toBe("conflict");
    expect(action("removed-clean")).toBe("remove");
    expect(action("removed-edited")).toBe("conflict");
    expect(action("deleted-local")).toBe("conflict");
    expect(action("brand-new")).toBe("add");
    expect(action("new-clash")).toBe("conflict");
    expect(action("team-file")).toBe("unchanged");
    expect(plan.clean).toBe(false);
  });
});

describe("update API", () => {
  let base: string;
  let library: string;
  let output: string;
  let h: ReturnType<typeof createHarness>;
  let owner: Awaited<ReturnType<typeof h.signedIn>>;

  beforeAll(async () => {
    base = await mkdtemp(path.join(tmpdir(), "asaa-update-"));
    library = path.join(base, "library");
    output = path.join(base, "output");
    h = createHarness({ TEMPLATE_LIBRARY_DIR: library, GENERATION_OUTPUT_DIR: output });
  });
  afterAll(async () => {
    await h.close();
    await rm(base, { recursive: true, force: true, maxRetries: 8, retryDelay: 250 });
  });
  beforeEach(async () => {
    await rm(library, { recursive: true, force: true, maxRetries: 8, retryDelay: 250 });
    await rm(output, { recursive: true, force: true, maxRetries: 8, retryDelay: 250 });
    await cp(BUNDLED, library, { recursive: true });
    await h.reset();
    await h.createOwner();
    owner = await h.signedIn();
  });

  async function addVersion(version: string, readmeNote: string) {
    const to = path.join(library, TEMPLATE, version);
    await cp(path.join(library, TEMPLATE, "1.0.0"), to, { recursive: true });
    const manifestPath = path.join(to, "manifest.json");
    const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
    manifest.version = version;
    await writeFile(manifestPath, JSON.stringify(manifest, null, 2));
    const readme = path.join(to, "files", "README.md");
    await writeFile(readme, `${await readFile(readme, "utf8")}\n${readmeNote}\n`);
  }

  async function release(version: string) {
    const draft = await owner.post("/api/templates/releases", { templateId: TEMPLATE, version });
    expect(draft.status, JSON.stringify(draft.body)).toBe(201);
    const id = draft.body.release.id;
    await owner.post(`/api/templates/releases/${id}/submit`);
    await owner.post(`/api/templates/releases/${id}/approve`, {});
    const released = await owner.post(`/api/templates/releases/${id}/release`);
    expect(released.status).toBe(200);
    return { id, itemId: released.body.item.id as string };
  }

  async function project() {
    const v1 = await release("1.0.0");
    const created = await owner.post("/api/generations", {
      mode: "TEMPLATE",
      catalogItemId: v1.itemId,
      project: { key: "UPDATE", name: "Update me", purpose: "Template update" },
      inputs: {},
    });
    expect(created.status).toBe(201);
    return { generation: created.body.generation, dir: path.join(output, created.body.generation.outputDir), v1 };
  }

  it("previews and applies a clean update with a backup, leaving other local files alone", async () => {
    const { generation, dir } = await project();
    await addVersion("1.1.0", "New in 1.1.0.");
    await release("1.1.0");
    await writeFile(path.join(dir, "team-notes.txt"), "local only");

    const preview = await owner.get(`/api/generations/${generation.id}/update-preview?toVersion=1.1.0`);
    expect(preview.status, JSON.stringify(preview.body)).toBe(200);
    expect(preview.body.plan.counts).toMatchObject({ update: 1, conflict: 0 });
    expect(preview.body.plan.entries.find((entry: { path: string }) => entry.path === "README.md").action).toBe(
      "update",
    );
    // Previewing changes nothing.
    expect(await readFile(path.join(dir, "README.md"), "utf8")).not.toContain("New in 1.1.0.");

    const applied = await owner.post(`/api/generations/${generation.id}/update`, { toVersion: "1.1.0" });
    expect(applied.status).toBe(200);
    expect(applied.body.applied).toEqual(["README.md"]);
    expect(await readFile(path.join(dir, "README.md"), "utf8")).toContain("New in 1.1.0.");
    expect(await readFile(path.join(dir, "team-notes.txt"), "utf8")).toBe("local only");
    const backupDir = path.join(dir, ...applied.body.backup.split("/"));
    expect(await readFile(path.join(backupDir, "README.md"), "utf8")).not.toContain("New in 1.1.0.");
    expect((await readdir(backupDir)).length).toBe(1);
    expect(await h.ctx.prisma.auditEvent.count({ where: { action: "generation.update" } })).toBe(1);
  });

  it("never overwrites locally modified files: conflicts are reported and skipped", async () => {
    const { generation, dir } = await project();
    await addVersion("1.1.0", "New in 1.1.0.");
    await release("1.1.0");
    await writeFile(path.join(dir, "README.md"), "my own readme");
    const preview = await owner.get(`/api/generations/${generation.id}/update-preview?toVersion=1.1.0`);
    expect(preview.body.plan).toMatchObject({ clean: false, counts: { conflict: 1, update: 0 } });
    const applied = await owner.post(`/api/generations/${generation.id}/update`, { toVersion: "1.1.0" });
    expect(applied.body).toMatchObject({ applied: [], skipped: ["README.md"] });
    expect(await readFile(path.join(dir, "README.md"), "utf8")).toBe("my own readme");
  });

  it("refuses unreleased, deprecated, identical and malformed targets, and enforces roles", async () => {
    const { generation, v1 } = await project();
    await addVersion("1.1.0", "x");
    const url = (version: string) => `/api/generations/${generation.id}/update-preview?toVersion=${version}`;
    expect((await owner.get(url("1.1.0"))).status).toBe(422);
    const v2 = await release("1.1.0");
    expect((await owner.get(url("1.1.0"))).status).toBe(200);
    expect((await owner.get(url("1.0.0"))).status).toBe(409);
    expect((await owner.get(url("not-a-version"))).status).toBe(400);
    await owner.post(`/api/templates/releases/${v2.id}/deprecate`, { reason: "bad release" });
    expect((await owner.get(url("1.1.0"))).status).toBe(422);
    void v1;

    await h.ctx.prisma.owner.create({
      data: {
        email: "viewer@asaa.test",
        displayName: "viewer",
        role: "EMPLOYEE",
        passwordHash: await hashPassword("a sufficiently long test password"),
        passwordChangedAt: new Date(h.clock.now.getTime() - 1000),
        createdAt: new Date(h.clock.now.getTime() - 1000),
      },
    });
    await owner.post(`/api/projects/${generation.projectId}/members`, { email: "viewer@asaa.test", role: "VIEWER" });
    const viewer = h.agent();
    await viewer.post("/api/auth/login", { email: "viewer@asaa.test", password: "a sufficiently long test password" });
    expect((await viewer.post(`/api/generations/${generation.id}/update`, { toVersion: "1.1.0" })).status).toBe(404);
    expect((await h.agent().get(url("1.1.0"))).status).toBe(401);
  });
});
