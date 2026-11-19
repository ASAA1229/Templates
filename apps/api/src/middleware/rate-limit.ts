import { createHash } from "node:crypto";
import type { AppContext } from "../context.js";

/**
 * Fixed-window rate limiter backed by PostgreSQL so counters survive restarts and are shared by every
 * API instance. The increment is a single atomic upsert; keys are hashed so e-mail addresses and
 * IP addresses are not stored in clear text. Expired buckets are purged opportunistically.
 */
export class DbRateLimiter {
  constructor(
    private readonly ctx: AppContext,
    private readonly name: string,
    private readonly limit: number,
    private readonly windowMs: number,
  ) {}

  private bucket(key: string): string {
    return `${this.name}:${createHash("sha256").update(key).digest("hex").slice(0, 32)}`;
  }

  /** Records one attempt; returns seconds until the window resets when over the limit, otherwise 0. */
  async consume(key: string): Promise<number> {
    const now = this.ctx.now();
    const resetAt = new Date(now.getTime() + this.windowMs);
    const rows = await this.ctx.prisma.$queryRaw<{ count: number; resetAt: Date }[]>`
      INSERT INTO "RateLimitBucket" ("key", "count", "resetAt")
      VALUES (${this.bucket(key)}, 1, ${resetAt})
      ON CONFLICT ("key") DO UPDATE SET
        "count" = CASE WHEN "RateLimitBucket"."resetAt" <= ${now} THEN 1 ELSE "RateLimitBucket"."count" + 1 END,
        "resetAt" = CASE WHEN "RateLimitBucket"."resetAt" <= ${now} THEN ${resetAt} ELSE "RateLimitBucket"."resetAt" END
      RETURNING "count", "resetAt"`;
    if (Math.random() < 0.01) {
      void this.ctx.prisma.rateLimitBucket.deleteMany({ where: { resetAt: { lt: now } } }).catch(() => undefined);
    }
    const row = rows[0]!;
    return row.count > this.limit ? Math.max(1, Math.ceil((row.resetAt.getTime() - now.getTime()) / 1000)) : 0;
  }

  async reset(key: string): Promise<void> {
    await this.ctx.prisma.rateLimitBucket.deleteMany({ where: { key: this.bucket(key) } });
  }
}
