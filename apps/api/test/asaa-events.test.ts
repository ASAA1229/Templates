import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createServer, type IncomingMessage, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { loadConfig } from "../src/config/env.js";
import { classifyStatus, eventFromAudit, eventsEndpoint } from "../src/modules/integration/events.js";
import { hashPassword } from "../src/lib/password.js";
import { createHarness, OWNER_PASSWORD } from "./helpers.js";

/**
 * ASAA event producer tests. The ASAA ingest endpoint and the Keycloak token endpoint are MOCKED
 * local HTTP servers; nothing here talks to a real ASAA or Keycloak instance.
 */
const contractsDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../contracts/asaa-ecosystem/v1");
const envelopeSchema = z.fromJSONSchema(
  JSON.parse(readFileSync(path.join(contractsDir, "event-envelope.schema.json"), "utf8")),
);
const manifestSchema = z.fromJSONSchema(
  JSON.parse(readFileSync(path.join(contractsDir, "service-manifest.schema.json"), "utf8")),
);

const CLIENT_SECRET = "mock-client-secret-do-not-leak";
const STATIC_TOKEN = "mock-static-token-do-not-leak";

interface Received {
  url: string;
  authorization: string | undefined;
  requestId: string | string[] | undefined;
  body: Record<string, unknown>;
}
let received: Received[] = [];
let ingestStatuses: number[] = [];
let tokenRequests: string[] = [];
let tokenCounter = 0;
let rejectToken: string | null = null;
let redirectIngestTo: string | null = null;
let redirectTokenTo: string | null = null;
let trap: Server;
let trapHits: { url: string; authorization: string | undefined; body: string }[] = [];
let trapUrl: string;
let asaa: Server;
let keycloak: Server;
let asaaUrl: string;
let tokenUrl: string;

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString("utf8");
}

beforeAll(async () => {
  asaa = createServer((req, res) => {
    void readBody(req).then((raw) => {
      const authorization = req.headers.authorization;
      received.push({
        url: req.url ?? "",
        authorization,
        requestId: req.headers["x-request-id"],
        body: JSON.parse(raw) as Record<string, unknown>,
      });
      if (redirectIngestTo) return void res.writeHead(302, { location: redirectIngestTo }).end();
      const status = authorization === `Bearer ${rejectToken}` ? 401 : (ingestStatuses.shift() ?? 202);
      res.writeHead(status, { "content-type": "application/json" }).end("{}");
    });
  });
  keycloak = createServer((req, res) => {
    void readBody(req).then((raw) => {
      tokenRequests.push(raw);
      if (redirectTokenTo) return void res.writeHead(307, { location: redirectTokenTo }).end();
      tokenCounter += 1;
      res
        .writeHead(200, { "content-type": "application/json" })
        .end(JSON.stringify({ access_token: `mock-access-token-${tokenCounter}`, expires_in: 300 }));
    });
  });
  trap = createServer((req, res) => {
    void readBody(req).then((body) => {
      trapHits.push({ url: req.url ?? "", authorization: req.headers.authorization, body });
      res.writeHead(200, { "content-type": "application/json" }).end("{}");
    });
  });
  await Promise.all([
    new Promise<void>((resolve) => trap.listen(0, "127.0.0.1", resolve)),
    new Promise<void>((resolve) => asaa.listen(0, "127.0.0.1", resolve)),
    new Promise<void>((resolve) => keycloak.listen(0, "127.0.0.1", resolve)),
  ]);
  asaaUrl = `http://127.0.0.1:${(asaa.address() as AddressInfo).port}`;
  tokenUrl = `http://127.0.0.1:${(keycloak.address() as AddressInfo).port}/token`;
  trapUrl = `http://127.0.0.1:${(trap.address() as AddressInfo).port}/trap`;
});
afterAll(async () => {
  await Promise.all([
    new Promise((resolve) => asaa.close(resolve)),
    new Promise((resolve) => keycloak.close(resolve)),
    new Promise((resolve) => trap.close(resolve)),
  ]);
});
beforeEach(() => {
  received = [];
  ingestStatuses = [];
  tokenRequests = [];
  tokenCounter = 0;
  rejectToken = null;
  redirectIngestTo = null;
  redirectTokenTo = null;
  trapHits = [];
});

const credentialsEnv = () => ({
  ASAA_EVENTS_URL: asaaUrl,
  ASAA_ORG_ID: "asaa",
  ASAA_EVENTS_TOKEN_URL: tokenUrl,
  ASAA_EVENTS_CLIENT_SECRET: CLIENT_SECRET,
});
const staticEnv = () => ({ ASAA_EVENTS_URL: asaaUrl, ASAA_ORG_ID: "asaa", ASAA_EVENTS_TOKEN: STATIC_TOKEN });

async function outbox(h: ReturnType<typeof createHarness>) {
  return h.ctx.prisma.asaaEventOutbox.findMany({ orderBy: { createdAt: "asc" } });
}

describe("configuration gating", () => {
  const base = { DATABASE_URL: "postgresql://u:p@localhost/db" };

  it("is disabled by default and when configuration is partial", async () => {
    const h = createHarness();
    expect(h.ctx.events?.isEnabled).toBe(false);
    expect(await h.ctx.events?.record({ type: "templates.job.completed", data: {} })).toBeNull();
    await h.close();
    const partial = createHarness({ ASAA_EVENTS_URL: asaaUrl, ASAA_ORG_ID: "asaa" });
    expect(partial.ctx.events?.isEnabled).toBe(false);
    await partial.close();
    const noOrg = createHarness({ ASAA_EVENTS_URL: asaaUrl, ASAA_EVENTS_TOKEN: STATIC_TOKEN });
    expect(noOrg.ctx.events?.isEnabled).toBe(false);
    await noOrg.close();
  });

  it("requires HTTPS unless the endpoint is loopback", () => {
    expect(() => loadConfig({ ...base, ASAA_EVENTS_URL: "http://asaa.example.com" })).toThrow(/HTTPS/);
    expect(() =>
      loadConfig({
        ...base,
        ASAA_EVENTS_URL: "https://asaa.example.com",
        ASAA_EVENTS_TOKEN_URL: "http://kc.example.com/t",
      }),
    ).toThrow(/ASAA_EVENTS_TOKEN_URL/);
    expect(loadConfig({ ...base, ASAA_EVENTS_URL: "http://[::1]:8001" }).ASAA_EVENTS_URL).toBe("http://[::1]:8001");
    expect(loadConfig({ ...base, ASAA_EVENTS_URL: "https://asaa.example.com" }).ASAA_EVENTS_CLIENT_ID).toBe(
      "templates-events",
    );
    expect(loadConfig({ ...base, ASAA_EVENTS_URL: "" }).ASAA_EVENTS_URL).toBeUndefined();
  });

  it("appends the contract path to an origin and keeps an explicit path", () => {
    expect(eventsEndpoint("https://asaa.example.com")).toBe("https://asaa.example.com/api/v1/integration/events");
    expect(eventsEndpoint("https://asaa.example.com/custom/in")).toBe("https://asaa.example.com/custom/in");
  });
});

describe("event mapping", () => {
  it("builds allow-listed payloads that exclude notes, errors, paths and content", () => {
    const generation = eventFromAudit(
      {
        action: "generation.complete",
        outcome: "SUCCESS",
        targetType: "project",
        targetId: "p-1",
        metadata: {
          generationId: "g-1",
          mode: "SCRATCH",
          templateId: "web-app",
          templateVersion: "1.0.0",
          outputDigest: "abc",
          files: 12,
          error: "C:\\secret\\path",
        },
      },
      null,
    );
    expect(generation?.type).toBe("templates.generation.completed");
    expect(Object.keys(generation!.data).sort()).toEqual(
      ["actorSub", "fileCount", "generationId", "mode", "outcome", "projectId", "templateId", "templateVersion"].sort(),
    );
    const failed = eventFromAudit(
      {
        action: "generation.complete",
        outcome: "FAILURE",
        targetId: "p-1",
        metadata: { generationId: "g-1", error: "/etc/passwd leaked", attempt: 2 },
      },
      null,
    );
    expect(failed?.type).toBe("templates.generation.failed");
    expect(JSON.stringify(failed)).not.toContain("passwd");

    const deprecated = eventFromAudit(
      {
        action: "template.release.deprecate",
        outcome: "SUCCESS",
        targetId: "r-1",
        metadata: { templateId: "web-app", version: "1.0.0", reason: "free text note" },
      },
      null,
    );
    expect(deprecated?.type).toBe("templates.release.deprecated");
    expect(JSON.stringify(deprecated)).not.toContain("free text");
    const types = ["submit", "approve", "release"].map(
      (step) => eventFromAudit({ action: `template.release.${step}`, outcome: "SUCCESS", targetId: "r-1" }, null)?.type,
    );
    expect(types).toEqual(["templates.release.submitted", "templates.release.approved", "templates.release.released"]);

    const job = eventFromAudit(
      {
        action: "job.finish",
        outcome: "FAILURE",
        targetId: "j-1",
        metadata: {
          projectId: "p-1",
          requestedById: "u-1",
          task: "test",
          status: "FAILED",
          exitCode: 1,
          durationMs: 5,
        },
      },
      null,
    );
    expect(job).toMatchObject({ type: "templates.job.failed", data: { jobId: "j-1", actorSub: "u-1", exitCode: 1 } });
    expect(eventFromAudit({ action: "catalog.content_approve", outcome: "SUCCESS" }, null)).toBeNull();
    expect(eventFromAudit({ action: "authz.denied", outcome: "DENIED" }, null)).toBeNull();
  });

  it("classifies delivery statuses", () => {
    for (const status of [200, 202, 204, 409]) expect(classifyStatus(status)).toBe("delivered");
    for (const status of [408, 429, 500, 502, 503]) expect(classifyStatus(status)).toBe("retry");
    for (const status of [400, 401, 403, 404, 413, 422]) expect(classifyStatus(status)).toBe("dead");
  });
});

describe("outbox and delivery (mocked ASAA)", () => {
  it("records generation events through the audit path and delivers valid envelopes", async () => {
    const scratch = mkdtempSync(path.join(tmpdir(), "asaa-events-"));
    const h = createHarness({ ...staticEnv(), GENERATION_OUTPUT_DIR: path.join(scratch, "out") });
    try {
      await h.reset();
      await h.createOwner();
      const agent = await h.signedIn();
      const response = await agent.post("/api/generations", {
        mode: "SCRATCH",
        projectType: "web-app",
        project: { key: "EVT", name: "Events app", purpose: "Event producer test" },
        inputs: {},
      });
      expect(response.status).toBe(201);
      // The audit hook records asynchronously; wait for the outbox row.
      let rows = await outbox(h);
      for (let i = 0; i < 40 && rows.length === 0; i += 1) {
        await new Promise((resolve) => setTimeout(resolve, 50));
        rows = await outbox(h);
      }
      expect(rows.map((row) => row.type)).toContain("templates.generation.completed");
      expect(await h.ctx.events!.deliverDue()).toBe(rows.length);
      expect(received.length).toBe(rows.length);
      for (const item of received) {
        expect(item.url).toBe("/api/v1/integration/events");
        expect(item.authorization).toBe(`Bearer ${STATIC_TOKEN}`);
        const parsed = envelopeSchema.safeParse(item.body);
        expect(parsed.success, JSON.stringify(parsed.error?.issues)).toBe(true);
        expect(item.body).toMatchObject({
          specversion: "asaa.event.v1",
          source: "templates",
          project: "TEMPLATES",
          orgId: "asaa",
        });
      }
      const stored = JSON.stringify(await outbox(h));
      expect(stored).not.toContain(STATIC_TOKEN);
      expect(stored).not.toContain(scratch);
      expect((await outbox(h)).every((row) => row.status === "DELIVERED" && row.deliveredAt)).toBe(true);
    } finally {
      await h.close();
      rmSync(scratch, { recursive: true, force: true, maxRetries: 8, retryDelay: 250 });
    }
  });

  it("treats 409 as delivered, retries 408/429/5xx with exponential backoff, and dead-letters other 4xx", async () => {
    const h = createHarness(staticEnv());
    try {
      await h.reset();
      const events = h.ctx.events!;
      const record = () =>
        events.record({ type: "templates.job.completed", subject: "job/1", data: { outcome: "success", jobId: "1" } });
      const conflictId = (await record())!;
      ingestStatuses = [409];
      expect(await events.deliverDue()).toBe(1);
      expect((await h.ctx.prisma.asaaEventOutbox.findUnique({ where: { id: conflictId } }))?.status).toBe("DELIVERED");

      const retryId = (await record())!;
      ingestStatuses = [503, 429];
      expect(await events.deliverDue()).toBe(0);
      const first = (await h.ctx.prisma.asaaEventOutbox.findUnique({ where: { id: retryId } }))!;
      expect(first).toMatchObject({ status: "PENDING", attempts: 1, lastError: "status 503" });
      const firstDelay = first.nextAttemptAt.getTime() - h.clock.now.getTime();
      // Not due yet: nothing is sent until the backoff has elapsed.
      const before = received.length;
      expect(await events.deliverDue()).toBe(0);
      expect(received.length).toBe(before);
      h.clock.now = new Date(h.clock.now.getTime() + firstDelay + 1);
      expect(await events.deliverDue()).toBe(0);
      const second = (await h.ctx.prisma.asaaEventOutbox.findUnique({ where: { id: retryId } }))!;
      expect(second).toMatchObject({ status: "PENDING", attempts: 2, lastError: "status 429" });
      const secondDelay = second.nextAttemptAt.getTime() - h.clock.now.getTime();
      expect(secondDelay).toBe(firstDelay * 2);
      expect(events.manifestStatus()).toBe("degraded");
      h.clock.now = new Date(h.clock.now.getTime() + secondDelay + 1);
      expect(await events.deliverDue()).toBe(1);
      expect((await h.ctx.prisma.asaaEventOutbox.findUnique({ where: { id: retryId } }))?.status).toBe("DELIVERED");
      expect(events.manifestStatus()).toBe("ok");

      const deadId = (await record())!;
      ingestStatuses = [422];
      expect(await events.deliverDue()).toBe(0);
      expect(await h.ctx.prisma.asaaEventOutbox.findUnique({ where: { id: deadId } })).toMatchObject({
        status: "DEAD",
        attempts: 1,
        lastError: "status 422",
      });
      // Dead letters are never re-sent.
      const sent = received.length;
      h.clock.now = new Date(h.clock.now.getTime() + 24 * 3600_000);
      await events.deliverDue();
      expect(received.length).toBe(sent);
    } finally {
      await h.close();
    }
  });

  it("retries network failures without losing the event, and sends the same id on redelivery", async () => {
    const dead = createServer();
    await new Promise<void>((resolve) => dead.listen(0, "127.0.0.1", resolve));
    const closedPort = (dead.address() as AddressInfo).port;
    await new Promise((resolve) => dead.close(resolve));
    const h = createHarness({
      ASAA_EVENTS_URL: `http://127.0.0.1:${closedPort}`,
      ASAA_ORG_ID: "asaa",
      ASAA_EVENTS_TOKEN: STATIC_TOKEN,
    });
    try {
      await h.reset();
      const id = (await h.ctx.events!.record({ type: "templates.job.failed", data: { outcome: "failure" } }))!;
      expect(await h.ctx.events!.deliverDue()).toBe(0);
      const row = (await h.ctx.prisma.asaaEventOutbox.findUnique({ where: { id } }))!;
      expect(row.status).toBe("PENDING");
      expect(row.attempts).toBe(1);
      expect(row.lastError).toBeTruthy();
      expect(JSON.stringify(row)).not.toContain(STATIC_TOKEN);
      expect((row.envelope as { id: string }).id).toBe(id);
    } finally {
      await h.close();
    }
  });

  it("enforces a unique envelope id in the outbox", async () => {
    const h = createHarness(staticEnv());
    try {
      await h.reset();
      const id = (await h.ctx.events!.record({ type: "templates.job.completed", data: {} }))!;
      await expect(
        h.ctx.prisma.asaaEventOutbox.create({ data: { id, type: "templates.job.completed", envelope: {} } }),
      ).rejects.toThrow();
    } finally {
      await h.close();
    }
  });

  it("aggregates access denials into one event per window", async () => {
    const h = createHarness(staticEnv());
    try {
      await h.reset();
      const events = h.ctx.events!;
      for (let i = 0; i < 4; i += 1) events.noteAccessDenied("template:approve");
      events.noteAccessDenied("job:write");
      await events.flushAccessDenied(); // window not elapsed yet
      expect(await outbox(h)).toHaveLength(0);
      await events.flushAccessDenied(true);
      const rows = await outbox(h);
      expect(rows).toHaveLength(1);
      const envelope = rows[0]!.envelope as { type: string; severity: string; data: Record<string, unknown> };
      expect(envelope.type).toBe("templates.security.access-denied");
      expect(envelope.severity).toBe("warning");
      expect(envelope.data).toMatchObject({ count: 5, byPermission: { "template:approve": 4, "job:write": 1 } });
      expect(envelopeSchema.safeParse(rows[0]!.envelope).success).toBe(true);
      await events.flushAccessDenied(true);
      expect(await outbox(h)).toHaveLength(1);
    } finally {
      await h.close();
    }
  });

  it("turns repeated real authorisation denials into one aggregate event", async () => {
    const h = createHarness(staticEnv());
    try {
      await h.reset();
      await h.createOwner();
      await h.ctx.prisma.owner.create({
        data: {
          email: "employee@asaa.test",
          displayName: "employee",
          role: "EMPLOYEE",
          passwordHash: await hashPassword(OWNER_PASSWORD),
          passwordChangedAt: new Date(h.clock.now.getTime() - 1000),
          createdAt: new Date(h.clock.now.getTime() - 1000),
        },
      });
      const employee = h.agent();
      expect(
        (await employee.post("/api/auth/login", { email: "employee@asaa.test", password: OWNER_PASSWORD })).status,
      ).toBe(200);
      const id = "00000000-0000-4000-8000-000000000001";
      for (let i = 0; i < 3; i += 1) {
        expect((await employee.post(`/api/templates/releases/${id}/approve`, {})).status).toBe(403);
      }
      await h.ctx.events!.flushAccessDenied(true);
      const rows = await outbox(h);
      expect(rows.map((row) => row.type)).toEqual(["templates.security.access-denied"]);
      expect((rows[0]!.envelope as { data: { count: number } }).data.count).toBe(3);
    } finally {
      await h.close();
    }
  });
});

describe("authentication to ASAA (mocked Keycloak)", () => {
  it("fetches a client-credentials token once, caches it and never persists the secret", async () => {
    const h = createHarness(credentialsEnv());
    try {
      await h.reset();
      const events = h.ctx.events!;
      await events.record({ type: "templates.job.completed", data: {} });
      await events.record({ type: "templates.job.completed", data: {} });
      expect(await events.deliverDue()).toBe(2);
      expect(tokenRequests).toHaveLength(1);
      const form = new URLSearchParams(tokenRequests[0]);
      expect(form.get("grant_type")).toBe("client_credentials");
      expect(form.get("client_id")).toBe("templates-events");
      expect(received.map((item) => item.authorization)).toEqual([
        "Bearer mock-access-token-1",
        "Bearer mock-access-token-1",
      ]);
      const stored = JSON.stringify(await outbox(h));
      expect(stored).not.toContain(CLIENT_SECRET);
      expect(stored).not.toContain("mock-access-token");
    } finally {
      await h.close();
    }
  });

  it("refreshes the token once on 401 and re-sends the event", async () => {
    const h = createHarness(credentialsEnv());
    try {
      await h.reset();
      const events = h.ctx.events!;
      await events.record({ type: "templates.job.completed", data: {} });
      expect(await events.deliverDue()).toBe(1);
      expect(received.at(-1)?.authorization).toBe("Bearer mock-access-token-1");
      rejectToken = "mock-access-token-1"; // the cached token is now rejected, as after a key rotation
      await events.record({ type: "templates.job.completed", data: {} });
      expect(await events.deliverDue()).toBe(1);
      expect(tokenRequests).toHaveLength(2);
      expect(received.slice(-2).map((item) => item.authorization)).toEqual([
        "Bearer mock-access-token-1",
        "Bearer mock-access-token-2",
      ]);
    } finally {
      await h.close();
    }
  });

  it("keeps retrying (not dead-lettering) when credentials stay rejected", async () => {
    const h = createHarness(staticEnv());
    try {
      await h.reset();
      rejectToken = STATIC_TOKEN;
      const id = (await h.ctx.events!.record({ type: "templates.job.completed", data: {} }))!;
      expect(await h.ctx.events!.deliverDue()).toBe(0);
      expect(await h.ctx.prisma.asaaEventOutbox.findUnique({ where: { id } })).toMatchObject({
        status: "PENDING",
        lastError: "status 401",
      });
    } finally {
      await h.close();
    }
  });
});

describe("redirects are never followed", () => {
  it("keeps the event retryable and sends nothing to the redirect target", async () => {
    const h = createHarness(staticEnv());
    try {
      await h.reset();
      redirectIngestTo = trapUrl;
      const id = (await h.ctx.events!.record({ type: "templates.job.completed", data: {} }))!;
      expect(await h.ctx.events!.deliverDue()).toBe(0);
      expect(await h.ctx.prisma.asaaEventOutbox.findUnique({ where: { id } })).toMatchObject({
        status: "PENDING",
        lastError: "status 302",
      });
      expect(trapHits).toHaveLength(0);
      expect(h.ctx.events!.manifestStatus()).toBe("degraded");
    } finally {
      await h.close();
    }
  });

  it("does not forward the client secret when the token endpoint redirects", async () => {
    const h = createHarness(credentialsEnv());
    try {
      await h.reset();
      redirectTokenTo = trapUrl;
      const id = (await h.ctx.events!.record({ type: "templates.job.completed", data: {} }))!;
      expect(await h.ctx.events!.deliverDue()).toBe(0);
      expect(trapHits).toHaveLength(0);
      expect(received).toHaveLength(0);
      const row = await h.ctx.prisma.asaaEventOutbox.findUnique({ where: { id } });
      expect(row).toMatchObject({ status: "PENDING", lastError: "token endpoint status 307" });
      expect(JSON.stringify(row)).not.toContain(CLIENT_SECRET);
    } finally {
      await h.close();
    }
  });
});

describe("service manifest asaaEvents check", () => {
  it("reports disabled by default and ok when configured", async () => {
    const off = createHarness();
    const on = createHarness(staticEnv());
    try {
      const offManifest = (await off.agent().get("/.well-known/asaa-service")).body;
      expect(offManifest.checks.asaaEvents).toBe("disabled");
      expect(manifestSchema.safeParse(offManifest).success).toBe(true);
      const onManifest = (await on.agent().get("/.well-known/asaa-service")).body;
      expect(onManifest.checks.asaaEvents).toBe("ok");
      expect(manifestSchema.safeParse(onManifest).success).toBe(true);
      expect(JSON.stringify(onManifest)).not.toContain(STATIC_TOKEN);
    } finally {
      await off.close();
      await on.close();
    }
  });
});
