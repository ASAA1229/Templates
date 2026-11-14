import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { hashPassword } from "../src/lib/password.js";
import { isAllowed, PERMISSIONS, type Permission } from "../src/modules/auth/policy.js";
import { createHarness } from "./helpers.js";

/**
 * RG-01: route inventory + role matrix. Proves no IDOR / cross-project leakage for the
 * project owner, EDITOR, VIEWER, unrelated users of every account role (including the platform
 * OWNER and ADMIN), suspended accounts and revoked members.
 */

const PASSWORD = "a sufficiently long test password";
const MARK = "ZXQMARKER";
let base: string;
let h: ReturnType<typeof createHarness>;

beforeAll(async () => {
  base = await mkdtemp(path.join(tmpdir(), "asaa-authz-"));
  h = createHarness({ GENERATION_OUTPUT_DIR: path.join(base, "output") });
});
afterAll(async () => {
  await h.close();
  await rm(base, { recursive: true, force: true, maxRetries: 8, retryDelay: 250 });
});

type AccountRole = "ADMIN" | "DEVELOPER" | "TESTER" | "EMPLOYEE";

async function account(email: string, role: AccountRole) {
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

async function login(email: string, password = PASSWORD) {
  const agent = h.agent();
  const response = await agent.post("/api/auth/login", { email, password });
  if (response.status !== 200) throw new Error(`login failed for ${email}: ${response.status}`);
  return agent;
}

type Agent = ReturnType<typeof h.agent>;
type Actor =
  | "anonymous"
  | "projectOwner"
  | "editor"
  | "viewer"
  | "unrelatedEmployee"
  | "unrelatedAdmin"
  | "platformOwner"
  | "suspended"
  | "revoked";
const ACTORS: Actor[] = [
  "anonymous",
  "projectOwner",
  "editor",
  "viewer",
  "unrelatedEmployee",
  "unrelatedAdmin",
  "platformOwner",
  "suspended",
  "revoked",
];

interface World {
  agents: Record<Actor, Agent>;
  projectId: string;
  requirementId: string;
  generationId: string;
  revokedId: string;
}
let world: World;

async function buildWorld(): Promise<World> {
  await h.reset();
  const platformOwner = await h.createOwner();
  void platformOwner;
  const po = await account("po@asaa.test", "EMPLOYEE");
  void po;
  const editor = await account("editor@asaa.test", "DEVELOPER");
  const viewer = await account("viewer@asaa.test", "TESTER");
  await account("stranger@asaa.test", "EMPLOYEE");
  await account("admin2@asaa.test", "ADMIN");
  const suspended = await account("suspended@asaa.test", "EMPLOYEE");
  const revoked = await account("revoked@asaa.test", "EMPLOYEE");

  const poAgent = await login("po@asaa.test");
  const generated = await poAgent.post("/api/generations", {
    mode: "SCRATCH",
    projectType: "web-app",
    project: { key: "MATRIX", name: `${MARK} project`, purpose: `${MARK} purpose` },
    inputs: {},
    requirements: [`${MARK} requirement`],
  });
  expect(generated.status).toBe(201);
  const projectId = generated.body.generation.projectId as string;
  const generationId = generated.body.generation.id as string;
  for (const [member, role] of [
    [editor, "EDITOR"],
    [viewer, "VIEWER"],
    [suspended, "EDITOR"],
    [revoked, "EDITOR"],
  ] as const) {
    expect((await poAgent.post(`/api/projects/${projectId}/members`, { email: member.email, role })).status).toBe(200);
  }
  const requirements = await poAgent.get(`/api/projects/${projectId}/requirements`);
  const requirementId = requirements.body.requirements[0].id as string;

  const agents = {
    anonymous: h.agent(),
    projectOwner: poAgent,
    editor: await login("editor@asaa.test"),
    viewer: await login("viewer@asaa.test"),
    unrelatedEmployee: await login("stranger@asaa.test"),
    unrelatedAdmin: await login("admin2@asaa.test"),
    platformOwner: await h.signedIn(),
    suspended: await login("suspended@asaa.test"),
    revoked: await login("revoked@asaa.test"),
  } satisfies Record<Actor, Agent>;

  // Suspend an account after it already holds a live session; remove the revoked member's access.
  await h.ctx.prisma.owner.update({ where: { id: suspended.id }, data: { isActive: false } });
  expect((await poAgent.delete(`/api/projects/${projectId}/members/${revoked.id}`)).status).toBe(204);
  return { agents, projectId, requirementId, generationId, revokedId: revoked.id };
}

type Min = "read" | "write" | "owner";
interface Endpoint {
  name: string;
  method: "get" | "post" | "put" | "patch" | "delete";
  url: (w: World) => string;
  body?: (w: World) => object;
  min: Min;
}
const P = (w: World) => `/api/projects/${w.projectId}`;
const ENDPOINTS: Endpoint[] = [
  { name: "project read", method: "get", url: (w) => P(w), min: "read" },
  {
    name: "project update",
    method: "patch",
    url: (w) => P(w),
    body: () => ({ expectedVersion: 99, name: "x" }),
    min: "write",
  },
  { name: "members list", method: "get", url: (w) => `${P(w)}/members`, min: "owner" },
  {
    name: "members add",
    method: "post",
    url: (w) => `${P(w)}/members`,
    body: () => ({ email: "nobody@asaa.test" }),
    min: "owner",
  },
  { name: "members remove", method: "delete", url: (w) => `${P(w)}/members/${w.revokedId}`, min: "owner" },
  { name: "requirements list", method: "get", url: (w) => `${P(w)}/requirements`, min: "read" },
  { name: "requirement read", method: "get", url: (w) => `${P(w)}/requirements/${w.requirementId}`, min: "read" },
  {
    name: "requirement create (invalid)",
    method: "post",
    url: (w) => `${P(w)}/requirements`,
    body: () => ({}),
    min: "write",
  },
  {
    name: "requirement update (invalid)",
    method: "patch",
    url: (w) => `${P(w)}/requirements/${w.requirementId}`,
    body: () => ({}),
    min: "write",
  },
  {
    name: "requirement flag (invalid)",
    method: "post",
    url: (w) => `${P(w)}/requirements/${w.requirementId}/flag`,
    body: () => ({}),
    min: "write",
  },
  {
    name: "requirement link (invalid)",
    method: "post",
    url: (w) => `${P(w)}/requirements/${w.requirementId}/links`,
    body: () => ({}),
    min: "write",
  },
  { name: "workspace overview", method: "get", url: (w) => `${P(w)}/workspace`, min: "read" },
  { name: "workspace environment read", method: "get", url: (w) => `${P(w)}/workspace/environment`, min: "read" },
  {
    name: "workspace environment check",
    method: "post",
    url: (w) => `${P(w)}/workspace/environment/check`,
    min: "read",
  },
  {
    name: "workspace environment save (invalid)",
    method: "put",
    url: (w) => `${P(w)}/workspace/environment`,
    body: () => ({}),
    min: "write",
  },
  {
    name: "workspace remote (invalid)",
    method: "put",
    url: (w) => `${P(w)}/workspace/repository/remote`,
    body: () => ({}),
    min: "write",
  },
  {
    name: "workspace identity (invalid)",
    method: "put",
    url: (w) => `${P(w)}/workspace/repository/identity`,
    body: () => ({}),
    min: "write",
  },
  {
    name: "workspace policy (invalid)",
    method: "put",
    url: (w) => `${P(w)}/workspace/repository/policy`,
    body: () => ({}),
    min: "write",
  },
  {
    name: "workspace branch (invalid)",
    method: "post",
    url: (w) => `${P(w)}/workspace/branches`,
    body: () => ({}),
    min: "write",
  },
  {
    name: "workspace init repo (invalid)",
    method: "post",
    url: (w) => `${P(w)}/workspace/repository`,
    body: () => ({ expectedVersion: -5 }),
    min: "write",
  },
  {
    name: "workspace file tree",
    method: "get",
    url: (w) => `${P(w)}/workspace/files/tree`,
    min: "read",
  },
  {
    name: "workspace file content",
    method: "get",
    url: (w) => `${P(w)}/workspace/files/content?path=package.json`,
    min: "read",
  },
  {
    name: "workspace file save (invalid)",
    method: "put",
    url: (w) => `${P(w)}/workspace/files/content`,
    body: () => ({}),
    min: "write",
  },
  { name: "workspace diff", method: "get", url: (w) => `${P(w)}/workspace/diff`, min: "read" },
  { name: "workspace history", method: "get", url: (w) => `${P(w)}/workspace/history`, min: "read" },
  {
    name: "workspace commit detail",
    method: "get",
    url: (w) => `${P(w)}/workspace/commits/${"a".repeat(40)}`,
    min: "read",
  },
  {
    name: "workspace commit (invalid)",
    method: "post",
    url: (w) => `${P(w)}/workspace/commits`,
    body: () => ({}),
    min: "write",
  },
  { name: "jobs list", method: "get", url: (w) => `${P(w)}/jobs`, min: "read" },
  {
    name: "job read",
    method: "get",
    url: (w) => `${P(w)}/jobs/${"b".repeat(8)}-bbbb-4bbb-8bbb-${"b".repeat(12)}`,
    min: "read",
  },
  {
    name: "job logs",
    method: "get",
    url: (w) => `${P(w)}/jobs/${"b".repeat(8)}-bbbb-4bbb-8bbb-${"b".repeat(12)}/logs`,
    min: "read",
  },
  { name: "job submit (invalid)", method: "post", url: (w) => `${P(w)}/jobs`, body: () => ({}), min: "write" },
  {
    name: "job cancel (unknown job)",
    method: "post",
    url: (w) => `${P(w)}/jobs/${"b".repeat(8)}-bbbb-4bbb-8bbb-${"b".repeat(12)}/cancel`,
    min: "write",
  },
  {
    name: "template submission (invalid)",
    method: "post",
    url: (w) => `${P(w)}/template-submissions`,
    body: () => ({}),
    min: "owner",
  },
  { name: "generation read", method: "get", url: (w) => `/api/generations/${w.generationId}`, min: "read" },
  { name: "generation verify", method: "post", url: (w) => `/api/generations/${w.generationId}/verify`, min: "read" },
  {
    name: "generation update preview",
    method: "get",
    url: (w) => `/api/generations/${w.generationId}/update-preview?toVersion=9.9.9`,
    min: "read",
  },
  {
    name: "generation update apply",
    method: "post",
    url: (w) => `/api/generations/${w.generationId}/update`,
    body: () => ({ toVersion: "9.9.9" }),
    min: "write",
  },
  {
    name: "generation export",
    method: "get",
    url: (w) => `/api/generations/${w.generationId}/export`,
    min: "read",
  },
  {
    name: "generation retry (invalid)",
    method: "post",
    url: (w) => `/api/generations/${w.generationId}/retry`,
    body: () => ({}),
    min: "write",
  },
];

const ALLOWED: Record<Min, Actor[]> = {
  read: ["projectOwner", "editor", "viewer"],
  write: ["projectOwner", "editor"],
  owner: ["projectOwner"],
};

beforeAll(async () => {
  world = await buildWorld();
});
beforeEach(() => undefined);

async function call(actor: Actor, endpoint: Endpoint) {
  const agent = world.agents[actor];
  const url = endpoint.url(world);
  switch (endpoint.method) {
    case "get":
      return agent.get(url);
    case "delete":
      return agent.delete(url);
    default:
      return agent[endpoint.method](url, endpoint.body?.(world));
  }
}

describe("RG-01 project resource role matrix", () => {
  for (const endpoint of ENDPOINTS) {
    it(`${endpoint.name} (${endpoint.method.toUpperCase()}, needs ${endpoint.min})`, async () => {
      for (const actor of ACTORS) {
        // Mutating "allowed" calls use invalid bodies so they never change shared state.
        const response = await call(actor, endpoint);
        const text = JSON.stringify(response.body);
        if (ALLOWED[endpoint.min].includes(actor)) {
          const projectBoundary =
            response.status === 404 && /^Project not found/.test(response.body?.error?.message ?? "");
          expect(
            [401, 403].includes(response.status) || projectBoundary,
            `${actor} must pass the boundary: ${text}`,
          ).toBe(false);
        } else {
          // Denied callers get 401 (no/invalid session) or 403/404 (permission or hidden resource); never validation or data.
          const expected = actor === "anonymous" || actor === "suspended" ? [401] : [403, 404];
          expect(expected, `${actor} -> ${endpoint.name}: ${response.status} ${text}`).toContain(response.status);
          expect(text, `${actor} must not receive project data`).not.toContain(MARK);
        }
      }
    });
  }

  it("lists, searches and summarises only accessible data for each actor", async () => {
    const visible = new Set<Actor>(["projectOwner", "editor", "viewer"]);
    for (const actor of ACTORS) {
      if (actor === "anonymous" || actor === "suspended") continue;
      const agent = world.agents[actor];
      for (const url of [
        "/api/projects",
        `/api/projects?q=${MARK}`,
        `/api/search?q=${MARK}`,
        "/api/dashboard",
        "/api/generations",
        `/api/generations?projectId=${world.projectId}`,
        "/api/search/saved",
      ]) {
        const response = await agent.get(url);
        expect(response.status, `${actor} ${url}`).toBeLessThan(500);
        // Search echoes the query itself; only its results can leak.
        const text = JSON.stringify(response.body.results ?? response.body);
        if (visible.has(actor)) continue;
        expect(text, `${actor} ${url} leaked project data`).not.toContain(MARK);
        expect(text, `${actor} ${url} leaked project id`).not.toContain(world.projectId);
      }
    }
    // Sanity: authorized members do see it.
    const owner = await world.agents.viewer.get("/api/projects");
    expect(JSON.stringify(owner.body)).toContain(world.projectId);
  });

  it("does not let an unrelated actor cross projects via forged identifiers", async () => {
    const stranger = world.agents.unrelatedEmployee;
    const other = await stranger.post("/api/projects", { key: "OTHER", name: "Other project" });
    expect(other.status).toBe(201);
    const otherId = other.body.project.id as string;
    // A requirement of project A addressed through project B's URL must not resolve.
    const cross = await stranger.get(`/api/projects/${otherId}/requirements/${world.requirementId}`);
    expect(cross.status).toBe(404);
    expect(JSON.stringify(cross.body)).not.toContain(MARK);
    // Saved searches belong to their creator.
    const saved = await stranger.post("/api/search/saved", { name: "mine", query: "xx" });
    expect(saved.status).toBe(201);
    const savedId = saved.body.search.id as string;
    {
      expect((await world.agents.editor.delete(`/api/search/saved/${savedId}`)).status).toBe(404);
      expect(
        (await world.agents.editor.patch(`/api/search/saved/${savedId}`, { name: "hijack", query: "xx" })).status,
      ).toBe(404);
    }
  });

  it("revoked and suspended sessions stay dead and the suspended account cannot sign in again", async () => {
    const retry = await h.agent().post("/api/auth/login", { email: "suspended@asaa.test", password: PASSWORD });
    expect(retry.status).toBe(401);
    expect((await world.agents.revoked.get(`/api/projects/${world.projectId}`)).status).toBe(404);
  });
});

describe("RG-01 account-role permission matrix", () => {
  const SAMPLES: { permission: Permission; method: "get" | "post"; url: string; body?: object }[] = [
    { permission: "catalog:write", method: "post", url: "/api/catalog", body: {} },
    { permission: "template:approve", method: "post", url: "/api/templates/library/nope/1.0.0/approve" },
    { permission: "template:review", method: "get", url: "/api/projects/template-submissions" },
    { permission: "audit:read", method: "get", url: "/api/audit" },
    { permission: "identity:manage", method: "get", url: "/api/auth/members" },
    { permission: "identity:manage", method: "get", url: "/api/auth/access-requests" },
    { permission: "identity:manage", method: "post", url: "/api/auth/password-reset/issue", body: {} },
    { permission: "generation:write", method: "post", url: "/api/generations/preview", body: {} },
    { permission: "project:write", method: "post", url: "/api/projects", body: {} },
  ];

  it("enforces every sampled permission per account role on the server", async () => {
    const agents: Record<string, Agent> = {
      OWNER: world.agents.platformOwner,
      ADMIN: world.agents.unrelatedAdmin,
      DEVELOPER: world.agents.editor,
      TESTER: world.agents.viewer,
      EMPLOYEE: world.agents.unrelatedEmployee,
    };
    for (const [role, agent] of Object.entries(agents)) {
      for (const sample of SAMPLES) {
        const response =
          sample.method === "get" ? await agent.get(sample.url) : await agent.post(sample.url, sample.body);
        const allowed = isAllowed({ id: "x", email: "x", displayName: "x", role: role as "OWNER" }, sample.permission);
        if (allowed) expect(response.status, `${role} ${sample.url}`).not.toBe(403);
        else expect(response.status, `${role} ${sample.url}`).toBe(403);
      }
    }
  });

  it("only OWNER holds session:manage and every role has a defined permission set", () => {
    const roles = ["OWNER", "ADMIN", "DEVELOPER", "TESTER", "EMPLOYEE"] as const;
    for (const role of roles) {
      expect(
        PERMISSIONS.some((permission) => isAllowed({ id: "x", email: "x", displayName: "x", role }, permission)),
      ).toBe(true);
    }
    expect(isAllowed({ id: "x", email: "x", displayName: "x", role: "ADMIN" }, "session:manage")).toBe(false);
    expect(isAllowed({ id: "x", email: "x", displayName: "x", role: "EMPLOYEE" }, "identity:manage")).toBe(false);
  });
});

describe("RG-01 route inventory", () => {
  /** Routes deliberately reachable without a session; everything else must require one. */
  const PUBLIC = new Set([
    "GET /api/health",
    "POST /api/auth/login",
    "POST /api/auth/logout",
    "POST /api/auth/access-requests",
    "POST /api/auth/access-requests/activate",
    "POST /api/auth/password-reset/consume",
  ]);

  async function sourceRoutes(): Promise<string[]> {
    const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../src/modules");
    const files: string[] = [];
    const walk = async (dir: string) => {
      for (const entry of await readdir(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) await walk(full);
        else if (entry.name.endsWith(".ts") && !entry.name.endsWith(".test.ts")) files.push(full);
      }
    };
    await walk(root);
    const routes: string[] = [];
    for (const file of files) {
      const source = await readFile(file, "utf8");
      for (const match of source.matchAll(/router\s*\.\s*(get|post|put|patch|delete)\(\s*"([^"]*)"/g)) {
        routes.push(`${path.basename(file)} ${match[1]!.toUpperCase()} ${match[2]}`);
      }
    }
    return routes.sort();
  }

  it("keeps the documented route inventory in sync with the source", async () => {
    const found = await sourceRoutes();
    // Updating this count is a deliberate review point: every new route needs a matrix entry
    // (or an explicit PUBLIC entry) and a permission via authorize()/requireOwner().
    expect(found.length).toBeGreaterThanOrEqual(70);
    for (const route of found) expect(route).toMatch(/^[\w.-]+ (GET|POST|PUT|PATCH|DELETE) \//);
  });

  it("requires authentication for every non-public route (anonymous never reaches a handler)", async () => {
    const anonymous = h.agent();
    const probes: [string, string][] = [
      ["get", "/api/projects"],
      ["post", "/api/projects"],
      ["get", "/api/catalog"],
      ["post", "/api/catalog"],
      ["get", "/api/dashboard"],
      ["get", "/api/audit"],
      ["get", "/api/search"],
      ["get", "/api/search/saved"],
      ["get", "/api/templates/library"],
      ["get", "/api/templates/options"],
      ["get", "/api/generations"],
      ["post", "/api/generations"],
      ["post", "/api/generations/preview"],
      ["get", "/api/auth/members"],
      ["get", "/api/auth/access-requests"],
      ["get", "/api/auth/session"],
      ["get", "/api/auth/sessions"],
      ["post", "/api/auth/password"],
      ["post", "/api/auth/password-reset/issue"],
      ["get", "/api/projects/template-submissions"],
    ];
    for (const [method, url] of probes) {
      const response = method === "get" ? await anonymous.get(url) : await anonymous.post(url, {});
      expect(response.status, `${method} ${url}`).toBe(401);
    }
    expect([...PUBLIC].length).toBeGreaterThan(0);
  });
});
