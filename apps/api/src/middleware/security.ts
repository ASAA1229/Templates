import { randomUUID } from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import type { AppContext } from "../context.js";
import { AppError } from "../lib/errors.js";

/** Correlates logs, audit events and error responses. */
export function requestId() {
  return (req: Request, res: Response, next: NextFunction) => {
    const incoming = req.get("x-request-id");
    req.requestId = incoming && /^[A-Za-z0-9-]{8,64}$/.test(incoming) ? incoming : randomUUID();
    res.setHeader("x-request-id", req.requestId);
    next();
  };
}

/**
 * CSRF defence in depth for cookie sessions: SameSite=Strict cookies, plus every
 * state-changing request must carry the custom header (not sendable cross-site
 * without a CORS preflight, which this API never grants) and, when the browser
 * sends Origin, it must match the configured web origin.
 */
export const CSRF_HEADER = "x-requested-with";
export const CSRF_VALUE = "asaa-templates";

export function csrfProtection(ctx: AppContext) {
  const allowedOrigins = new Set([new URL(ctx.config.WEB_ORIGIN).origin]);
  return (req: Request, _res: Response, next: NextFunction) => {
    if (["GET", "HEAD", "OPTIONS"].includes(req.method)) return next();
    const origin = req.get("origin");
    const selfOrigin = `${req.protocol}://${req.get("host")}`;
    if (req.get(CSRF_HEADER) !== CSRF_VALUE || (origin && !allowedOrigins.has(origin) && origin !== selfOrigin)) {
      return next(new AppError(403, "CSRF_REJECTED", "Request rejected by cross-site request protection."));
    }
    next();
  };
}

/** Small in-memory fixed-window limiter (single-process deployment; no paid store). */
export class RateLimiter {
  private readonly hits = new Map<string, { count: number; resetAt: number }>();
  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
    private readonly now: () => number = Date.now,
  ) {}

  /** Returns seconds until reset when the key is over the limit, otherwise 0. */
  consume(key: string): number {
    const at = this.now();
    if (this.hits.size > 10_000) {
      for (const [entryKey, entry] of this.hits) if (entry.resetAt <= at) this.hits.delete(entryKey);
    }
    const current = this.hits.get(key);
    if (!current || current.resetAt <= at) {
      this.hits.set(key, { count: 1, resetAt: at + this.windowMs });
      return 0;
    }
    current.count += 1;
    return current.count > this.limit ? Math.ceil((current.resetAt - at) / 1000) : 0;
  }

  reset(key: string): void {
    this.hits.delete(key);
  }
}
