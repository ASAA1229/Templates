import { readFileSync } from "node:fs";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import { z } from "zod";
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

  it("rejects a manifest that violates the schema (guards the validator itself)", () => {
    expect(manifestSchema.safeParse({ schema: "asaa.service-manifest.v1" }).success).toBe(false);
  });
});
