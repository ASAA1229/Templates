import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createHarness } from "./helpers.js";

const h = createHarness();
afterAll(() => h.close());

describe("global search (US-O01, US-O02)", () => {
  let agent: Awaited<ReturnType<typeof h.signedIn>>;

  beforeEach(async () => {
    await h.reset();
    await h.createOwner();
    agent = await h.signedIn();
  });

  it("searches projects, requirements and catalog without returning unrelated fields", async () => {
    const projectResponse = await agent.post("/api/projects", {
      key: "SEARCH",
      name: "Searchable Portal",
      purpose: "Internal workspace",
    });
    expect(projectResponse.status).toBe(201);
    const projectId = projectResponse.body.project.id as string;

    const requirementResponse = await agent.post("/api/projects/" + projectId + "/requirements", {
      title: "Global search requirement",
      description: "Find project records quickly",
    });
    expect(requirementResponse.status).toBe(201);

    const catalogResponse = await agent.post("/api/catalog", {
      slug: "search-ui-kit",
      title: "Search UI Kit",
      description: "Reusable search components",
      category: "Interface",
      license: "MIT",
      ownership: "ASAA",
      technologies: ["React"],
      tags: ["search"],
    });
    expect(catalogResponse.status).toBe(201);

    const response = await agent.get("/api/search?q=search");
    expect(response.status).toBe(200);
    expect(response.body.query).toBe("search");
    expect(response.body.results).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "PROJECT",
          title: "Searchable Portal",
          href: "/projects/" + projectId,
        }),
        expect.objectContaining({
          type: "REQUIREMENT",
          title: "Global search requirement",
          href: "/projects/" + projectId,
        }),
        expect.objectContaining({ type: "CATALOG", title: "Search UI Kit", href: "/catalog" }),
      ]),
    );
    expect(JSON.stringify(response.body)).not.toContain("passwordHash");
  });

  it("validates query length and requires an authenticated owner", async () => {
    expect((await agent.get("/api/search?q=x")).status).toBe(400);
    expect((await agent.get("/api/search?q=" + "a".repeat(81))).status).toBe(400);
    const anonymous = h.agent();
    expect((await anonymous.get("/api/search?q=valid")).status).toBe(401);
  });

  it("applies module filters, facets, sorting and pagination", async () => {
    await agent.post("/api/projects", { key: "PORTAL-A", name: "Portal Alpha", purpose: "First search result" });
    await agent.post("/api/projects", { key: "PORTAL-B", name: "Portal Beta", purpose: "Second search result" });

    const response = await agent.get(
      "/api/search?q=portal&types=PROJECT&projectStatus=PLANNING&sortBy=title&sortOrder=asc&page=1&pageSize=1",
    );
    expect(response.status).toBe(200);
    expect(response.body.total).toBe(2);
    expect(response.body.results).toHaveLength(1);
    expect(response.body.results[0].title).toBe("Portal Alpha");
    expect(response.body.hasMore).toBe(true);
    expect(response.body.facets.types).toEqual(
      expect.arrayContaining([expect.objectContaining({ value: "PROJECT", count: 2 })]),
    );
    expect(response.body.facets.types).toEqual(
      expect.arrayContaining([expect.objectContaining({ value: "CATALOG", count: 0 })]),
    );
  });

  it("rejects invalid advanced filters", async () => {
    expect((await agent.get("/api/search?q=portal&types=UNKNOWN")).status).toBe(400);
    expect((await agent.get("/api/search?q=portal&page=0")).status).toBe(400);
    expect((await agent.get("/api/search?q=portal&pageSize=100")).status).toBe(400);
  });

  it("creates, lists, renames, updates and deletes owner-scoped saved searches", async () => {
    const input = {
      name: "Active projects",
      query: "portal",
      filters: { types: ["PROJECT"], projectStatus: "ACTIVE", sortBy: "title", sortOrder: "asc", pageSize: 20 },
    };
    const created = await agent.post("/api/search/saved", input);
    expect(created.status).toBe(201);
    expect(created.body.search).toMatchObject({ name: "Active projects", query: "portal" });
    const id = created.body.search.id as string;

    const listed = await agent.get("/api/search/saved");
    expect(listed.status).toBe(200);
    expect(listed.body.searches).toHaveLength(1);
    expect(listed.body.searches[0].id).toBe(id);

    expect((await agent.post("/api/search/saved", input)).status).toBe(409);
    expect((await agent.patch("/api/search/saved/00000000-0000-4000-8000-000000000000", input)).status).toBe(404);

    const updated = await agent.patch("/api/search/saved/" + id, { ...input, name: "Portal projects" });
    expect(updated.status).toBe(200);
    expect(updated.body.search.name).toBe("Portal projects");

    expect((await agent.delete("/api/search/saved/" + id)).status).toBe(204);
    expect((await agent.get("/api/search/saved")).body.searches).toHaveLength(0);
  });
});
