import { mkdir, mkdtemp, readFile, rm, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { GitClient, GitCommandError, LocalGitProvider } from "../src/modules/workspace/git.js";
import { DEFAULT_BRANCH_POLICY } from "@asaa/contracts";
import { createHarness } from "./helpers.js";

let base: string;
let output: string;
let h: ReturnType<typeof createHarness>;
let agent: Awaited<ReturnType<ReturnType<typeof createHarness>["signedIn"]>>;

beforeAll(async () => {
  base = await mkdtemp(path.join(tmpdir(), "asaa-workspace-"));
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

async function generated(key = "SHOP", projectType = "web-app") {
  const response = await agent.post("/api/generations", {
    mode: "SCRATCH",
    projectType,
    project: { key, name: `${key} app`, purpose: "Testing the workspace" },
    inputs: {},
  });
  expect(response.status).toBe(201);
  return response.body.generation as { id: string; projectId: string; outputDir: string };
}

const ws = (projectId: string) => `/api/projects/${projectId}/workspace`;

async function initialized(key = "SHOP") {
  const generation = await generated(key);
  const init = await agent.post(`${ws(generation.projectId)}/repository`, { identity });
  expect(init.status).toBe(201);
  return { ...generation, dir: path.join(output, generation.outputDir), repository: init.body.repository };
}

const git = () => new GitClient("git", 20_000, output);

describe("repository initialization (US-F01)", () => {
  it("initializes a repository with an initial commit, identity and provenance-safe digest", async () => {
    const generation = await generated();
    const before = await agent.get(ws(generation.projectId));
    expect(before.body.workspace).toMatchObject({
      detection: "none",
      repository: null,
      output: { available: true, outputDir: "shop" },
      git: { available: true },
    });
    expect(
      before.body.workspace.providers.map((p: { provider: string; available: boolean }) => [p.provider, p.available]),
    ).toEqual([
      ["LOCAL_GIT", true],
      ["GITHUB", false],
      ["GITLAB", false],
      ["BITBUCKET", false],
    ]);

    const init = await agent.post(`${ws(generation.projectId)}/repository`, { identity });
    expect(init.status).toBe(201);
    expect(init.body.repository).toMatchObject({
      provider: "LOCAL_GIT",
      defaultBranch: "main",
      identity,
      adoptedExisting: false,
      remote: null,
      policy: { productionBranch: "main", integrationBranch: "dev", protectedBranches: ["main", "dev"] },
    });

    const after = (await agent.get(ws(generation.projectId))).body.workspace;
    expect(after.detection).toBe("registered");
    expect(after.state.head).toMatchObject({ branch: "main", detached: false });
    expect(after.state.head.sha).toMatch(/^[0-9a-f]{40}$/);
    expect(after.state.commits).toHaveLength(1);
    expect(after.state.commits[0]).toMatchObject({
      subject: "Initial commit: SHOP generated from starter-web-app@1.0.0",
      author: "Owner Name",
      email: "owner@asaa.test",
    });
    expect(after.state.status).toEqual({ clean: true, entries: [], truncated: false });
    expect(after.warnings.join(" ")).toMatch(/protected branch main/);
    expect(after.activity.map((event: { action: string }) => event.action)).toContain("repository.init");

    // Repository-level identity only; generated content digest is unaffected by .git.
    const config = await readFile(path.join(output, "shop", ".git", "config"), "utf8");
    expect(config).toContain("email = owner@asaa.test");
    const verification = await agent.post(`/api/generations/${generation.id}/verify`);
    expect(verification.body.verification).toMatchObject({ outputIntact: true, reproducible: true });

    expect((await agent.post(`${ws(generation.projectId)}/repository`, { identity })).status).toBe(409);
  });

  it("detects and adopts an existing repository without rewriting history", async () => {
    const generation = await generated();
    await git().init(path.join(output, "shop"), "trunk");
    const detected = (await agent.get(ws(generation.projectId))).body.workspace;
    expect(detected.detection).toBe("existing");
    expect(detected.state.head).toEqual({ branch: "trunk", sha: null, detached: false });
    const init = await agent.post(`${ws(generation.projectId)}/repository`, { identity, initialCommit: true });
    expect(init.body.repository).toMatchObject({ adoptedExisting: true, defaultBranch: "trunk" });
    const after = (await agent.get(ws(generation.projectId))).body.workspace;
    expect(after.state.commits).toEqual([]);
    expect(after.state.status.entries.length).toBeGreaterThan(0);
  });

  it("refuses .git files or links that could point outside the project folder", async () => {
    const generation = await generated();
    const elsewhere = path.join(base, "elsewhere.git");
    await mkdir(elsewhere, { recursive: true });
    await writeFile(path.join(output, "shop", ".git"), `gitdir: ${elsewhere}\n`);
    const workspace = (await agent.get(ws(generation.projectId))).body.workspace;
    expect(workspace.detection).toBe("unsafe");
    expect(workspace.state).toBeNull();
    const init = await agent.post(`${ws(generation.projectId)}/repository`, { identity });
    expect(init.status).toBe(409);
  });

  it("never falls back to a parent repository", async () => {
    await generated();
    // Make the whole output root a repository; the project folder itself has no .git.
    await git().init(output, "main");
    const provider = new LocalGitProvider(git());
    await expect(provider.inspect(path.join(output, "shop"), DEFAULT_BRANCH_POLICY, 5)).rejects.toBeInstanceOf(
      GitCommandError,
    );
  });

  it("explains why projects without a generated folder have no workspace", async () => {
    const project = (await agent.post("/api/projects", { key: "PLAIN", name: "Plain" })).body.project;
    const workspace = (await agent.get(ws(project.id))).body.workspace;
    expect(workspace.output).toMatchObject({ available: false, outputDir: null });
    expect(workspace.output.reason).toMatch(/without generation/);
    expect((await agent.post(`${ws(project.id)}/repository`, { identity })).status).toBe(409);
  });
});

describe("working tree, history and branches (US-F01, US-F02)", () => {
  it("reports added, modified, deleted and untracked files", async () => {
    const { projectId, dir } = await initialized();
    await writeFile(path.join(dir, "README.txt"), "changed");
    await writeFile(path.join(dir, "notes.txt"), "new");
    await unlink(path.join(dir, ".editorconfig"));
    await git().run(dir, ["add", "--", "notes.txt"]);
    await writeFile(path.join(dir, "scratch.txt"), "untracked");
    const status = (await agent.get(ws(projectId))).body.workspace.state.status;
    expect(status.clean).toBe(false);
    expect(status.entries).toEqual(
      expect.arrayContaining([
        { path: "README.txt", state: "modified", staged: false },
        { path: "notes.txt", state: "added", staged: true },
        { path: ".editorconfig", state: "deleted", staged: false },
        { path: "scratch.txt", state: "untracked", staged: false },
      ]),
    );
  });

  it("creates policy-named branches with warnings and audit, and rejects invalid names", async () => {
    const { projectId } = await initialized();
    const dev = await agent.post(`${ws(projectId)}/branches`, { kind: "integration" });
    expect(dev.status).toBe(201);
    expect(dev.body.branch).toMatchObject({ name: "dev", protected: true, role: "integration" });
    expect(dev.body.warnings.join(" ")).toMatch(/never merged automatically/);

    const feature = await agent.post(`${ws(projectId)}/branches`, {
      kind: "feature",
      topic: "Login-Page",
      switchTo: true,
    });
    expect(feature.status).toBe(201);
    expect(feature.body).toMatchObject({
      branch: { name: "new/login-page", role: "feature", current: true },
      warnings: [],
    });

    for (const topic of ["../escape", "-delete", "a..b", "x.lock", "has space", "x;rm"]) {
      const bad = await agent.post(`${ws(projectId)}/branches`, { kind: "fix", topic });
      expect(bad.status, topic).toBe(400);
    }
    expect((await agent.post(`${ws(projectId)}/branches`, { kind: "feature", topic: "login-page" })).status).toBe(409);
    expect((await agent.post(`${ws(projectId)}/branches`, { kind: "fix", topic: "x", from: "release" })).status).toBe(
      400,
    );

    const workspace = (await agent.get(ws(projectId))).body.workspace;
    expect(workspace.state.head.branch).toBe("new/login-page");
    expect(workspace.state.branches.map((b: { name: string }) => b.name).sort()).toEqual([
      "dev",
      "main",
      "new/login-page",
    ]);
    expect(workspace.warnings).toEqual([]);
    const audits = await h.ctx.prisma.auditEvent.findMany({ where: { action: "repository.branch_create" } });
    expect(audits.map((event) => (event.metadata as { branch: string }).branch).sort()).toEqual([
      "dev",
      "new/login-page",
    ]);
  });

  it("serialises simultaneous branch operations on one repository", async () => {
    const { projectId } = await initialized();
    const same = await Promise.all([
      agent.post(`${ws(projectId)}/branches`, { kind: "fix", topic: "race" }),
      agent.post(`${ws(projectId)}/branches`, { kind: "fix", topic: "race" }),
    ]);
    expect(same.map((response) => response.status).sort()).toEqual([201, 409]);
    const different = await Promise.all(
      ["a", "b", "c"].map((topic) => agent.post(`${ws(projectId)}/branches`, { kind: "test", topic })),
    );
    expect(different.map((response) => response.status)).toEqual([201, 201, 201]);
  });

  it("returns commit history newest first", async () => {
    const { projectId, dir } = await initialized();
    await writeFile(path.join(dir, "CHANGELOG.txt"), "1");
    await git().run(dir, ["add", "--all"]);
    await git().run(dir, ["commit", "--quiet", "-m", "Add changelog"]);
    const commits = (await agent.get(ws(projectId))).body.workspace.state.commits;
    expect(commits.map((commit: { subject: string }) => commit.subject)).toEqual([
      "Add changelog",
      "Initial commit: SHOP generated from starter-web-app@1.0.0",
    ]);
  });
});

describe("repository configuration", () => {
  it("updates identity with optimistic concurrency and validates input", async () => {
    const { projectId, repository } = await initialized();
    const updated = await agent.put(`${ws(projectId)}/repository/identity`, {
      identity: { name: "New Name", email: "NEW@asaa.test" },
      expectedVersion: repository.version,
    });
    expect(updated.status).toBe(200);
    expect(updated.body.repository).toMatchObject({ identity: { email: "new@asaa.test" }, version: 2 });
    const stale = await agent.put(`${ws(projectId)}/repository/identity`, { identity, expectedVersion: 1 });
    expect(stale.status).toBe(409);
    const bad = await agent.put(`${ws(projectId)}/repository/identity`, {
      identity: { name: "Evil <x>", email: "bad" },
      expectedVersion: 2,
    });
    expect(Object.keys(bad.body.error.fields).sort()).toEqual(["identity.email", "identity.name"]);
  });

  it("records remotes without credentials and never contacts them", async () => {
    const { projectId, dir, repository } = await initialized();
    for (const url of [
      "https://user:token@github.com/acme/shop.git",
      "https://token@github.com/acme/shop.git",
      "file:///etc/passwd",
      "ext::sh -c touch% /tmp/pwned",
      "-uhttps://evil",
      "/local/path.git",
    ]) {
      const response = await agent.put(`${ws(projectId)}/repository/remote`, {
        url,
        expectedVersion: repository.version,
      });
      expect(response.status, url).toBe(400);
    }
    const ok = await agent.put(`${ws(projectId)}/repository/remote`, {
      url: "https://github.com/acme/shop.git",
      expectedVersion: repository.version,
    });
    expect(ok.body.repository.remote).toEqual({ name: "origin", url: "https://github.com/acme/shop.git" });
    expect((await git().run(dir, ["remote", "get-url", "origin"])).stdout.trim()).toBe(
      "https://github.com/acme/shop.git",
    );
    const audit = await h.ctx.prisma.auditEvent.findFirst({ where: { action: "repository.remote_update" } });
    expect(audit?.metadata).toEqual({ remote: "github.com" });

    const removed = await agent.put(`${ws(projectId)}/repository/remote`, { url: null, expectedVersion: 2 });
    expect(removed.body.repository.remote).toBeNull();
    expect((await git().run(dir, ["remote"])).stdout.trim()).toBe("");
  });

  it("keeps the production branch protected in the policy", async () => {
    const { projectId, repository } = await initialized();
    const unprotected = await agent.put(`${ws(projectId)}/repository/policy`, {
      policy: { protectedBranches: ["dev"] },
      expectedVersion: repository.version,
    });
    expect(unprotected.status).toBe(400);
    const ok = await agent.put(`${ws(projectId)}/repository/policy`, {
      policy: { protectedBranches: ["main", "dev", "release"], requireReviewFor: ["main"] },
      expectedVersion: repository.version,
    });
    expect(ok.body.repository.policy).toMatchObject({
      protectedBranches: ["main", "dev", "release"],
      requireReviewFor: ["main"],
    });
  });
});

describe("authorization and availability", () => {
  it("rejects anonymous, cross-site, foreign-project and archived operations", async () => {
    const { projectId } = await initialized();
    const anonymous = h.agent();
    expect((await anonymous.get(ws(projectId))).status).toBe(401);
    expect((await anonymous.post(`${ws(projectId)}/branches`, { kind: "integration" })).status).toBe(401);
    expect((await agent.raw.post(`${ws(projectId)}/branches`).send({ kind: "integration" })).status).toBe(403);
    expect((await agent.get(ws("00000000-0000-4000-8000-000000000000"))).status).toBe(404);
    expect((await agent.get(ws("../../etc"))).status).toBe(404);
    const project = await h.ctx.prisma.project.findUniqueOrThrow({ where: { id: projectId } });
    await agent.post(`/api/projects/${projectId}/archive`);
    expect((await agent.post(`${ws(projectId)}/branches`, { kind: "integration" })).status).toBe(409);
    expect(project.archivedAt).toBeNull();
  });

  it("reports a missing Git executable clearly", async () => {
    const generation = await generated();
    const noGit = createHarness({ GENERATION_OUTPUT_DIR: output, GIT_EXECUTABLE: "asaa-missing-git" });
    try {
      const other = await noGit.signedIn();
      const workspace = (await other.get(ws(generation.projectId))).body.workspace;
      expect(workspace.git).toMatchObject({ available: false, version: null });
      const init = await other.post(`${ws(generation.projectId)}/repository`, { identity });
      expect(init.status).toBe(503);
      expect(init.body.error).toMatchObject({ code: "UNAVAILABLE" });
      expect(init.body.error.message).toMatch(/Git is not installed/);
    } finally {
      await noGit.close();
    }
  });
});

describe("environment specification (US-F03)", () => {
  it("infers a spec from the generated project without secret values", async () => {
    const generation = await generated("SVC", "api-service");
    const view = (await agent.get(`${ws(generation.projectId)}/environment`)).body.environment;
    expect(view).toMatchObject({ source: "inferred", version: 0 });
    expect(view.spec.tools.map((tool: { name: string; version: string }) => `${tool.name}@${tool.version}`)).toEqual([
      "node@>=24",
      "npm@>=10",
      "git@>=2.28",
    ]);
    expect(view.spec.commands).toEqual({
      install: ["npm install"],
      dev: ["npm run dev"],
      build: ["npm run build"],
      test: [],
    });
    expect(view.spec.variables).toEqual([
      { name: "PORT", description: "", required: false, secret: false, example: "3000" },
      { name: "NODE_ENV", description: "", required: false, secret: false, example: "development" },
    ]);
  });

  it("saves a validated spec, writes it into the project and rejects secrets", async () => {
    const generation = await generated("SVC", "api-service");
    const base = (await agent.get(`${ws(generation.projectId)}/environment`)).body.environment.spec;
    const secretExample = await agent.put(`${ws(generation.projectId)}/environment`, {
      spec: { ...base, variables: [{ name: "API_TOKEN", secret: true, example: "abc123" }] },
      expectedVersion: 0,
    });
    expect(secretExample.status).toBe(400);
    const unmarked = await agent.put(`${ws(generation.projectId)}/environment`, {
      spec: { ...base, variables: [{ name: "DB_PASSWORD", secret: false }] },
      expectedVersion: 0,
    });
    expect(unmarked.status).toBe(400);
    const credentialUrl = await agent.put(`${ws(generation.projectId)}/environment`, {
      spec: { ...base, variables: [{ name: "DATABASE_URL", example: "postgresql://u:p@localhost/db" }] },
      expectedVersion: 0,
    });
    expect(credentialUrl.status).toBe(400);

    const spec = {
      ...base,
      variables: [
        { name: "PORT", description: "HTTP port", example: "3000" },
        { name: "API_TOKEN", description: "Upstream token", required: true, secret: true },
      ],
      notes: "Run the local database first.",
    };
    const saved = await agent.put(`${ws(generation.projectId)}/environment`, { spec, expectedVersion: 0 });
    expect(saved.status).toBe(200);
    expect(saved.body.environment).toMatchObject({ source: "saved", version: 1 });
    const file = JSON.parse(await readFile(path.join(output, "svc", ".asaa", "environment.json"), "utf8"));
    expect(file.variables[1]).toEqual({
      name: "API_TOKEN",
      description: "Upstream token",
      required: true,
      secret: true,
      example: "",
    });
    expect((await agent.put(`${ws(generation.projectId)}/environment`, { spec, expectedVersion: 0 })).status).toBe(409);
    expect((await agent.put(`${ws(generation.projectId)}/environment`, { spec, expectedVersion: 7 })).status).toBe(409);
  });

  it("checks this machine's tools without installing anything", async () => {
    const generation = await generated("SVC", "api-service");
    const check = await agent.post(`${ws(generation.projectId)}/environment/check`);
    expect(check.status).toBe(200);
    const byName = Object.fromEntries(
      check.body.check.results.map((result: { name: string }) => [result.name, result]),
    );
    expect(byName.node).toMatchObject({ found: true, ok: true, version: process.versions.node });
    expect(byName.git).toMatchObject({ found: true, ok: true });
    expect(byName.npm.found).toBe(true);
    const audit = await h.ctx.prisma.auditEvent.findFirst({ where: { action: "environment.check" } });
    expect(audit?.targetId).toBe(generation.projectId);
  });
});
