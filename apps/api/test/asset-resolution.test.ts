import { afterAll, beforeEach, describe, expect, it } from "vitest";
import {
  compareVersions,
  parseVersion,
  resolveAssets,
  satisfies,
  type AssetIndex,
  type AssetVersion,
} from "../src/modules/catalog/resolver.js";
import { createHarness } from "./helpers.js";

/** RG-13: reusable asset license, dependency, compatibility and version resolution. */
const asset = (
  name: string,
  version: string,
  dependencies: [string, string][] = [],
  extra: Partial<AssetVersion> = {},
): AssetVersion => ({
  name,
  version,
  license: "MIT",
  lifecycle: "ACTIVE",
  trusted: true,
  dependencies: dependencies.map(([dep, range]) => ({ name: dep, range })),
  ...extra,
});
const indexOf = (...assets: AssetVersion[]): AssetIndex => ({
  versionsOf: (name) => assets.filter((candidate) => candidate.name === name),
});

describe("semantic version ranges", () => {
  it("compares versions and pre-releases", () => {
    const v = (text: string) => parseVersion(text)!;
    expect(compareVersions(v("1.2.3"), v("1.10.0"))).toBeLessThan(0);
    expect(compareVersions(v("1.0.0-beta"), v("1.0.0"))).toBeLessThan(0);
    expect(parseVersion("1.2")).toBeNull();
  });

  it.each([
    ["1.2.3", "1.2.3", true],
    ["1.2.4", "1.2.3", false],
    ["1.4.0", "^1.2.0", true],
    ["2.0.0", "^1.2.0", false],
    ["0.2.5", "^0.2.1", true],
    ["0.3.0", "^0.2.1", false],
    ["1.2.9", "~1.2.3", true],
    ["1.3.0", "~1.2.3", false],
    ["1.9.9", "1.x", true],
    ["2.0.0", "1.x", false],
    ["1.5.0", ">=1.0.0 <2.0.0", true],
    ["2.0.0", ">=1.0.0 <2.0.0", false],
    ["3.0.0", "*", true],
    ["2.0.0-rc.1", "^1.0.0", false],
    ["1.0.0", "not-a-range", false],
  ])("%s satisfies %s -> %s", (version, range, expected) => {
    expect(satisfies(version, range)).toBe(expected);
  });
});

describe("asset resolution", () => {
  it("picks the highest compatible version and orders dependencies first", () => {
    const index = indexOf(
      asset("ui-kit", "1.0.0"),
      asset("ui-kit", "1.4.0", [["tokens", "^2.0.0"]]),
      asset("ui-kit", "2.0.0"),
      asset("tokens", "2.1.0"),
      asset("tokens", "3.0.0"),
    );
    const result = resolveAssets([{ name: "ui-kit", range: "^1.0.0" }], index);
    expect(result.ok).toBe(true);
    expect(result.resolved.map((r) => `${r.name}@${r.version}`)).toEqual(["tokens@2.1.0", "ui-kit@1.4.0"]);
    expect(result.installOrder).toEqual(["tokens", "ui-kit"]);
    expect(result.resolved.find((r) => r.name === "tokens")!.requiredBy).toEqual(["ui-kit"]);
  });

  it("reports failure when the newest version adds an unsatisfiable requirement", () => {
    const index = indexOf(
      asset("app-kit", "1.0.0", [["core", "^1.0.0"]]),
      asset("app-kit", "1.1.0", [["core", "^9.0.0"]]),
      asset("core", "1.2.0"),
    );
    const result = resolveAssets([{ name: "app-kit", range: "^1.0.0" }], index);
    // Version 1.1.0 is chosen first but its requirement cannot be met; the failure is reported, not hidden.
    expect(result.ok).toBe(false);
    expect(result.problems.map((p) => p.code)).toContain("NO_MATCH");
  });

  it("reports missing assets, conflicting requirements and invalid ranges", () => {
    const index = indexOf(
      asset("a", "1.0.0", [["shared", "^1.0.0"]]),
      asset("b", "1.0.0", [["shared", "^2.0.0"]]),
      asset("shared", "1.5.0"),
      asset("shared", "2.5.0"),
    );
    const conflict = resolveAssets(
      [
        { name: "a", range: "*" },
        { name: "b", range: "*" },
      ],
      index,
    );
    expect(conflict.ok).toBe(false);
    expect(conflict.problems.find((p) => p.code === "CONFLICT")!.message).toMatch(
      /a needs \^1\.0\.0; b needs \^2\.0\.0/,
    );
    expect(resolveAssets([{ name: "ghost", range: "*" }], index).problems[0]).toMatchObject({ code: "MISSING" });
    expect(resolveAssets([{ name: "a", range: "banana" }], index).problems[0]).toMatchObject({ code: "INVALID_RANGE" });
  });

  it("detects circular dependencies", () => {
    const index = indexOf(asset("x", "1.0.0", [["y", "*"]]), asset("y", "1.0.0", [["x", "*"]]));
    const result = resolveAssets([{ name: "x", range: "*" }], index);
    expect(result.ok).toBe(false);
    expect(result.problems.find((p) => p.code === "CYCLE")!.message).toMatch(/x -> y -> x|y -> x -> y/);
  });

  it("enforces license policy, trust and lifecycle", () => {
    const index = indexOf(
      asset("copyleft", "1.0.0", [], { license: "GPL-3.0-only" }),
      asset("mystery", "1.0.0", [], { license: "UNKNOWN" }),
      asset("untrusted", "1.0.0", [], { trusted: false }),
      asset("retired", "1.0.0", [], { lifecycle: "RETIRED" }),
      asset("old", "1.0.0", [], { lifecycle: "DEPRECATED" }),
      asset("draft", "1.0.0", [], { lifecycle: "DRAFT" }),
      asset("fine", "1.0.0", [["old", "*"]]),
    );
    const codes = (name: string) => resolveAssets([{ name, range: "*" }], index).problems.map((p) => p.code);
    expect(codes("copyleft")).toEqual(["LICENSE"]);
    expect(codes("mystery")).toEqual(["LICENSE"]);
    expect(codes("untrusted")).toEqual(["UNTRUSTED"]);
    expect(codes("retired")).toEqual(["RETIRED"]);
    expect(codes("draft")).toEqual(["NO_MATCH"]);
    const withDeprecated = resolveAssets([{ name: "fine", range: "*" }], index);
    expect(withDeprecated.ok).toBe(true);
    expect(withDeprecated.problems).toEqual([expect.objectContaining({ code: "DEPRECATED", severity: "warning" })]);
    // An explicit allow-list can approve a reviewed copyleft license.
    const allowed = resolveAssets([{ name: "copyleft", range: "*" }], index, {
      allowedLicenses: ["MIT", "GPL-3.0-only"],
    });
    expect(allowed.ok).toBe(true);
  });

  it("bounds hostile graphs", () => {
    const assets: AssetVersion[] = [];
    for (let i = 0; i < 300; i++) assets.push(asset(`n${i}`, "1.0.0", [[`n${i + 1}`, "*"]]));
    const result = resolveAssets([{ name: "n0", range: "*" }], indexOf(...assets), { maxAssets: 50 });
    expect(result.ok).toBe(false);
    expect(result.problems.some((p) => p.message.includes("exceeds 50"))).toBe(true);
  });
});

describe("catalog resolve API", () => {
  const h = createHarness();
  afterAll(() => h.close());
  beforeEach(async () => {
    await h.reset();
    await h.createOwner();
  });

  it("resolves catalog items and released templates, and requires authentication", async () => {
    const agent = await h.signedIn();
    const create = (
      slug: string,
      version: string,
      dependencies: { name: string; version: string }[],
      license = "MIT",
    ) =>
      agent.post("/api/catalog", {
        slug,
        title: slug,
        kind: "COMPONENT",
        category: "UI",
        version,
        license,
        ownership: "ASAA",
        lifecycle: "ACTIVE",
        dependencies,
      });
    expect((await create("tokens", "1.2.0", [])).status).toBe(201);
    expect((await create("button-kit", "1.0.0", [{ name: "tokens", version: "^1.0.0" }])).status).toBe(201);
    expect((await create("gpl-widget", "1.0.0", [{ name: "tokens", version: "*" }], "GPL-3.0-only")).status).toBe(201);

    const ok = await agent.post("/api/catalog/resolve", { roots: [{ name: "button-kit", range: "^1.0.0" }] });
    expect(ok.status).toBe(200);
    expect(ok.body.resolution).toMatchObject({ ok: true, installOrder: ["tokens", "button-kit"] });

    const license = await agent.post("/api/catalog/resolve", { roots: [{ name: "gpl-widget" }] });
    expect(license.body.resolution.ok).toBe(false);
    expect(license.body.resolution.problems[0].code).toBe("LICENSE");
    const allowed = await agent.post("/api/catalog/resolve", {
      roots: [{ name: "gpl-widget" }],
      allowedLicenses: ["MIT", "GPL-3.0-only"],
    });
    expect(allowed.body.resolution.ok).toBe(true);

    expect((await agent.post("/api/catalog/resolve", { roots: [] })).status).toBe(400);
    expect((await h.agent().post("/api/catalog/resolve", { roots: [{ name: "tokens" }] })).status).toBe(401);
  });
});
