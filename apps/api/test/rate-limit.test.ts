import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { DbRateLimiter } from "../src/middleware/rate-limit.js";
import { createHarness, OWNER_EMAIL, OWNER_PASSWORD } from "./helpers.js";

/** Shared (database-backed) rate limiting survives restarts and spans API instances. */
const h = createHarness();
afterAll(() => h.close());
beforeEach(async () => {
  await h.reset();
  await h.createOwner();
});

describe("database-backed rate limiter", () => {
  it("blocks after the limit, resets after the window and never stores raw keys", async () => {
    const limiter = new DbRateLimiter(h.ctx, "unit", 2, 1000);
    expect(await limiter.consume("someone@asaa.test")).toBe(0);
    expect(await limiter.consume("someone@asaa.test")).toBe(0);
    expect(await limiter.consume("someone@asaa.test")).toBeGreaterThan(0);
    const rows = await h.ctx.prisma.rateLimitBucket.findMany();
    expect(JSON.stringify(rows)).not.toContain("someone@asaa.test");
    h.clock.now = new Date(h.clock.now.getTime() + 1500);
    expect(await limiter.consume("someone@asaa.test")).toBe(0);
    await limiter.reset("someone@asaa.test");
    expect(await h.ctx.prisma.rateLimitBucket.count()).toBe(0);
  });

  it("is shared by separate limiter and app instances (restart-safe)", async () => {
    const first = new DbRateLimiter(h.ctx, "shared", 1, 60_000);
    const restarted = new DbRateLimiter(h.ctx, "shared", 1, 60_000);
    expect(await first.consume("k")).toBe(0);
    expect(await restarted.consume("k")).toBeGreaterThan(0);
  });

  it("counts concurrent attempts atomically", async () => {
    const limiter = new DbRateLimiter(h.ctx, "race", 5, 60_000);
    const results = await Promise.all(Array.from({ length: 20 }, () => limiter.consume("same")));
    expect(results.filter((value) => value === 0)).toHaveLength(5);
  });

  it("limits sign-in across two API instances sharing one database", async () => {
    const second = createHarness();
    try {
      let blocked = 0;
      for (let i = 0; i < 12; i++) {
        const target = i % 2 === 0 ? h : second;
        const response = await target
          .agent()
          .post("/api/auth/login", { email: OWNER_EMAIL, password: `wrong-${i}-password` });
        if (response.status === 429) blocked += 1;
      }
      expect(blocked).toBeGreaterThan(0);
      // A different instance also refuses the correct password while the account is locked out.
      expect(
        (await second.agent().post("/api/auth/login", { email: OWNER_EMAIL, password: OWNER_PASSWORD })).status,
      ).toBe(429);
    } finally {
      await second.close();
    }
  });
});
