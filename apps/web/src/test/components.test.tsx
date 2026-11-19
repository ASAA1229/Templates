import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter, RouterProvider } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Field, StatusBadge } from "@/components/common";
import { Input } from "@/components/ui";
import { routes } from "@/App";
import { ProjectForm } from "@/features/projects/ProjectForm";
import { RequirementForm } from "@/features/projects/RequirementForm";
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
      return new Response(status === 204 ? null : JSON.stringify(body ?? {}), {
        status,
        headers: { "content-type": "application/json" },
      });
    }),
  );
});
afterEach(() => vi.unstubAllGlobals());

const OWNER = { id: "o1", email: "owner@asaa.test", displayName: "Abhi" };
const EMPTY_DASHBOARD = {
  projects: { total: 0, archived: 0, byStatus: { PLANNING: 0, ACTIVE: 0, ON_HOLD: 0, COMPLETED: 0 } },
  requirements: { total: 0, flaggedForReview: 0, missingVerification: 0, byStatus: {} },
  catalog: { total: 0, untrusted: 0 },
  alerts: [],
  recentActivity: [],
};

function renderApp(path: string) {
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  return render(
    <AuthProvider>
      <RouterProvider router={router} />
    </AuthProvider>,
  );
}

describe("Field", () => {
  it("wires label, hint and error to the control for assistive technology", () => {
    render(
      <Field label="Key" hint="Unique" error="Required">
        <Input />
      </Field>,
    );
    const input = screen.getByLabelText("Key");
    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(input).toHaveAccessibleDescription("Unique Required");
  });

  it("renders readable status labels", () => {
    render(<StatusBadge value="IN_DEVELOPMENT" />);
    expect(screen.getByText("In development")).toBeInTheDocument();
  });
});

describe("authentication flow", () => {
  it("redirects signed-out visitors to sign-in and validates before calling the API", async () => {
    handler = (url) =>
      url.endsWith("/auth/session")
        ? { status: 401, body: { error: { code: "UNAUTHENTICATED", message: "Sign in" } } }
        : { status: 500 };
    renderApp("/projects");
    const submit = await screen.findByRole("button", { name: /sign in/i });
    await userEvent.click(submit);
    expect(await screen.findByText("Enter a valid email address.")).toBeInTheDocument();
    expect(calls.filter((call) => call.url.includes("/auth/login"))).toHaveLength(0);
  });

  it("shows the generic server error and clears the password", async () => {
    handler = (url) =>
      url.endsWith("/auth/session")
        ? { status: 401, body: {} }
        : { status: 401, body: { error: { code: "UNAUTHENTICATED", message: "Invalid email or password." } } };
    renderApp("/login");
    await userEvent.type(await screen.findByLabelText("Email"), "owner@asaa.test");
    await userEvent.type(screen.getByLabelText("Password"), "wrong-password");
    await userEvent.click(screen.getByRole("button", { name: /sign in/i }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Invalid email or password.");
    expect(screen.getByLabelText("Password")).toHaveValue("");
    const login = calls.find((call) => call.url.includes("/auth/login"))!;
    expect((login.init.headers as Record<string, string>)["x-requested-with"]).toBe("asaa-templates");
  });

  it("signs in and lands on the requested page", async () => {
    handler = (url) => {
      if (url.endsWith("/auth/session")) return { status: 401, body: {} };
      if (url.endsWith("/auth/login")) return { status: 200, body: { owner: OWNER } };
      if (url.includes("/dashboard")) return { status: 200, body: EMPTY_DASHBOARD };
      return { status: 404, body: {} };
    };
    renderApp("/");
    await userEvent.type(await screen.findByLabelText("Email"), OWNER.email);
    await userEvent.type(screen.getByLabelText("Password"), "correct horse battery");
    await userEvent.click(screen.getByRole("button", { name: /sign in/i }));
    expect(await screen.findByRole("heading", { name: "Welcome, Abhi" })).toBeInTheDocument();
    expect(await screen.findByText("Nothing here yet")).toBeInTheDocument();
  });
});

describe("application shell", () => {
  beforeEach(() => {
    handler = (url) => {
      if (url.endsWith("/auth/session")) return { status: 200, body: { owner: OWNER } };
      if (url.includes("/dashboard"))
        return {
          status: 500,
          body: { error: { code: "INTERNAL", message: "Database unavailable", requestId: "req-1" } },
        };
      return { status: 404, body: {} };
    };
  });

  it("shows an actionable error state with a request reference and retry", async () => {
    renderApp("/");
    expect(await screen.findByRole("alert")).toHaveTextContent("Database unavailable");
    expect(screen.getByText("Reference: req-1")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /try again/i })).toBeInTheDocument();
  });

  it("opens and closes the mobile navigation with the keyboard", async () => {
    renderApp("/");
    const open = await screen.findByRole("button", { name: "Open menu" });
    await userEvent.click(open);
    expect(screen.getAllByRole("navigation", { name: "Main navigation" })).toHaveLength(2);
    await userEvent.keyboard("{Escape}");
    await waitFor(() => expect(screen.getAllByRole("navigation", { name: "Main navigation" })).toHaveLength(1));
  });

  it("renders a safe not-found page for unknown routes", async () => {
    renderApp("/does-not-exist");
    expect(await screen.findByText("Page not found")).toBeInTheDocument();
  });
});

describe("forms", () => {
  it("validates project input with the shared contract and shows server field errors", async () => {
    const onSubmit = vi.fn().mockRejectedValueOnce(
      Object.assign(
        new (await import("@/lib/api")).ApiError(409, "CONFLICT", "A record with that identifier already exists.", {
          key: "Key taken",
        }),
      ),
    );
    render(<ProjectForm submitLabel="Create project" onSubmit={onSubmit} />);
    await userEvent.click(screen.getByRole("button", { name: "Create project" }));
    expect(screen.getByText("Name is required.")).toBeInTheDocument();
    expect(onSubmit).not.toHaveBeenCalled();

    await userEvent.type(screen.getByLabelText("Key"), "web");
    expect(screen.getByLabelText("Key")).toHaveValue("WEB");
    await userEvent.type(screen.getByLabelText("Name"), "Website");
    await userEvent.click(screen.getByRole("button", { name: "Create project" }));
    expect(onSubmit).toHaveBeenCalledWith({ key: "WEB", name: "Website", purpose: "", status: "PLANNING" });
    expect(await screen.findByText("Key taken")).toBeInTheDocument();
  });

  it("turns acceptance-criteria lines into a list and selects dependencies", async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    const other = {
      id: "11111111-1111-4111-8111-111111111111",
      code: "REQ-1",
      title: "Sign in",
    } as never;
    render(<RequirementForm others={[other]} submitLabel="Create requirement" onSubmit={onSubmit} />);
    await userEvent.type(screen.getByLabelText("Title"), "Dashboard");
    await userEvent.type(screen.getByLabelText(/acceptance criteria/i), "Shows totals{enter}{enter}Shows alerts");
    await userEvent.click(screen.getByRole("checkbox"));
    await userEvent.click(screen.getByRole("button", { name: "Create requirement" }));
    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Dashboard",
        acceptanceCriteria: ["Shows totals", "Shows alerts"],
        dependencyIds: ["11111111-1111-4111-8111-111111111111"],
      }),
    );
  });
});
