import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter, RouterProvider } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GlobalSearch } from "@/components/GlobalSearch";

const RESULTS = [
  {
    id: "project-1",
    type: "PROJECT",
    title: "Portal workspace",
    subtitle: "PORTAL · active",
    href: "/projects/project-1",
  },
  {
    id: "catalog-1",
    type: "CATALOG",
    title: "Portal starter",
    subtitle: "Starter · active",
    href: "/catalog",
  },
];

let rejectSearch = false;

function renderSearch() {
  const router = createMemoryRouter(
    [
      {
        path: "/",
        element: (
          <>
            <GlobalSearch />
            <p>Home</p>
          </>
        ),
      },
      { path: "/projects/:projectId", element: <h1>Project details</h1> },
      { path: "/catalog", element: <h1>Template catalog</h1> },
    ],
    { initialEntries: ["/"] },
  );
  render(<RouterProvider router={router} />);
  return router;
}

beforeEach(() => {
  rejectSearch = false;
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => {
      if (rejectSearch) throw new Error("Network unavailable");
      return new Response(JSON.stringify({ query: "portal", results: RESULTS }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }),
  );
});

afterEach(() => vi.unstubAllGlobals());

describe("GlobalSearch", () => {
  it("supports arrow-key selection and opens the active result with Enter", async () => {
    const user = userEvent.setup();
    const router = renderSearch();
    const input = screen.getByRole("combobox", {
      name: "Search projects, requirements and templates",
    });

    await user.type(input, "portal");
    const options = await screen.findAllByRole("option");
    expect(options).toHaveLength(2);

    await user.keyboard("{ArrowDown}");
    expect(options[0]).toHaveAttribute("aria-selected", "true");
    expect(input).toHaveAttribute("aria-activedescendant", options[0].id);

    await user.keyboard("{ArrowDown}");
    expect(options[1]).toHaveAttribute("aria-selected", "true");

    await user.keyboard("{ArrowUp}");
    expect(options[0]).toHaveAttribute("aria-selected", "true");

    await user.keyboard("{ArrowDown}");
    await user.keyboard("{Enter}");
    expect(await screen.findByRole("heading", { name: "Template catalog" })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe("/catalog");
  });

  it("closes and clears the search popup with Escape", async () => {
    const user = userEvent.setup();
    renderSearch();
    const input = screen.getByRole("combobox", {
      name: "Search projects, requirements and templates",
    });

    await user.type(input, "portal");
    expect(await screen.findAllByRole("option")).toHaveLength(2);
    await user.keyboard("{Escape}");

    expect(input).toHaveValue("");
    expect(input).toHaveAttribute("aria-expanded", "false");
    await waitFor(() => expect(screen.queryByRole("listbox")).not.toBeInTheDocument());
  });

  it("announces a search failure instead of presenting it as an empty result", async () => {
    rejectSearch = true;
    const user = userEvent.setup();
    renderSearch();
    await user.type(
      screen.getByRole("combobox", {
        name: "Search projects, requirements and templates",
      }),
      "portal",
    );

    expect(await screen.findByRole("status")).toHaveTextContent("Search is unavailable. Try again.");
  });
});
