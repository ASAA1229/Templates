import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createHarness, OWNER_EMAIL, OWNER_PASSWORD } from "./helpers.js";

/** E3:D5.14 regression tests for authentication hardening. */
const h = createHarness();
afterAll(() => h.close());
beforeEach(async () => {
  await h.reset();
  await h.createOwner();
});

describe("sign-in session rotation", () => {
  it("ends the session cookie presented at sign-in instead of leaving it valid", async () => {
    const agent = await h.signedIn();
    const before = await h.ctx.prisma.session.findMany({ where: { revokedAt: null } });
    expect(before).toHaveLength(1);
    const again = await agent.post("/api/auth/login", { email: OWNER_EMAIL, password: OWNER_PASSWORD });
    expect(again.status).toBe(200);
    const active = await h.ctx.prisma.session.findMany({ where: { revokedAt: null } });
    expect(active).toHaveLength(1);
    expect(active[0]!.id).not.toBe(before[0]!.id);
  });
});

describe("per-address sign-in counter", () => {
  it("is not reset by a successful sign-in", async () => {
    const agent = h.agent();
    await agent.post("/api/auth/login", { email: "someone@asaa.test", password: "wrong password here" });
    await agent.post("/api/auth/login", { email: OWNER_EMAIL, password: OWNER_PASSWORD });
    const buckets = await h.ctx.prisma.rateLimitBucket.findMany({ where: { key: { startsWith: "login-ip:" } } });
    expect(buckets).toHaveLength(1);
    expect(buckets[0]!.count).toBeGreaterThanOrEqual(2);
  });
});

describe("password confirmation from a signed-in session", () => {
  it("is rate limited so a hijacked session cannot brute-force the current password", async () => {
    const agent = await h.signedIn();
    let last = 0;
    for (let attempt = 0; attempt < 11; attempt++) {
      last = (await agent.post("/api/auth/password", { currentPassword: "wrong wrong wrong", newPassword: "another long password" })).status;
    }
    expect(last).toBe(429);
    const mfa = await agent.post("/api/auth/mfa/enroll", { password: "wrong wrong wrong" });
    expect(mfa.status).toBe(429);
  });
});
