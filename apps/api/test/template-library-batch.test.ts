import { cp, mkdtemp, rm } from "node:fs/promises";
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
let h: ReturnType<typeof createHarness>;
let agent: Awaited<ReturnType<ReturnType<typeof createHarness>["signedIn"]>>;

beforeAll(async () => {
  base = await mkdtemp(path.join(tmpdir(), "asaa-template-batch-"));
  library = path.join(base, "library");
  h = createHarness({ TEMPLATE_LIBRARY_DIR: library });
  await cp(BUNDLED, library, { recursive: true });
});

afterAll(async () => {
  await h.close();
  await rm(base, { recursive: true, force: true });
});

beforeEach(async () => {
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
});
