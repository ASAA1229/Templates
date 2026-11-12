import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter, RouterProvider } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { routes } from "@/App";
import { TemplateInputsForm } from "@/features/generation/TemplateInputsForm";
import { AuthProvider } from "@/lib/auth";

type Handler = (url: string, init: RequestInit) => { status: number; body?: unknown };
let handler: Handler;
const calls: { url: string; init: RequestInit }[] = [];

beforeEach(() => {
  calls.length = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: RequestInit = {}) => {
      calls.push({ url, init });
      const { status, body } = handler(url, init);
      return new Response(JSON.stringify(body ?? {}), { status, headers: { "content-type": "application/json" } });
    }),
  );
});
afterEach(() => vi.unstubAllGlobals());

const OWNER = { id: "o1", email: "owner@asaa.test", displayName: "Owner" };
const base = {
  manifestVersion: 1,
  version: "1.0.0",
  category: "Starter",
  technologies: [{ name: "React", version: "19" }],
  compatibility: { generator: 1, adapter: "file-tree" },
  license: { spdx: "MIT" },
  provenance: { origin: "local", maintainer: "Owner" },
  files: [{ source: "a", target: "package.json" }],
};
const webStarter = {
  ...base,
  id: "starter-web-app",
  kind: "starter",
  projectType: "web-app",
  compatibility: { generator: 1, adapter: "react-vite" },
  blueprint: {
    family: "web-app",
    architecture: "single-page-app",
    runtimes: [{ name: "Node.js", version: "24" }],
    languages: [{ name: "TypeScript", version: "5.9" }],
    frameworks: [{ name: "React", version: "19" }, { name: "Vite", version: "7" }],
    packageManager: "npm",
    databases: [],
    apis: [],
    infrastructure: [{ name: "Static web hosting", version: "1" }],
    operatingSystems: ["cross-platform"],
  },
  title: "Web application",
  description: "React single-page app",
  inputs: [
    {
      id: "nodeVersion",
      label: "Node.js version",
      type: "select",
      required: true,
      default: "24",
      options: [
        { value: "24", label: "Node 24" },
        { value: "22", label: "Node 22" },
      ],
    },
    { id: "includeTests", label: "Include a unit test setup", type: "boolean", default: true },
  ],
};
const landing = {
  ...base,
  id: "landing-page",
  kind: "template",
  title: "Landing page",
  category: "Marketing",
  inputs: [
    { id: "headline", label: "Headline", type: "string", required: true },
    { id: "accentColor", label: "Accent colour", type: "string", format: "color", default: "#1d4ed8" },
  ],
};
const catalogItem = (id: string, title: string, extra: Record<string, unknown> = {}) => ({
  id,
  slug: id,
  title,
  description: "",
  kind: "TEMPLATE",
  category: "Marketing",
  technologies: [],
  tags: [],
  version: "1.0.0",
  lifecycle: "ACTIVE",
  trustStatus: "TRUSTED",
  sourceType: "AUTHORED",
  sourceReference: null,
  license: "MIT",
  ownership: "Owner",
  dependencies: [],
  contentRef: "landing-page",
  contentDigest: "a".repeat(64),
  metadataSchemaVersion: 1,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  rowVersion: 1,
  ...extra,
});
const ELIGIBLE_ID = "11111111-1111-4111-8111-111111111111";
const BLOCKED_ID = "22222222-2222-4222-8222-222222222222";
const OPTIONS = {
  starters: [
    {
      id: "starter-web-app",
      version: "1.0.0",
      projectType: "web-app",
      manifest: webStarter,
      digest: "b".repeat(64),
    },
  ],
  templates: [
    {
      catalogItem: catalogItem(ELIGIBLE_ID, "Landing page"),
      manifest: landing,
      files: [],
      eligible: true,
      reasons: [],
    },
    {
      catalogItem: catalogItem(BLOCKED_ID, "Old portal", { trustStatus: "UNDER_REVIEW", lifecycle: "DRAFT" }),
      manifest: landing,
      files: [],
      eligible: false,
      reasons: ["This template has not been reviewed and trusted."],
    },
  ],
};
const PREVIEW = {
  blueprint: webStarter.blueprint,
  outputDir: "portal",
  files: [{ path: "package.json", bytes: 120 }],
  directories: ["public"],
  totalBytes: 120,
  outputDigest: "c".repeat(64),
  template: { id: "starter-web-app", version: "1.0.0", digest: "b".repeat(64), kind: "starter" },
  conflicts: [] as string[],
};
const GENERATION = {
  id: "33333333-3333-4333-8333-333333333333",
  blueprint: webStarter.blueprint,
  projectId: "44444444-4444-4444-8444-444444444444",
  projectKey: "PORTAL",
  projectName: "Portal",
  mode: "SCRATCH",
  status: "SUCCEEDED",
  templateId: "starter-web-app",
  templateVersion: "1.0.0",
  templateDigest: "b".repeat(64),
  catalogItemId: null,
  generatorVersion: "1.0.0",
  inputs: { nodeVersion: "24", includeTests: true },
  requirements: [],
  inputsHash: "d".repeat(64),
  outputDir: "portal",
  outputDigest: "c".repeat(64),
  files: ["package.json"],
  attempts: 1,
  error: null,
  startedAt: new Date().toISOString(),
  completedAt: new Date().toISOString(),
  version: 2,
};

function renderApp(path: string) {
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  return render(
    <AuthProvider>
      <RouterProvider router={router} />
    </AuthProvider>,
  );
}

const bodyOf = (path: string) => {
  const call = calls.find((entry) => entry.url.endsWith(path) && entry.init.method === "POST");
  return call ? JSON.parse(String(call.init.body)) : undefined;
};

describe("TemplateInputsForm", () => {
  it("renders an accessible control for every manifest input type", () => {
    render(
      <TemplateInputsForm
        inputs={[
          { id: "headline", label: "Headline", type: "string", format: "text", required: true, maxLength: 80 },
          { id: "notes", label: "Notes", type: "text", required: false, maxLength: 200, description: "Optional" },
          { id: "tests", label: "Tests", type: "boolean", required: false },
          {
            id: "size",
            label: "Size",
            type: "select",
            required: false,
            options: [{ value: "s", label: "Small" }],
          },
        ]}
        values={{ headline: "", notes: "", tests: false }}
        errors={{ headline: "Headline is required." }}
        onChange={() => undefined}
      />,
    );
    expect(screen.getByLabelText("Headline (required)")).toHaveAccessibleDescription("Headline is required.");
    expect(screen.getByLabelText("Notes")).toHaveAccessibleDescription("Optional");
    expect(screen.getByRole("checkbox", { name: "Tests" })).not.toBeChecked();
    expect(screen.getByLabelText("Size")).toHaveDisplayValue("Not set");
  });
});

describe("new project wizard", () => {
  beforeEach(() => {
    handler = (url) => {
      if (url.endsWith("/auth/session")) return { status: 200, body: { owner: OWNER } };
      if (url.endsWith("/templates/options")) return { status: 200, body: OPTIONS };
      if (url.endsWith("/generations/preview")) return { status: 200, body: { preview: PREVIEW } };
      if (url.endsWith("/generations")) return { status: 201, body: { generation: GENERATION } };
      return { status: 404, body: {} };
    };
  });

  it("starts from scratch: validates locally, reviews the exact output, then generates", async () => {
    const user = userEvent.setup();
    renderApp("/projects/new");
    await user.click(await screen.findByRole("radio", { name: /Start from scratch/ }));
    await user.click(screen.getByRole("button", { name: /Continue/ }));
    await user.click(screen.getByRole("radio", { name: /Web application/ }));
    await user.click(screen.getByRole("button", { name: /Continue/ }));
    expect(screen.getByRole("heading", { name: "Configure the project" })).toHaveFocus();

    // Shared-contract validation runs before any API call.
    await user.click(screen.getByRole("button", { name: "Review" }));
    expect(screen.getByLabelText("Project key")).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByLabelText("Project name")).toHaveAccessibleDescription(/required/);
    expect(bodyOf("/generations/preview")).toBeUndefined();

    await user.type(screen.getByLabelText("Project key"), "portal");
    await user.type(screen.getByLabelText("Project name"), "Portal");
    await user.selectOptions(screen.getByLabelText("Node.js version (required)"), "22");
    await user.type(screen.getByLabelText(/Initial requirements/), "Sign in\n\nView orders");
    await user.click(screen.getByRole("button", { name: "Review" }));

    expect(await screen.findByRole("heading", { name: "Review before generating" })).toBeInTheDocument();
    expect(bodyOf("/generations/preview")).toEqual({
      mode: "SCRATCH",
      projectType: "web-app",
      starterId: "starter-web-app",
      starterVersion: "1.0.0",
      blueprint: webStarter.blueprint,
      project: { key: "PORTAL", name: "Portal", purpose: "" },
      inputs: { nodeVersion: "22", includeTests: true },
      requirements: ["Sign in", "View orders"],
    });
    expect(within(screen.getByRole("list", { name: "Files to generate" })).getByText("package.json")).toBeVisible();

    await user.click(screen.getByRole("button", { name: /Generate project/ }));
    expect(await screen.findByRole("heading", { name: "Project generated" })).toBeInTheDocument();
    expect(screen.getByText(/starter-web-app@1.0.0/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open project" })).toHaveAttribute(
      "href",
      `/projects/${GENERATION.projectId}`,
    );
  });

  it("only offers eligible templates and shows why others are blocked", async () => {
    const user = userEvent.setup();
    renderApp(`/projects/new?template=${ELIGIBLE_ID}`);
    const blocked = await screen.findByRole("radio", { name: /Old portal/ });
    expect(blocked).toBeDisabled();
    expect(screen.getByText(/Not available: This template has not been reviewed and trusted/)).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: /Landing page/ })).toBeChecked();
    const details = screen.getByRole("region", { name: "Template details" });
    expect(within(details).getByText("MIT")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /Continue/ }));
    expect(screen.getByLabelText("Accent colour")).toHaveValue("#1d4ed8");
  });

  it("returns to configuration with server field errors and blocks generation on conflicts", async () => {
    const user = userEvent.setup();
    let previewCalls = 0;
    handler = (url) => {
      if (url.endsWith("/auth/session")) return { status: 200, body: { owner: OWNER } };
      if (url.endsWith("/templates/options")) return { status: 200, body: OPTIONS };
      if (url.endsWith("/generations/preview")) {
        previewCalls += 1;
        return previewCalls === 1
          ? {
              status: 400,
              body: {
                error: {
                  code: "VALIDATION_FAILED",
                  message: "Check the template configuration.",
                  fields: { "inputs.headline": "Generated file path is unsafe." },
                },
              },
            }
          : { status: 200, body: { preview: { ...PREVIEW, conflicts: ["A project with key SITE already exists."] } } };
      }
      return { status: 404, body: {} };
    };
    renderApp(`/projects/new?template=${ELIGIBLE_ID}`);
    await user.click(await screen.findByRole("button", { name: /Continue/ }));
    await user.type(screen.getByLabelText("Project key"), "SITE");
    await user.type(screen.getByLabelText("Project name"), "Site");
    await user.type(screen.getByLabelText("Headline (required)"), "Hello");
    await user.click(screen.getByRole("button", { name: "Review" }));
    await waitFor(() =>
      expect(screen.getByLabelText("Headline (required)")).toHaveAccessibleDescription(
        "Generated file path is unsafe.",
      ),
    );
    await user.click(screen.getByRole("button", { name: "Review" }));
    expect(await screen.findByText("A project with key SITE already exists.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Generate project/ })).toBeDisabled();
  });

  it("shows a failed generation with a retry action", async () => {
    const user = userEvent.setup();
    const failed = { ...GENERATION, status: "FAILED", error: "Writing the project files failed.", outputDigest: null };
    handler = (url) => {
      if (url.endsWith("/auth/session")) return { status: 200, body: { owner: OWNER } };
      if (url.endsWith("/templates/options")) return { status: 200, body: OPTIONS };
      if (url.endsWith("/generations/preview")) return { status: 200, body: { preview: PREVIEW } };
      if (url.endsWith("/retry")) return { status: 200, body: { generation: { ...GENERATION, attempts: 2 } } };
      if (url.endsWith("/generations")) return { status: 201, body: { generation: failed } };
      return { status: 404, body: {} };
    };
    renderApp("/projects/new");
    await user.click(await screen.findByRole("radio", { name: /Start from scratch/ }));
    await user.click(screen.getByRole("button", { name: /Continue/ }));
    await user.click(screen.getByRole("radio", { name: /Web application/ }));
    await user.click(screen.getByRole("button", { name: /Continue/ }));
    await user.type(screen.getByLabelText("Project key"), "PORTAL");
    await user.type(screen.getByLabelText("Project name"), "Portal");
    await user.click(screen.getByRole("button", { name: "Review" }));
    await user.click(await screen.findByRole("button", { name: /Generate project/ }));
    expect(await screen.findByRole("heading", { name: "Generation failed" })).toBeInTheDocument();
    expect(screen.getByText("Writing the project files failed.")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /Retry generation/ }));
    expect(bodyOf(`/generations/${GENERATION.id}/retry`)).toEqual({ expectedVersion: 2 });
    expect(await screen.findByRole("button", { name: /Verify reproducibility/ })).toBeInTheDocument();
  });
});
