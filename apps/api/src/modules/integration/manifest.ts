import type { Express } from "express";
import type { AppContext } from "../../context.js";
import { apiVersion, buildCommit } from "../../lib/build-info.js";
import { readinessChecks } from "../ops/readiness.js";

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
export async function buildManifest(ctx: AppContext): Promise<ServiceManifest> {
  const ready = await readinessChecks(ctx);
  const checks: Record<string, ManifestCheck> = {
    database: ready.database === "ok" ? "ok" : "down",
    migrations: ready.migrations === "ok" ? "ok" : "degraded",
    templateLibrary: ready.templateLibrary === "ok" ? "ok" : "degraded",
    generationOutput: ready.generationOutput === "ok" ? "ok" : "degraded",
    ai: ctx.config.AI_ENABLED ? "ok" : "disabled",
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

/** Unauthenticated, mounted before CSRF/auth like /api/health. */
export function mountManifest(app: Express, ctx: AppContext) {
  app.get(MANIFEST_PATH, async (_req, res) => {
    res.setHeader("cache-control", "no-store");
    res.json(await buildManifest(ctx));
  });
}
