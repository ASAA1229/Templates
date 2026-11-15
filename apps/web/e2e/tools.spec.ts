import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";
import { expectAccessible, signIn } from "./fixtures";

const TITLE = "Environment Snapshot (Linux/AIX)";

test("the catalog lists packaged tools and downloads a verified ZIP", async ({ page }) => {
  await signIn(page, "/catalog");
  await expect(page.getByRole("heading", { name: "Template catalog" })).toBeVisible();

  const tools = page.getByRole("list", { name: "Available tools" });
  await expect(tools).toBeVisible({ timeout: 30_000 });
  await expect(tools.getByRole("listitem")).toHaveCount(1);
  await expect(tools.getByRole("listitem").first()).toContainText(TITLE);
  await expect(tools.getByText("v1.0.0")).toBeVisible();
  const digest = (await tools.locator("code").first().innerText()).trim();
  expect(digest).toMatch(/^[0-9a-f]{64}$/);
  await expectAccessible(page);
  const link = page.getByRole("link", { name: `Download ${TITLE}` });
  await expect(link).toHaveAttribute("href", "/api/tools/env-snapshot/download");
  const [download] = await Promise.all([page.waitForEvent("download"), link.click()]);
  expect(download.suggestedFilename()).toBe("env-snapshot-1.0.0.zip");

  const bytes = await readFile(await download.path());
  expect(bytes.subarray(0, 2).toString("latin1")).toBe("PK");
  expect(createHash("sha256").update(bytes).digest("hex")).toBe(digest);

  // Browser downloads do not surface a page response event; assert the response headers with the same session.
  const response = await page.request.get("/api/tools/env-snapshot/download");
  expect(response.status()).toBe(200);
  expect(response.headers()["content-type"]).toBe("application/zip");
  expect(response.headers()["content-disposition"]).toBe('attachment; filename="env-snapshot-1.0.0.zip"');
  expect(
    createHash("sha256")
      .update(await response.body())
      .digest("hex"),
  ).toBe(digest);
});
