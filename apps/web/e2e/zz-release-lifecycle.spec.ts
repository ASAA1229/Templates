import { expect, test, type Page } from "@playwright/test";
import { expectAccessible, signIn, unique } from "./fixtures";

/**
 * RG-06 browser journey: a developer drafts and submits a release, a different person (administrator)
 * approves and releases it, the owner deprecates it. Runs last (file name) because it changes the
 * release state of a shared demo template.
 */
const PASSWORD = "release journey password 2026";

async function loginAs(page: Page, email: string) {
  await page.context().clearCookies();
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("navigation", { name: "Main navigation" })).toBeVisible();
}

test.describe("template release lifecycle (RG-06)", () => {
  test("draft, review, approval by a second person, immutable release and deprecation", async ({ page }) => {
    test.setTimeout(150_000);
    const suffix = unique("r").toLowerCase();
    const developer = `dev-${suffix}@asaa.test`;
    const admin = `admin-${suffix}@asaa.test`;
    // library.ts provides one release-demo version per attempt, so retries start clean.
    const version = `1.0.${test.info().retry}`;

    // Owner provisions the two people through the API.
    await signIn(page, "/");
    await expect(page.getByRole("heading", { level: 1 }).first()).toBeVisible();
    for (const [email, role] of [
      [developer, "DEVELOPER"],
      [admin, "ADMIN"],
    ] as const) {
      const created = await page.request.post("/api/auth/members", {
        headers: { "x-requested-with": "asaa-templates" },
        data: { email, displayName: email.split("@")[0], role, password: PASSWORD },
      });
      expect(created.status()).toBe(201);
    }

    // Developer drafts and submits.
    await loginAs(page, developer);
    await page.goto("/template-releases");
    await expect(page.getByRole("heading", { level: 1, name: "Template releases" })).toBeVisible();
    await page.getByLabel("Template version").selectOption(`release-demo@${version}`);
    await page.getByLabel("Release notes").fill("First certified release");
    await page.getByRole("button", { name: "Create draft" }).click();
    await expect(page.getByText(`Draft created for release-demo@${version}.`)).toBeVisible();
    // Generation also records released rows for other templates, so scope everything to this journey's own row.
    const releases = page
      .getByRole("list", { name: "Releases" })
      .getByRole("listitem")
      .filter({ hasText: `release-demo ${version}` });
    await expect(releases.getByText("draft", { exact: true })).toBeVisible();
    await expectAccessible(page);
    await releases.getByRole("button", { name: `Submit for review release-demo ${version}` }).click();
    await expect(page.getByText("Submitted for review.")).toBeVisible();
    // The author sees no approval controls.
    await expect(releases.getByRole("button", { name: /Approve release-demo/ })).toHaveCount(0);

    // A different person approves and releases.
    await loginAs(page, admin);
    await page.goto("/template-releases");
    await releases.getByRole("button", { name: `Approve release-demo ${version}` }).click();
    await expect(page.getByText("Approved.")).toBeVisible();
    await releases.getByRole("button", { name: `Release release-demo ${version}` }).click();
    await expect(page.getByText("Released. This version is now immutable.")).toBeVisible();
    await expect(releases.getByText("released", { exact: true })).toBeVisible();
    await expectAccessible(page);

    // Released versions can no longer be drafted again.
    await page.getByLabel("Template version").selectOption(`release-demo@${version}`);
    await page.getByRole("button", { name: "Create draft" }).click();
    await expect(page.getByText(/already has a release record/)).toBeVisible();

    // Deprecation needs a reason.
    const deprecate = releases.getByRole("button", { name: `Deprecate release-demo ${version}` });
    await expect(deprecate).toBeDisabled();
    await releases.getByLabel(`Deprecation reason for release-demo ${version}`).fill("Superseded by the next release");
    await deprecate.click();
    await expect(page.getByText("Deprecated.")).toBeVisible();
    await expect(releases.getByText(/Deprecated: Superseded by the next release/)).toBeVisible();
    await expectAccessible(page);
  });
});
