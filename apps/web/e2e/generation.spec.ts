import { expect, test, type Page } from "@playwright/test";
import { expectAccessible, signIn, unique } from "./fixtures";

/** Approve the bundled landing-page template once (idempotent across runs and projects). */
async function ensureLandingApproved(page: Page) {
  await expect(page.getByRole("heading", { level: 1, name: "Template catalog" })).toBeVisible();
  const library = page.getByRole("list", { name: "Library templates" });
  const approve = library.getByRole("button", { name: /Approve Business landing page v1\.0\.0/ });
  await expect(library.getByText("Business landing page")).toBeVisible();
  if (await approve.isVisible()) {
    await approve.click();
    await expect(page.getByText("Business landing page v1.0.0 is approved and active.")).toBeVisible();
  }
  await expect(library.getByText("In catalog")).toBeVisible();
}

test.describe("project initialization (US-E01, US-E02)", () => {
  test("start from an approved template, review, generate and verify provenance", async ({ page }) => {
    await signIn(page, "/catalog");
    await ensureLandingApproved(page);
    await expectAccessible(page);

    await page.getByRole("link", { name: "Use template Business landing page to start a project" }).click();
    await expect(page.getByRole("heading", { level: 1, name: "New project" })).toBeVisible();
    await expect(page.getByRole("radio", { name: /Business landing page/ })).toBeChecked();
    const details = page.getByRole("region", { name: "Template details" });
    await expect(details.getByText("MIT")).toBeVisible();
    await expectAccessible(page);
    await page.getByRole("button", { name: "Continue" }).click();

    const key = unique("SITE");
    await expect(page.getByRole("heading", { name: "Configure the project" })).toBeFocused();
    await page.getByRole("button", { name: "Review" }).click();
    await expect(page.getByText("Some details need attention.")).toBeVisible();
    await page.getByLabel("Project key").fill(key);
    await page.getByLabel("Project name").fill("Acme landing");
    await page.getByLabel("Headline (required)").fill("Ship <faster> & safer");
    await page.getByLabel("Contact email").fill("hello@acme.test");
    await page.getByLabel("Accent colour").fill("not-a-colour");
    await page.getByRole("button", { name: "Review" }).click();
    await expect(page.getByLabel("Accent colour")).toHaveAttribute("aria-invalid", "true");
    await page.getByLabel("Accent colour").fill("#0f766e");
    await expectAccessible(page);
    await page.getByRole("button", { name: "Review" }).click();

    await expect(page.getByRole("heading", { name: "Review before generating" })).toBeVisible();
    const files = page.getByRole("list", { name: "Files to generate" });
    await expect(files.getByText("index.html", { exact: true })).toBeVisible();
    await expect(files.getByText("contact.html")).toBeVisible();
    await expectAccessible(page);
    await page.getByRole("button", { name: "Generate project" }).click();

    await expect(page.getByRole("heading", { name: "Project generated" })).toBeVisible();
    await expect(page.getByText("landing-page@1.0.0")).toBeVisible();
    await expectAccessible(page);
    await page.getByRole("link", { name: "Open project" }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Acme landing" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Generation provenance" })).toBeVisible();
    await page.getByRole("button", { name: "Verify reproducibility" }).click();
    await expect(page.getByText(/Verified: the recorded inputs reproduce the same files/)).toBeVisible();
  });

  test("start from scratch, and refuse a duplicate project key before generating", async ({ page }) => {
    await signIn(page, "/projects");
    await page.getByRole("link", { name: "Initialize project" }).click();
    await page.getByRole("radio", { name: /Start from scratch/ }).check();
    await page.getByRole("button", { name: "Continue" }).click();
    await page.getByRole("radio", { name: /API service/ }).check();
    await page.getByRole("button", { name: "Continue" }).click();

    const key = unique("API");
    await page.getByLabel("Project key").fill(key);
    await page.getByLabel("Project name").fill("Orders API");
    await page.getByLabel("Purpose").fill("Order management service");
    await page.getByLabel("Default port (required)").selectOption("8080");
    await page.getByLabel(/Initial requirements/).fill("List orders\nCreate order");
    await page.getByRole("button", { name: "Review" }).click();
    await expect(page.getByRole("list", { name: "Files to generate" }).getByText("src/server.ts")).toBeVisible();
    await page.getByRole("button", { name: "Generate project" }).click();
    await expect(page.getByRole("heading", { name: "Project generated" })).toBeVisible();
    await page.getByRole("link", { name: "Open project" }).click();
    await expect(page.getByText("List orders")).toBeVisible();
    await expect(page.getByText("starter-api-service@1.0.0")).toBeVisible();

    // Same key again: the review step shows the conflict and generation is blocked.
    await page.goto("/projects/new");
    await page.getByRole("radio", { name: /Start from scratch/ }).check();
    await page.getByRole("button", { name: "Continue" }).click();
    await page.getByRole("radio", { name: /Blank project/ }).check();
    await page.getByRole("button", { name: "Continue" }).click();
    await page.getByLabel("Project key").fill(key);
    await page.getByLabel("Project name").fill("Duplicate");
    await page.getByRole("button", { name: "Review" }).click();
    await expect(page.getByText(`A project with key ${key} already exists.`)).toBeVisible();
    await expect(page.getByRole("button", { name: "Generate project" })).toBeDisabled();
  });
});
