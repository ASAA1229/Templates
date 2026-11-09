import AxeBuilder from "@axe-core/playwright";
import { expect, type Page } from "@playwright/test";
import { E2E_OWNER } from "./global-setup";

export { E2E_OWNER };

export async function signIn(page: Page, path = "/") {
  await page.goto(path);
  await expect(page.getByRole("heading", { name: "Sign in to ASAA Templates" })).toBeVisible();
  await page.getByLabel("Email").fill(E2E_OWNER.email);
  await page.getByLabel("Password").fill(E2E_OWNER.password);
  await page.getByRole("button", { name: "Sign in" }).click();
}

/** Automated WCAG 2.2 A/AA scan (US-B04). Manual assistive-technology testing is still required. */
export async function expectAccessible(page: Page) {
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
    .analyze();
  const summary = results.violations.map((violation) => ({
    id: violation.id,
    impact: violation.impact,
    targets: violation.nodes.slice(0, 3).map((node) => node.target.join(" ")),
  }));
  expect(summary).toEqual([]);
}

export function unique(prefix: string) {
  return `${prefix}${Date.now().toString(36).toUpperCase().slice(-5)}`;
}

/** Generate a scratch project through the API (same session cookies as the page). */
export async function generateProject(page: Page, key: string) {
  const response = await page.request.post("/api/generations", {
    headers: { "x-requested-with": "asaa-templates" },
    data: {
      mode: "SCRATCH",
      projectType: "web-app",
      project: { key, name: `${key} workspace`, purpose: "Workspace journey" },
      inputs: {},
    },
  });
  expect(response.status()).toBe(201);
  return (await response.json()).generation as { projectId: string };
}
