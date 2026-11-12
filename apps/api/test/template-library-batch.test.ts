import { cp, mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createHarness } from "./helpers.js";

const BUNDLED = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../template-library");
const BUSINESS_TYPES = ["restaurant", "clinic", "education", "retail", "professional"];
const VARIANTS = ["essential", "editorial", "catalog", "booking", "multisite"];

let base: string;
let library: string;
let output: string;
let h: ReturnType<typeof createHarness>;
let agent: Awaited<ReturnType<ReturnType<typeof createHarness>["signedIn"]>>;

beforeAll(async () => {
  base = await mkdtemp(path.join(tmpdir(), "asaa-template-batch-"));
  library = path.join(base, "library");
  output = path.join(base, "output");
  h = createHarness({ TEMPLATE_LIBRARY_DIR: library, GENERATION_OUTPUT_DIR: output });
  await cp(BUNDLED, library, { recursive: true });
});

afterAll(async () => {
  await h.close();
  await rm(base, { recursive: true, force: true });
});

beforeEach(async () => {
  await rm(output, { recursive: true, force: true });
  await h.reset();
  await h.createOwner();
  agent = await h.signedIn();
});

describe("template library batch 001", () => {
  it("discovers and validates all 25 industry demo packages without approving them", async () => {
    const response = await agent.get("/api/templates/library");
    expect(response.status).toBe(200);

    const templates = response.body.templates as {
      id: string;
      version: string;
      valid: boolean;
      approved: boolean;
      problems: string[];
    }[];
    const expectedIds = BUSINESS_TYPES.flatMap((businessType) =>
      VARIANTS.map((variant) => `${businessType}-${variant}`),
    );
    const demos = templates.filter((template) => expectedIds.includes(template.id));

    expect(demos).toHaveLength(25);
    expect(demos.map((template) => template.id).sort()).toEqual(expectedIds.sort());
    for (const template of demos) {
      expect(template).toMatchObject({
        version: "1.0.0",
        valid: true,
        approved: false,
        problems: [],
      });
    }
  });

  it("approves, previews, generates and verifies every demo package with clean rendered output", async () => {
    const response = await agent.get("/api/templates/library");
    expect(response.status).toBe(200);
    const templates = response.body.templates as { id: string; version: string; valid: boolean }[];
    const expectedIds = BUSINESS_TYPES.flatMap((businessType) =>
      VARIANTS.map((variant) => `${businessType}-${variant}`),
    );
    const demos = templates.filter((template) => expectedIds.includes(template.id));

    expect(demos).toHaveLength(25);
    expect(demos.every((template) => template.valid && template.version === "1.0.0")).toBe(true);

    for (const [index, template] of demos.entries()) {
      const key = `B001-${String(index + 1).padStart(2, "0")}`;
      const request = {
        mode: "TEMPLATE",
        project: {
          key,
          name: `Batch 001 ${template.id}`,
          purpose: `Generated validation project for ${template.id}`,
        },
        catalogItemId: undefined as string | undefined,
        inputs: {},
      };

      const approval = await agent.post(`/api/templates/library/${template.id}/${template.version}/approve`);
      expect(approval.status, `${template.id} approval`).toBe(201);
      request.catalogItemId = approval.body.item.id;

      const preview = await agent.post("/api/generations/preview", request);
      expect(preview.status, `${template.id} preview`).toBe(200);
      expect(preview.body.preview.conflicts, `${template.id} preview conflicts`).toEqual([]);
      expect(preview.body.preview.files.length, `${template.id} preview files`).toBeGreaterThan(0);

      const generated = await agent.post("/api/generations", request);
      expect(generated.status, `${template.id} generation`).toBe(201);
      const generation = generated.body.generation;
      expect(generation).toMatchObject({
        status: "SUCCEEDED",
        mode: "TEMPLATE",
        templateId: template.id,
        templateVersion: template.version,
        outputDigest: preview.body.preview.outputDigest,
      });

      const verification = await agent.post(`/api/generations/${generation.id}/verify`);
      expect(verification.status, `${template.id} verification`).toBe(200);
      expect(verification.body.verification).toMatchObject({
        reproducible: true,
        outputIntact: true,
        problems: [],
      });

      for (const file of generation.files as string[]) {
        if (!/\.(?:html?|css|m?js|json|md|txt|svg|xml)$/i.test(file)) continue;
        const rendered = await readFile(path.join(output, generation.outputDir, file), "utf8");
        expect(rendered, `${template.id} ${file} unresolved placeholders`).not.toMatch(
          /{{\s*[A-Za-z][A-Za-z0-9_]*\s*}}/,
        );
      }
    }

    expect(await h.ctx.prisma.project.count()).toBe(25);
    expect(await h.ctx.prisma.projectGeneration.count()).toBe(25);
    expect(await readdir(output)).toHaveLength(25);
  }, 120_000);
});
