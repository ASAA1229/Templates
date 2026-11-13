import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { createHarness } from "./helpers.js";

describe("health and readiness", () => {
  const healthy = createHarness();
  const scratch = mkdtempSync(path.join(tmpdir(), "health-test-"));
  const missingLibrary = path.join(scratch, "no-such-library-dir");
  const broken = createHarness({ TEMPLATE_LIBRARY_DIR: missingLibrary });

  afterAll(async () => {
    await healthy.close();
    await broken.close();
    rmSync(scratch, { recursive: true, force: true });
  });

  it("reports ready when the database, migrations, library and output dir are usable", async () => {
    const response = await healthy.agent().get("/api/health/ready");
    expect(response.status).toBe(200);
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(response.body).toEqual({
      status: "ready",
      checks: { database: "ok", migrations: "ok", templateLibrary: "ok", generationOutput: "ok" },
    });
  });

  it("returns 503 with per-check results when the template library directory is missing", async () => {
    const response = await broken.agent().get("/api/health/ready");
    expect(response.status).toBe(503);
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(response.body.status).toBe("not_ready");
    expect(response.body.checks).toEqual({
      database: "ok",
      migrations: "ok",
      templateLibrary: "fail",
      generationOutput: "ok",
    });
  });

  it("keeps liveness unchanged and unauthenticated", async () => {
    const response = await healthy.agent().get("/api/health");
    expect(response.status).toBe(200);
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(response.body).toEqual({ status: "ok", database: "ok" });
  });

  it("does not leak paths or secrets in either health body", async () => {
    const responses = [
      await healthy.agent().get("/api/health/ready"),
      await broken.agent().get("/api/health/ready"),
      await healthy.agent().get("/api/health"),
    ];
    const url = new URL(process.env.TEST_DATABASE_URL ?? "postgresql://x@localhost/x");
    for (const response of responses) {
      const text = JSON.stringify(response.body);
      expect(text).not.toContain(missingLibrary);
      expect(text).not.toContain(scratch);
      expect(text).not.toContain("template-library");
      expect(text).not.toContain(".local");
      expect(text).not.toContain("postgres");
      if (url.password) expect(text).not.toContain(decodeURIComponent(url.password));
    }
  });
});
