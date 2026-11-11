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
});
