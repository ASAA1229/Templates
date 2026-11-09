import { expect, test } from "@playwright/test";
import { expectAccessible, signIn } from "./fixtures";

test.describe("responsive layout (US-B04)", () => {
  test("mobile navigation drawer works and pages never scroll horizontally", async ({ page }) => {
    await signIn(page, "/");
    await expect(page.getByRole("heading", { name: /Welcome/ })).toBeVisible();
    for (const path of ["/", "/projects", "/catalog", "/audit", "/security"]) {
      await page.goto(path);
      await expect(page.locator("main#main h1")).toBeVisible();
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      expect(overflow, `horizontal overflow on ${path}`).toBeLessThanOrEqual(0);
    }
    await page.goto("/");
    const menu = page.getByRole("button", { name: "Open menu" });
    await expect(menu).toBeVisible();
    await menu.click();
    await expect(menu).toHaveAttribute("aria-expanded", "true");
    await page.getByRole("complementary", { name: "Menu" }).getByRole("link", { name: "Template catalog" }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Template catalog" })).toBeVisible();
    await expect(page.getByRole("complementary", { name: "Menu" })).toHaveCount(0);
    await expectAccessible(page);
  });
});
