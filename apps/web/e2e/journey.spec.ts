import { expect, test } from "@playwright/test";
import { E2E_OWNER, expectAccessible, signIn, unique } from "./fixtures";

test.describe("owner MVP journey", () => {
  test("sign-in screen is accessible and rejects bad credentials generically", async ({ page }) => {
    await page.goto("/projects");
    await expect(page).toHaveURL(/\/login$/);
    await expectAccessible(page);
    await page.getByLabel("Email").fill(E2E_OWNER.email);
    await page.getByLabel("Password").fill("definitely wrong");
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page.getByRole("alert")).toHaveText("Invalid email or password.");
    await expect(page.getByLabel("Password")).toHaveValue("");
  });

  test("project → requirement → traceability → dashboard evidence", async ({ page }) => {
    await signIn(page, "/projects");
    await expect(page).toHaveURL(/\/projects$/);
    const key = unique("WEB");

    await page.getByRole("button", { name: "New project" }).click();
    await page.getByLabel("Key").fill(key);
    await page.getByLabel("Name").fill("Customer portal");
    await page.getByLabel("Purpose").fill("Self-service portal for customers.");
    await page.getByRole("button", { name: "Create project" }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Customer portal" })).toBeVisible();
    await expectAccessible(page);

    await page.getByRole("button", { name: "Add requirement" }).click();
    const form = page.getByRole("form", { name: "Create requirement" });
    await form.getByLabel("Title").fill("Customer can sign in");
    await form.getByLabel("Status").selectOption("DEVELOPED");
    await form
      .getByLabel(/acceptance criteria/i)
      .fill("Valid credentials open the portal\nInvalid credentials show a generic error");
    await form.getByRole("button", { name: "Create requirement" }).click();
    const requirement = page.getByRole("listitem").filter({ hasText: "Customer can sign in" });
    await expect(requirement.getByText("No test evidence")).toBeVisible();

    await page.getByRole("link", { name: "Dashboard" }).first().click();
    await expect(page.getByText(/REQ-1 is developed but has no passing test evidence/)).toBeVisible();

    await page.goBack();
    await requirement.getByRole("button", { name: /Customer can sign in/ }).click();
    await requirement.getByRole("button", { name: "Add trace link" }).click();
    await requirement.getByLabel("Reference").fill("apps/web/e2e/journey.spec.ts");
    await requirement.getByLabel("Evidence").selectOption("PASSED");
    await requirement.getByRole("button", { name: "Add link" }).click();
    await expect(requirement.getByText("No test evidence")).toHaveCount(0);

    await requirement.getByRole("button", { name: "Edit" }).click();
    await requirement.getByLabel("Status").selectOption("TESTED");
    await requirement.getByLabel("Change note").fill("E2E evidence recorded");
    await requirement.getByRole("button", { name: "Save changes" }).click();
    await expect(requirement.getByText("Tested")).toBeVisible();
    await requirement.getByRole("button", { name: /History/ }).click();
    await expect(requirement.getByText(/v2 .*E2E evidence recorded/)).toBeVisible();

    await page.getByRole("link", { name: "Dashboard" }).first().click();
    await expect(page.getByText(/REQ-1 is developed/)).toHaveCount(0);
    await expectAccessible(page);
  });

  test("archived projects become read-only and can be restored", async ({ page }) => {
    await signIn(page, "/projects?new=1");
    const key = unique("ARC");
    await page.getByLabel("Key").fill(key);
    await page.getByLabel("Name").fill("Archive me");
    await page.getByRole("button", { name: "Create project" }).click();
    await page.getByRole("button", { name: "Archive" }).click();
    await expect(page.getByText(/^Archived .* Restore it to make changes\.$/)).toBeVisible();
    await expect(page.getByRole("button", { name: "Add requirement" })).toHaveCount(0);
    await page.getByRole("button", { name: "Restore" }).click();
    await expect(page.getByRole("button", { name: "Add requirement" })).toBeVisible();
  });

  test("catalog keeps imported source untrusted until reviewed", async ({ page }) => {
    await signIn(page, "/catalog");
    const suffix = unique("x").toLowerCase();
    const slug = `legacy-${suffix}`;
    const title = `Legacy CRM ${suffix}`;
    await page.getByRole("button", { name: "Register item" }).click();
    const form = page.getByRole("form", { name: "Register catalog item" });
    await form.getByLabel("Title").fill(title);
    await form.getByLabel("Slug").fill(slug);
    await form.getByLabel("Category").fill("Business");
    await form.getByLabel("Technologies").fill("node, postgres");
    await form.getByLabel("Source", { exact: true }).selectOption("IMPORTED");
    await expect(form.getByText(/recorded as untrusted/)).toBeVisible();
    await form.getByRole("button", { name: "Register item" }).click();
    await expect(form.getByText("Record where imported source came from.")).toBeVisible();
    await form.getByLabel("Source reference").fill("https://example.invalid/legacy-crm.git");
    await form.getByRole("button", { name: "Register item" }).click();

    const card = page.getByRole("listitem").filter({ hasText: title });
    await expect(card.getByText("Untrusted")).toBeVisible();
    await expect(card.getByRole("button", { name: "Activate" })).toHaveCount(0);
    await card.getByRole("button", { name: "Mark reviewed and trusted" }).click();
    await card.getByRole("button", { name: "Activate" }).click();
    await expect(card.getByText("Active")).toBeVisible();

    await page.getByLabel("Search").fill("postgres");
    await page.getByRole("button", { name: "Search" }).click();
    await expect(page.getByRole("listitem").filter({ hasText: title })).toBeVisible();
    await expectAccessible(page);
  });

  test("security page, audit log and sign-out", async ({ page }) => {
    await signIn(page, "/security");
    await expect(page.getByText("This session")).toBeVisible();
    await expectAccessible(page);
    await page.getByRole("link", { name: "Audit log" }).first().click();
    await expect(page.getByRole("table")).toContainText("auth.login");
    await page.getByLabel("Outcome").selectOption("FAILURE");
    await expect(page.getByRole("table")).toContainText("auth.login");
    await expectAccessible(page);
    await page.getByRole("button", { name: "Sign out" }).click();
    await expect(page).toHaveURL(/\/login$/);
    await page.goto("/projects");
    await expect(page).toHaveURL(/\/login$/);
  });

  test("keyboard users can skip to content", async ({ page }) => {
    await signIn(page, "/");
    await expect(page.getByRole("heading", { name: /Welcome/ })).toBeVisible();
    // Fresh page load: the first Tab must reach the skip link.
    await page.reload();
    await expect(page.getByRole("heading", { name: /Welcome/ })).toBeVisible();
    await page.keyboard.press("Tab");
    const skip = page.getByRole("link", { name: "Skip to content" });
    await expect(skip).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page.locator("main#main")).toBeFocused();
  });
});
