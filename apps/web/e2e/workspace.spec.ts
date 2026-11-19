import { expect, test } from "@playwright/test";
import { expectAccessible, generateProject, signIn, unique } from "./fixtures";

test.describe("engineering workspace (US-F01, US-F02, US-F03)", () => {
  test("initialize Git, follow the branching policy, configure and check the environment", async ({ page }) => {
    await signIn(page, "/projects");
    await expect(page.getByRole("heading", { level: 1, name: "Projects" })).toBeVisible();
    const key = unique("WS");
    const { projectId } = await generateProject(page, key);

    await page.goto(`/projects/${projectId}`);
    await page.getByRole("link", { name: "Engineering workspace" }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Engineering workspace" })).toBeVisible();
    await expect(page.getByText("Not initialized")).toBeVisible();
    await expectAccessible(page);

    const init = page.getByRole("form", { name: "Initialize repository" });
    await init.getByRole("button", { name: "Initialize repository" }).click();
    await expect(init.getByLabel("Author name")).toHaveAttribute("aria-invalid", "true");
    await init.getByLabel("Author name").fill("Workspace Owner");
    await init.getByLabel("Author email").fill("owner@asaa.test");
    await init.getByRole("button", { name: "Initialize repository" }).click();

    await expect(page.getByText("Initialized", { exact: true }).first()).toBeVisible();
    await expect(page.getByText(/You are on the protected branch main/)).toBeVisible();
    const commits = page.getByRole("list", { name: "Commits" });
    await expect(commits.getByText(`Initial commit: ${key} generated from starter-web-app@1.0.0`)).toBeVisible();
    await expect(page.getByText("Working tree is clean.")).toBeVisible();
    await expectAccessible(page);

    const branchForm = page.getByRole("form", { name: "Create branch" });
    await branchForm.getByLabel("Branch type").selectOption("integration");
    await branchForm.getByRole("button", { name: "Create branch" }).click();
    await expect(branchForm.getByText("Created dev.")).toBeVisible();
    await expect(branchForm.getByText(/never merged automatically/)).toBeVisible();

    await branchForm.getByLabel("Branch type").selectOption("feature");
    await branchForm.getByLabel("Topic").fill("login page");
    await branchForm.getByRole("button", { name: "Create branch" }).click();
    await expect(branchForm.getByLabel("Topic")).toHaveAttribute("aria-invalid", "true");
    await branchForm.getByLabel("Topic").fill("login-page");
    await branchForm.getByLabel("Switch to the new branch").check();
    await branchForm.getByRole("button", { name: "Create branch" }).click();
    await expect(branchForm.getByText("Created new/login-page.")).toBeVisible();
    const branches = page.getByRole("list", { name: "Branches" });
    await expect(
      branches.getByRole("listitem").filter({ hasText: "new/login-page" }).getByText("Current"),
    ).toBeVisible();
    await expect(page.getByText(/You are on the protected branch/)).toHaveCount(0);

    const remote = page.getByRole("form", { name: "Remote" });
    await remote.getByLabel("Remote URL (origin)").fill("https://user:secret@github.com/acme/app.git");
    await remote.getByRole("button", { name: "Save remote" }).click();
    await expect(remote.getByText(/Do not put credentials in the URL/)).toBeVisible();
    await remote.getByLabel("Remote URL (origin)").fill("https://github.com/acme/app.git");
    await remote.getByRole("button", { name: "Save remote" }).click();
    await expect(page.getByText("Remote saved.")).toBeVisible();

    const environment = page.getByRole("form", { name: "Environment specification" });
    await expect(page.getByText("Inferred, not saved")).toBeVisible();
    await environment.getByRole("button", { name: "Check this machine" }).click();
    const nodeRow = page.getByRole("row").filter({ hasText: /^node/ });
    await expect(nodeRow.getByText("OK")).toBeVisible();
    await environment.getByRole("button", { name: "Add variable" }).click();
    await environment.getByLabel("Variable 1 name").fill("api_token");
    await environment.getByLabel("Variable 1 description").fill("Token for the upstream API");
    await environment.getByRole("button", { name: "Save environment" }).click();
    await expect(environment.getByText("This looks like a secret; mark it as secret.")).toBeVisible();
    await environment.getByRole("listitem").getByLabel("Secret").check();
    await environment.getByRole("button", { name: "Save environment" }).click();
    await expect(
      page.getByText("Environment specification saved to the platform and the project folder."),
    ).toBeVisible();
    await expect(page.getByText("Saved", { exact: true })).toBeVisible();

    const activity = page.getByRole("list", { name: "Repository activity" });
    await expect(activity.getByText("Branch create").first()).toBeVisible();
    await expectAccessible(page);
  });

  test("browse, edit and compare project files with conflict protection (RG-11)", async ({ page }) => {
    await signIn(page, "/projects");
    await expect(page.getByRole("heading", { level: 1, name: "Projects" })).toBeVisible();
    const { projectId } = await generateProject(page, unique("FL"));
    await page.goto(`/projects/${projectId}/workspace`);
    await expect(page.getByRole("heading", { level: 1, name: "Engineering workspace" })).toBeVisible();

    const files = page.getByRole("navigation", { name: "Project files" });
    await expect(files.getByRole("button", { name: "package.json" })).toBeVisible();
    await files.getByRole("button", { name: "README.txt" }).click();
    const editor = page.getByLabel(/Editing README.txt/);
    await expect(editor).toBeVisible();
    await editor.fill("Edited in the browser.");
    await page.getByRole("button", { name: "Save file" }).click();
    await expect(page.getByText("Saved README.txt.")).toBeVisible();
    await expectAccessible(page);

    // A concurrent change made through the API is detected as a conflict, not overwritten.
    const current = await (
      await page.request.get(`/api/projects/${projectId}/workspace/files/content?path=README.txt`)
    ).json();
    const other = await page.request.put(`/api/projects/${projectId}/workspace/files/content`, {
      headers: { "x-requested-with": "asaa-templates" },
      data: { path: "README.txt", content: "Changed by someone else", expectedSha256: current.sha256 },
    });
    expect(other.status()).toBe(200);
    await editor.fill("My competing edit");
    await page.getByRole("button", { name: "Save file" }).click();
    await expect(page.getByText(/changed since you opened it/)).toBeVisible();
    await page.getByRole("button", { name: "Reload" }).click();
    await expect(editor).toHaveValue("Changed by someone else");
  });

  test("projects without a generated folder explain why there is no workspace", async ({ page }) => {
    await signIn(page, "/projects");
    await expect(page.getByRole("heading", { level: 1, name: "Projects" })).toBeVisible();
    const response = await page.request.post("/api/projects", {
      headers: { "x-requested-with": "asaa-templates" },
      data: { key: unique("PL"), name: "Plain project" },
    });
    const { project } = await response.json();
    await page.goto(`/projects/${project.id}/workspace`);
    await expect(page.getByRole("heading", { name: "No project folder yet" })).toBeVisible();
    await expect(page.getByText(/created without generation/)).toBeVisible();
    await expectAccessible(page);
  });
});
