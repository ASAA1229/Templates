import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter, RouterProvider } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SearchPage } from "@/features/search/SearchPage";

const RESULT = {
  id: "project-1",
  type: "PROJECT",
  title: "Portal workspace",
  subtitle: "PORTAL · active",
  href: "/projects/project-1",
};

let saved: { id: string; name: string; query: string; filters: object }[];

function renderPage() {
  const router = createMemoryRouter([{ path: "/search", element: <SearchPage /> }], {
    initialEntries: ["/search"],
  });
  render(<RouterProvider router={router} />);
  return router;
}

beforeEach(() => {
  saved = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/search/saved") && (!init || init.method === "GET")) {
        return new Response(JSON.stringify({ searches: saved }), { status: 200 });
      }
      if (url.endsWith("/search/saved") && init?.method === "POST") {
        const body = JSON.parse(String(init.body)) as { name: string; query: string; filters: object };
        const search = { id: "saved-1", ...body };
        saved = [search];
        return new Response(JSON.stringify({ search }), { status: 201 });
      }
      if (url.includes("/search?")) {
        return new Response(
          JSON.stringify({
            query: "portal",
            filters: { types: ["PROJECT"], sortBy: "updatedAt", sortOrder: "desc", pageSize: 10 },
            page: 1,
            pageSize: 10,
            total: 1,
            hasMore: false,
            truncated: false,
            facets: {
              types: [
                { value: "PROJECT", count: 1 },
                { value: "REQUIREMENT", count: 0 },
                { value: "CATALOG", count: 0 },
              ],
              statuses: ["ACTIVE"],
              categories: [],
            },
            results: [RESULT],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      return new Response("Not found", { status: 404 });
    }),
  );
});

afterEach(() => vi.unstubAllGlobals());

describe("SearchPage", () => {
  it("runs filtered search, renders facets and saves the current query", async () => {
    const user = userEvent.setup();
    renderPage();

    await user.type(screen.getByLabelText("Search terms"), "portal");
    await user.selectOptions(screen.getByLabelText("Module"), "PROJECT");
    await user.click(screen.getByRole("button", { name: "Search" }));

    expect(await screen.findByRole("link", { name: "Portal workspace" })).toBeInTheDocument();
    expect(screen.getByText(/projects\s*:\s*1/)).toBeInTheDocument();

    await user.type(screen.getByLabelText("Name this search"), "Active projects");
    await user.click(screen.getByRole("button", { name: "Save search" }));

    expect(await screen.findByText("Active projects")).toBeInTheDocument();
    await waitFor(() => {
      const requests = vi.mocked(fetch).mock.calls;
      const searchRequest = requests.find(([url]) => String(url).includes("/search?"));
      expect(searchRequest).toBeDefined();
      expect(String(searchRequest?.[0])).toContain("types=PROJECT");
    });
  });
});
