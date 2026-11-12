import path from "node:path";
import { pathToFileURL } from "node:url";
import { expect, test } from "@playwright/test";
import { expectAccessible, signIn } from "./fixtures";

const BUSINESS_TYPES = ["restaurant", "clinic", "education", "retail", "professional"];
const VARIANTS = ["essential", "editorial", "catalog", "booking", "multisite"];
const OUTPUT_ROOT = process.env.E2E_GENERATION_DIR;

test.describe("template library batch 001 browser review", () => {
  test("renders all 25 generated demos at desktop and mobile widths", async ({ page }) => {
    if (!OUTPUT_ROOT) throw new Error("E2E_GENERATION_DIR is not configured.");

    await signIn(page, "/catalog");
    const response = await page.request.get("/api/templates/library");
    expect(response.status()).toBe(200);
    const templates = (await response.json()).templates as { id: string; version: string; valid: boolean }[];
    const expectedIds = BUSINESS_TYPES.flatMap((businessType) =>
      VARIANTS.map((variant) => `${businessType}-${variant}`),
    );
    const demos = templates.filter((template) => expectedIds.includes(template.id));

    expect(demos).toHaveLength(25);
    expect(demos.every((template) => template.valid && template.version === "1.0.0")).toBe(true);

    for (const [index, template] of demos.entries()) {
      const key = `VIS-${String(index + 1).padStart(2, "0")}`;
      const approval = await page.request.post(`/api/templates/library/${template.id}/${template.version}/approve`);
      expect(approval.status(), `${template.id} approval`).toBe(201);
      const { item } = await approval.json();

      const generated = await page.request.post("/api/generations", {
        data: {
          mode: "TEMPLATE",
          catalogItemId: item.id,
          project: {
            key,
            name: `Visual review ${template.id}`,
            purpose: `Browser rendering review for ${template.id}`,
          },
          inputs: {},
        },
      });
      expect(generated.status(), `${template.id} generation`).toBe(201);
      const { generation } = await generated.json();
      expect(generation.status).toBe("SUCCEEDED");
      expect(generation.files).toContain("index.html");

      const fileUrl = pathToFileURL(path.join(OUTPUT_ROOT, generation.outputDir, "index.html")).href;

      for (const viewport of [
        { width: 1366, height: 900, label: "desktop" },
        { width: 390, height: 844, label: "mobile" },
      ]) {
        await page.setViewportSize({ width: viewport.width, height: viewport.height });
        await page.goto(fileUrl);
        await expect(page.locator("main")).toBeVisible();
        await expect(page.locator("main h1").first()).toBeVisible();
        expect(await page.title(), `${template.id} ${viewport.label} title`).not.toBe("");

        const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
        expect(overflow, `${template.id} horizontal overflow at ${viewport.width}px`).toBeLessThanOrEqual(0);
        await expectAccessible(page);
      }
    }
  }, 120_000);
});
