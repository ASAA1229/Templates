import { readFileSync } from "node:fs";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { MANIFEST_RATE_LIMIT, READINESS_CACHE_MS } from "../src/modules/integration/manifest.js";
import { createHarness } from "./helpers.js";

const contractsDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../contracts/asaa-ecosystem/v1");
const manifestSchema = z.fromJSONSchema(
  JSON.parse(readFileSync(path.join(contractsDir, "service-manifest.schema.json"), "utf8")),
);

describe("ASAA service manifest (/.well-known/asaa-service)", () => {
  const scratch = mkdtempSync(path.join(tmpdir(), "manifest-test-"));
  const healthy = createHarness();
  const degraded = createHarness({ TEMPLATE_LIBRARY_DIR: path.join(scratch, "missing"), AI_ENABLED: "true" });

  afterAll(async () => {
    await healthy.close();
    await degraded.close();
    rmSync(scratch, { recursive: true, force: true, maxRetries: 8, retryDelay: 250 });
  });

  it("is served unauthenticated and validates against the vendored v1 schema", async () => {
    const response = await healthy.agent().get("/.well-known/asaa-service");
    expect(response.status).toBe(200);
    expect(response.headers["cache-control"]).toBe("no-store");
    const parsed = manifestSchema.safeParse(response.body);
    expect(parsed.success, JSON.stringify(parsed.error?.issues)).toBe(true);
    expect(response.body).toMatchObject({
      schema: "asaa.service-manifest.v1",
      service: "templates-api",
      project: "TEMPLATES",
      environment: "test",
      status: "ok",
      capabilities: ["templates.catalog", "templates.generation", "templates.releases", "events.produce"],
      checks: {
        database: "ok",
        migrations: "ok",
        templateLibrary: "ok",
        generationOutput: "ok",
        ai: "disabled",
      },
    });
  });

  it("reports degraded checks and enabled AI from configuration without exposing secrets or paths", async () => {
    const response = await degraded.agent().get("/.well-known/asaa-service");
    expect(response.status).toBe(200);
    expect(manifestSchema.safeParse(response.body).success).toBe(true);
    expect(response.body.status).toBe("degraded");
    expect(response.body.checks.templateLibrary).toBe("degraded");
    expect(response.body.checks.ai).toBe("ok");
    const text = JSON.stringify(response.body);
    expect(text).not.toContain(scratch);
    expect(text).not.toMatch(/postgres(ql)?:\/\//);
  });

  it("caches readiness probes for a few seconds and rate limits per client", async () => {
    const h = createHarness();
    try {
      const spy = vi.spyOn(h.ctx.prisma, "$queryRaw");
      const agent = h.agent();
      expect((await agent.get("/.well-known/asaa-service")).status).toBe(200);
      const afterFirst = spy.mock.calls.length;
      expect(afterFirst).toBeGreaterThan(0);
      await agent.get("/.well-known/asaa-service");
      await agent.get("/.well-known/asaa-service");
      expect(spy.mock.calls.length).toBe(afterFirst); // served from the cache
      h.clock.now = new Date(h.clock.now.getTime() + READINESS_CACHE_MS + 1);
      await agent.get("/.well-known/asaa-service");
      expect(spy.mock.calls.length).toBe(afterFirst * 2); // refreshed after the cache window
      // Rate limit: the window allows MANIFEST_RATE_LIMIT.limit requests per client address.
      let limited = 0;
      for (let i = 0; i < MANIFEST_RATE_LIMIT.limit + 5; i += 1) {
        const res = await agent.get("/.well-known/asaa-service");
        if (res.status === 429) {
          limited += 1;
          expect(res.headers["retry-after"]).toBeTruthy();
        }
      }
      expect(limited).toBeGreaterThan(0);
    } finally {
      vi.restoreAllMocks();
      await h.close();
    }
  });

  it("rejects a manifest that violates the schema (guards the validator itself)", () => {
    expect(manifestSchema.safeParse({ schema: "asaa.service-manifest.v1" }).success).toBe(false);
  });
});
