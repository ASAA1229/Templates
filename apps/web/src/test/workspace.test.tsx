import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter, RouterProvider } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { routes } from "@/App";
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

const PROJECT_ID = "55555555-5555-4555-8555-555555555555";
const SHA = "a".repeat(40);
const POLICY = {
  productionBranch: "main",
  integrationBranch: "dev",
  featurePrefix: "new",
  fixPrefix: "fix",
  testPrefix: "test",
  protectedBranches: ["main", "dev"],
  requireReviewFor: ["main", "dev"],
};
const PROVIDERS = [
  { provider: "LOCAL_GIT", label: "Local Git repository", available: true, note: "Runs on this machine only." },
  { provider: "GITHUB", label: "GitHub", available: false, note: "Planned." },
];
const base = {
  project: { id: PROJECT_ID, key: "SHOP", name: "Shop", archived: false },
  output: { available: true, outputDir: "shop", reason: null },
  git: { available: true, version: "2.55.0", message: null },
  providers: PROVIDERS,
  activity: [],
};
const ENVIRONMENT = {
  environment: {
    spec: {
      schemaVersion: 1,
      tools: [{ name: "git", version: ">=2.28", required: true }],
      packageManager: { name: "none", version: "*" },
      commands: { install: [], dev: [], build: [], test: [] },
      variables: [],
      database: { engine: "none", version: "*" },
      notes: "",
    },
    version: 0,
    source: "inferred",
    updatedAt: null,
  },
};

function renderAt(path: string) {
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  return render(
    <AuthProvider>
      <RouterProvider router={router} />
    </AuthProvider>,
  );
}

function serve(workspace: unknown) {
  handler = (url) => {
    if (url.endsWith("/auth/session"))
      return { status: 200, body: { owner: { id: "o", email: "o@x.test", displayName: "O" } } };
    if (url.endsWith("/workspace/environment")) return { status: 200, body: ENVIRONMENT };
    if (url.endsWith(`/projects/${PROJECT_ID}/workspace`)) return { status: 200, body: { workspace } };
    if (url.endsWith("/workspace/branches")) {
      return {
        status: 201,
        body: { branch: { name: "fix/crash" }, warnings: ["Starting from main because dev does not exist yet."] },
      };
    }
    return { status: 404, body: {} };
  };
}

describe("engineering workspace page", () => {
  it("validates the commit identity before initializing", async () => {
    const user = userEvent.setup();
    serve({ ...base, detection: "none", repository: null, state: null, warnings: [] });
    renderAt(`/projects/${PROJECT_ID}/workspace`);
    const form = await screen.findByRole("form", { name: "Initialize repository" });
    expect(screen.getByText("Not initialized")).toBeInTheDocument();
    await user.click(within(form).getByRole("button", { name: /Initialize repository/ }));
    expect(within(form).getByLabelText("Author email")).toHaveAttribute("aria-invalid", "true");
    expect(calls.some((call) => call.url.endsWith("/workspace/repository"))).toBe(false);
    await user.type(within(form).getByLabelText("Author name"), "Owner");
    await user.type(within(form).getByLabelText("Author email"), "owner@asaa.test");
    await user.click(within(form).getByRole("button", { name: /Initialize repository/ }));
    const post = calls.find((call) => call.url.endsWith("/workspace/repository"));
    expect(JSON.parse(String(post?.init.body))).toEqual({
      identity: { name: "Owner", email: "owner@asaa.test" },
      initialCommit: true,
    });
  });

  it("shows repository state, policy warnings and branch creation results", async () => {
    const user = userEvent.setup();
    serve({
      ...base,
      detection: "registered",
      repository: {
        id: "r1",
        provider: "LOCAL_GIT",
        defaultBranch: "main",
        policy: POLICY,
        identity: { name: "Owner", email: "owner@asaa.test" },
        remote: null,
        adoptedExisting: false,
        initializedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        version: 1,
      },
      state: {
        head: { branch: "main", sha: SHA, detached: false },
        branches: [{ name: "main", sha: SHA, current: true, protected: true, role: "production" }],
        status: { clean: false, entries: [{ path: "README.txt", state: "modified", staged: false }], truncated: false },
        commits: [
          { sha: SHA, author: "Owner", email: "o@x.test", date: new Date().toISOString(), subject: "Initial commit" },
        ],
      },
      warnings: ["You are on the protected branch main."],
    });
    renderAt(`/projects/${PROJECT_ID}/workspace`);
    expect(await screen.findByText("You are on the protected branch main.")).toBeInTheDocument();
    expect(within(screen.getByRole("list", { name: "Changed files" })).getByText("Modified")).toBeInTheDocument();
    expect(within(screen.getByRole("list", { name: "Commits" })).getByText("Initial commit")).toBeInTheDocument();
    expect(within(screen.getByRole("list", { name: "Providers" })).getByText("Planned")).toBeInTheDocument();

    const form = screen.getByRole("form", { name: "Create branch" });
    await user.selectOptions(within(form).getByLabelText("Branch type"), "fix");
    await user.type(within(form).getByLabelText("Topic"), "../escape");
    await user.click(within(form).getByRole("button", { name: /Create branch/ }));
    expect(within(form).getByLabelText("Topic")).toHaveAttribute("aria-invalid", "true");
    await user.clear(within(form).getByLabelText("Topic"));
    await user.type(within(form).getByLabelText("Topic"), "crash");
    expect(within(form).getByText("Creates fix/crash")).toBeInTheDocument();
    await user.click(within(form).getByRole("button", { name: /Create branch/ }));
    expect(await within(form).findByText("Created fix/crash.")).toBeInTheDocument();
    expect(within(form).getByText(/dev does not exist yet/)).toBeInTheDocument();
  });

  it("explains when Git is missing and when there is no project folder", async () => {
    serve({
      ...base,
      git: { available: false, version: null, message: "Git is not installed or not on PATH on the server." },
      detection: "none",
      repository: null,
      state: null,
      warnings: [],
    });
    const { unmount } = renderAt(`/projects/${PROJECT_ID}/workspace`);
    expect(await screen.findByText("Git is unavailable.")).toBeInTheDocument();
    expect(screen.queryByRole("form", { name: "Initialize repository" })).not.toBeInTheDocument();
    unmount();

    serve({
      ...base,
      output: { available: false, outputDir: null, reason: "This project was created without generation." },
      detection: "none",
      repository: null,
      state: null,
      warnings: [],
    });
    renderAt(`/projects/${PROJECT_ID}/workspace`);
    expect(await screen.findByRole("heading", { name: "No project folder yet" })).toBeInTheDocument();
  });
});
