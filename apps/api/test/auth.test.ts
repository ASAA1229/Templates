import supertest from "supertest";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createHarness, OWNER_EMAIL, OWNER_PASSWORD } from "./helpers.js";

const h = createHarness();
afterAll(() => h.close());
beforeEach(async () => {
  await h.reset();
  await h.createOwner();
});

describe("owner sign-in (US-A01)", () => {
  it("creates an HttpOnly, SameSite=Strict session cookie and audits success", async () => {
    const agent = h.agent();
    const response = await agent.post("/api/auth/login", { email: OWNER_EMAIL.toUpperCase(), password: OWNER_PASSWORD });
    expect(response.status).toBe(200);
    expect(response.body.owner.email).toBe(OWNER_EMAIL);
    const cookie = String(response.headers["set-cookie"]);
    expect(cookie).toMatch(/asaa_session=/);
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=Strict/i);
    expect((await agent.get("/api/auth/session")).status).toBe(200);

    const sessions = await h.ctx.prisma.session.findMany();
    expect(sessions).toHaveLength(1);
    // Only the hash is stored, never the cookie token.
    expect(cookie).not.toContain(sessions[0]!.tokenHash);
    const events = await h.ctx.prisma.auditEvent.findMany({ where: { action: "auth.login" } });
    expect(events.map((event) => event.outcome)).toEqual(["SUCCESS"]);
    expect(JSON.stringify(events, (_key, value) => (typeof value === "bigint" ? value.toString() : value))).not.toContain(OWNER_PASSWORD);
  });

  it("returns the same generic error for a wrong password and an unknown account", async () => {
    const wrong = await h.agent().post("/api/auth/login", { email: OWNER_EMAIL, password: "wrong password!" });
    const unknown = await h.agent().post("/api/auth/login", { email: "nobody@asaa.test", password: "wrong password!" });
    expect(wrong.status).toBe(401);
    expect(unknown.status).toBe(401);
    expect(wrong.body.error.message).toBe(unknown.body.error.message);
    const failures = await h.ctx.prisma.auditEvent.count({ where: { action: "auth.login", outcome: "FAILURE" } });
    expect(failures).toBe(2);
  });

  it("rate-limits repeated attempts for one account", async () => {
    // Separate app instance: the lockout must not leak into the other tests.
    const isolated = createHarness();
    const agent = isolated.agent();
    let last;
    for (let attempt = 0; attempt < 9; attempt++) {
      last = await agent.post("/api/auth/login", { email: OWNER_EMAIL, password: "wrong password!" });
    }
    expect(last!.status).toBe(429);
    expect(last!.headers["retry-after"]).toBeDefined();
    // Even the correct password is refused while the account is locked out.
    const correct = await agent.post("/api/auth/login", { email: OWNER_EMAIL, password: OWNER_PASSWORD });
    expect(correct.status).toBe(429);
    await isolated.close();
  });

  it("rejects malformed bodies with the generic message", async () => {
    const response = await h.agent().post("/api/auth/login", { email: "not-an-email" });
    expect(response.status).toBe(400);
    expect(response.body.error.message).toBe("Invalid email or password.");
  });
});

describe("sessions (US-A02)", () => {
  it("requires a session for protected routes", async () => {
    expect((await h.agent().get("/api/projects")).status).toBe(401);
    expect((await h.agent().get("/api/auth/session")).status).toBe(401);
  });

  it("logout revokes the session server-side", async () => {
    const agent = await h.signedIn();
    expect((await agent.post("/api/auth/logout")).status).toBe(204);
    expect((await agent.get("/api/projects")).status).toBe(401);
    expect((await h.ctx.prisma.session.findFirst())?.revokedAt).not.toBeNull();
  });

  it("expires idle and absolute-timeout sessions", async () => {
    const agent = await h.signedIn();
    h.clock.now = new Date(h.clock.now.getTime() + 31 * 60_000);
    expect((await agent.get("/api/projects")).status).toBe(401);

    await h.reset();
    await h.createOwner();
    const fresh = await h.signedIn();
    // Keep it active, but pass the 12-hour absolute limit.
    for (let hour = 0; hour < 13; hour++) {
      h.clock.now = new Date(h.clock.now.getTime() + 20 * 60_000);
      await fresh.get("/api/projects");
      h.clock.now = new Date(h.clock.now.getTime() + 20 * 60_000);
      await fresh.get("/api/projects");
      h.clock.now = new Date(h.clock.now.getTime() + 20 * 60_000);
    }
    expect((await fresh.get("/api/projects")).status).toBe(401);
  });

  it("lists and revokes other sessions", async () => {
    const first = await h.signedIn();
    const second = await h.signedIn();
    const listed = await first.get("/api/auth/sessions");
    expect(listed.body.sessions).toHaveLength(2);
    expect(listed.body.sessions.filter((session: { current: boolean }) => session.current)).toHaveLength(1);
    const revoked = await first.post("/api/auth/sessions/revoke-others");
    expect(revoked.body.revoked).toBe(1);
    expect((await second.get("/api/projects")).status).toBe(401);
    expect((await first.get("/api/projects")).status).toBe(200);
  });

  it("password change requires the current password and ends other sessions", async () => {
    const first = await h.signedIn();
    const second = await h.signedIn();
    const wrong = await first.post("/api/auth/password", { currentPassword: "nope", newPassword: "another long password" });
    expect(wrong.status).toBe(400);
    expect(wrong.body.error.fields.currentPassword).toBeDefined();
    const weak = await first.post("/api/auth/password", { currentPassword: OWNER_PASSWORD, newPassword: "short" });
    expect(weak.status).toBe(400);

    const changed = await first.post("/api/auth/password", { currentPassword: OWNER_PASSWORD, newPassword: "another long password" });
    expect(changed.status).toBe(204);
    expect((await second.get("/api/projects")).status).toBe(401);
    expect((await first.get("/api/projects")).status).toBe(200);
    const relogin = await h.agent().post("/api/auth/login", { email: OWNER_EMAIL, password: "another long password" });
    expect(relogin.status).toBe(200);
  });
});

describe("cross-site request protection and hardening", () => {
  it("rejects writes without the CSRF header or from a foreign origin", async () => {
    const agent = await h.signedIn();
    const noHeader = await agent.raw.post("/api/projects").send({ key: "ABC", name: "x" });
    expect(noHeader.status).toBe(403);
    expect(noHeader.body.error.code).toBe("CSRF_REJECTED");
    const foreign = await agent.raw
      .post("/api/projects")
      .set("x-requested-with", "asaa-templates")
      .set("origin", "https://evil.example")
      .send({ key: "ABC", name: "x" });
    expect(foreign.status).toBe(403);
  });

  it("sets security headers and no-store caching on API responses", async () => {
    const response = await supertest(h.app).get("/api/health");
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ status: "ok", database: "ok" });
    expect(response.headers["content-security-policy"]).toContain("frame-ancestors 'none'");
    expect(response.headers["x-content-type-options"]).toBe("nosniff");
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(response.headers["x-powered-by"]).toBeUndefined();
    expect(response.headers["x-request-id"]).toBeDefined();
  });

  it("returns structured errors for invalid JSON, oversized bodies and unknown routes", async () => {
    const agent = await h.signedIn();
    const badJson = await agent.raw
      .post("/api/projects")
      .set("x-requested-with", "asaa-templates")
      .set("content-type", "application/json")
      .send('{"key":');
    expect(badJson.status).toBe(400);
    const big = await agent.post("/api/projects", { key: "BIG", name: "x", purpose: "y".repeat(200_000) });
    expect(big.status).toBe(413);
    const unknown = await agent.get("/api/nope");
    expect(unknown.status).toBe(404);
    expect(unknown.body.error.requestId).toBeDefined();
  });
});

describe("audit trail integrity (US-I02)", () => {
  it("rejects updates and deletes of audit events at the database level", async () => {
    await h.signedIn();
    const event = await h.ctx.prisma.auditEvent.findFirstOrThrow();
    await expect(h.ctx.prisma.auditEvent.update({ where: { id: event.id }, data: { action: "x" } })).rejects.toThrow(/append-only/);
    await expect(h.ctx.prisma.auditEvent.delete({ where: { id: event.id } })).rejects.toThrow(/append-only/);
  });

  it("allows only one owner", async () => {
    await expect(
      h.ctx.prisma.owner.create({ data: { email: "second@asaa.test", displayName: "Two", passwordHash: "x" } }),
    ).rejects.toThrow();
  });
});
