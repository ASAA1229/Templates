import path from "node:path";
import { pathToFileURL } from "node:url";
import { expect, test, type Page } from "@playwright/test";
import { expectAccessible, signIn } from "./fixtures";

const BUSINESS_TYPES = ["restaurant", "clinic", "education", "retail", "professional"];
const VARIANTS = ["essential", "editorial", "catalog", "booking", "multisite"];
const OUTPUT_ROOT = process.env.E2E_GENERATION_DIR;

async function apiRequest(page: Page, url: string, method: "GET" | "POST", data?: unknown) {
  const headers = { "x-requested-with": "asaa-templates" };
  const response =
    method === "GET"
      ? await page.request.get(url, { headers })
      : await page.request.post(url, { headers, data });
  return { status: response.status(), body: await response.json() };
}

test.describe("template library batch 001 browser review", () => {
  test("renders all 25 generated demos at desktop and mobile widths", async ({ page }) => {
    test.setTimeout(120_000);
    if (!OUTPUT_ROOT) throw new Error("E2E_GENERATION_DIR is not configured.");

    await signIn(page, "/catalog");
    await expect(page).toHaveURL(/\/catalog$/);
    const response = await apiRequest(page, "/api/templates/library", "GET");
    expect(response.status).toBe(200);
    const templates = response.body.templates as { id: string; version: string; valid: boolean }[];
    const batchRun = Date.now().toString(36).toUpperCase().slice(-6);
    const expectedIds = BUSINESS_TYPES.flatMap((businessType) =>
      VARIANTS.map((variant) => `${businessType}-${variant}`),
    );
    const demos = templates.filter((template) => expectedIds.includes(template.id));

    expect(demos).toHaveLength(25);
    expect(demos.every((template) => template.valid && template.version === "1.0.0")).toBe(true);

    for (const [index, template] of demos.entries()) {
      // Retries must use fresh project keys because earlier attempts may have created projects.
      const key = `V${batchRun}${String(index + 1).padStart(2, "0")}`;
      const approval = await apiRequest(
        page,
        `/api/templates/library/${template.id}/${template.version}/approve`,
        "POST",
      );
      expect([200, 201], `${template.id} approval`).toContain(approval.status);
      const { item } = approval.body;

      const generated = await apiRequest(page, "/api/generations", "POST", {
        mode: "TEMPLATE",
        catalogItemId: item.id,
        project: {
          key,
          name: `Visual review ${template.id}`,
          purpose: `Browser rendering review for ${template.id}`,
        },
        inputs: {},
      });
      expect(generated.status, `${template.id} generation: ${JSON.stringify(generated.body)}`).toBe(201);
      const { generation } = generated.body;
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
  });
});
