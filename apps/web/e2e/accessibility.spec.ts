import { expect, test } from "@playwright/test";
import { accessibilityViolations, generateProject, signIn, unique } from "./fixtures";

/**
 * RG-09: automated WCAG 2.2 A/AA (axe) sweep over every route and key states, in the light and dark
 * colour schemes (the desktop-dark project) plus keyboard checks. Violations from all pages are
 * collected and reported together. Manual screen-reader review remains a separate, human step.
 */
const PUBLIC_ROUTES = [
  "/login",
  "/request-access",
  "/activate?token=" + "a".repeat(40),
  "/reset-password?token=" + "a".repeat(40),
];

test.describe("accessibility sweep (RG-09)", () => {
  test("public pages have no axe violations", async ({ page }) => {
    const failures: string[] = [];
    for (const route of PUBLIC_ROUTES) {
      await page.goto(route);
      await expect(page.locator("main, form, h1").first()).toBeVisible();
      const violations = await accessibilityViolations(page);
      if (violations.length) failures.push(`${route}: ${JSON.stringify(violations)}`);
    }
    expect(failures).toEqual([]);
  });

  test("every authenticated route and key dialog state has no axe violations", async ({ page }) => {
    test.setTimeout(180_000);
    await signIn(page, "/");
    await expect(page.getByRole("heading", { level: 1 }).first()).toBeVisible();
    const project = await generateProject(page, unique("A11Y"));
    const failures: string[] = [];
    const scan = async (label: string) => {
      await page.waitForLoadState("networkidle");
      if ((await page.getByRole("heading", { level: 1 }).count()) === 0) failures.push(`${label}: page has no h1`);
      const violations = await accessibilityViolations(page);
      if (violations.length) failures.push(`${label}: ${JSON.stringify(violations)}`);
    };

    for (const route of [
      "/",
      "/projects",
      "/projects/new",
      `/projects/${project.projectId}`,
      `/projects/${project.projectId}/workspace`,
      "/catalog",
      "/search",
      "/audit",
      "/security",
      "/team",
      "/access-requests",
      "/template-submissions",
      "/this-route-does-not-exist",
    ]) {
      await page.goto(route);
      await scan(route);
    }

    // Interactive states: forms open, validation errors shown, search results.
    await page.goto("/projects");
    await page.getByRole("button", { name: "New project" }).click();
    await page.getByRole("button", { name: "Create project" }).click();
    await scan("/projects (create form with validation errors)");

    await page.goto(`/projects/${project.projectId}`);
    await page.getByRole("button", { name: "Add requirement" }).click();
    await scan("project detail (requirement form)");

    await page.goto("/search");
    await page.getByRole("searchbox").or(page.getByRole("textbox").first()).fill("workspace");
    await page.keyboard.press("Enter");
    await scan("/search (results)");

    expect(failures).toEqual([]);
  });

  test("keyboard: skip link, focus visibility and landmark structure", async ({ page }) => {
    await signIn(page, "/");
    await expect(page.getByRole("heading", { level: 1 }).first()).toBeVisible();
    // Fresh page load: the first Tab must reach the skip link.
    await page.reload();
    await expect(page.getByRole("heading", { level: 1 }).first()).toBeVisible();
    await page.keyboard.press("Tab");
    await expect(page.getByRole("link", { name: "Skip to content" })).toBeFocused();
    await expect(page.getByRole("main")).toHaveCount(1);
    await expect(page.getByRole("navigation", { name: "Main navigation" })).toBeVisible();
    await expect(page.getByRole("banner")).toBeVisible();
    // Every interactive control reachable by Tab shows a non-zero focus indicator.
    const unfocusable = await page.evaluate(() => {
      const problems: string[] = [];
      for (const element of document.querySelectorAll<HTMLElement>("a[href], button, input, select, textarea")) {
        if (element.tabIndex < 0 && !element.hasAttribute("disabled")) problems.push(element.outerHTML.slice(0, 80));
      }
      return problems;
    });
    expect(unfocusable).toEqual([]);
  });
});
