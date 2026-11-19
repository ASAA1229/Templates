import type { Express } from "express";
import type { AppContext } from "../../context.js";
import { apiVersion, buildCommit } from "../../lib/build-info.js";
import { RateLimiter } from "../../middleware/security.js";
import { readinessChecks, type ReadinessChecks } from "../ops/readiness.js";

export type ManifestCheck = "ok" | "degraded" | "down" | "disabled";

export interface ServiceManifest {
  schema: "asaa.service-manifest.v1";
  service: "templates-api";
  project: "TEMPLATES";
  version: string;
  commit: string | null;
  environment: "development" | "test" | "staging" | "production";
  status: "ok" | "degraded" | "down";
  checkedAt: string;
  checks: Record<string, ManifestCheck>;
  capabilities: string[];
  contracts: Record<string, string>;
}

export const MANIFEST_PATH = "/.well-known/asaa-service";
export const CAPABILITIES = ["templates.catalog", "templates.generation", "templates.releases", "events.produce"];

/**
 * Secret-free self-description for the ASAA ecosystem (contracts/asaa-ecosystem/v1/service-manifest.schema.json).
 * AI status comes from configuration only; no provider is called.
 */
export async function buildManifest(
  ctx: AppContext,
  ready: ReadinessChecks | Promise<ReadinessChecks> = readinessChecks(ctx),
): Promise<ServiceManifest> {
  ready = await ready;
  const checks: Record<string, ManifestCheck> = {
    database: ready.database === "ok" ? "ok" : "down",
    migrations: ready.migrations === "ok" ? "ok" : "degraded",
    templateLibrary: ready.templateLibrary === "ok" ? "ok" : "degraded",
    generationOutput: ready.generationOutput === "ok" ? "ok" : "degraded",
    ai: ctx.config.AI_ENABLED ? "ok" : "disabled",
    asaaEvents: ctx.events ? ctx.events.manifestStatus() : "disabled",
  };
  const status = checks.database === "down" ? "down" : Object.values(checks).includes("degraded") ? "degraded" : "ok";
  return {
    schema: "asaa.service-manifest.v1",
    service: "templates-api",
    project: "TEMPLATES",
    version: apiVersion(),
    commit: buildCommit(),
    environment: ctx.config.NODE_ENV,
    status,
    checkedAt: ctx.now().toISOString(),
    checks,
    capabilities: [...CAPABILITIES],
    contracts: { serviceManifest: "v1", eventEnvelope: "v1" },
  };
}

/** Probes hit the database and the file system, so an unauthenticated endpoint must not run them per request. */
export const READINESS_CACHE_MS = 10_000;
export const MANIFEST_RATE_LIMIT = { limit: 120, windowMs: 60_000 };

/**
 * Unauthenticated, mounted before CSRF/auth like /api/health. Readiness probes are cached for
 * READINESS_CACHE_MS (concurrent callers share one probe run) and each client address is rate limited.
 */
export function mountManifest(app: Express, ctx: AppContext) {
  const limiter = new RateLimiter(MANIFEST_RATE_LIMIT.limit, MANIFEST_RATE_LIMIT.windowMs, () => ctx.now().getTime());
  let cached: { at: number; probes: Promise<ReadinessChecks> } | null = null;
  const probes = () => {
    const at = ctx.now().getTime();
    if (!cached || at - cached.at >= READINESS_CACHE_MS || at < cached.at) {
      const run = readinessChecks(ctx);
      cached = { at, probes: run };
      // A failed probe run must not stay cached.
      run.catch(() => {
        if (cached?.probes === run) cached = null;
      });
    }
    return cached.probes;
  };
  app.get(MANIFEST_PATH, async (req, res, next) => {
    try {
      res.setHeader("cache-control", "no-store");
      const wait = limiter.consume(req.ip ?? "unknown");
      if (wait > 0) {
        res.setHeader("retry-after", String(wait));
        return void res.status(429).json({ error: { code: "RATE_LIMITED", message: "Too many requests." } });
      }
      res.json(await buildManifest(ctx, probes()));
    } catch (error) {
      next(error);
    }
  });
}
