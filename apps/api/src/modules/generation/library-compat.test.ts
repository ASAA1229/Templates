import { readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { adapterProblems } from "./adapters.js";
import { isUsable, TemplateLibrary } from "./library.js";

const root = path.resolve(import.meta.dirname, "..", "..", "..", "template-library");

describe("template compatibility validation", () => {
  it("accepts every shipped template", async () => {
    const library = new TemplateLibrary(root);
    const ids = readdirSync(root, { withFileTypes: true }).filter((e) => e.isDirectory());
    expect(ids.length).toBeGreaterThan(0);
    for (const template of await library.list()) {
      expect(template.problems, `${template.id}@${template.version}`).toEqual([]);
      expect(isUsable(template)).toBe(true);
    }
  });

  it("reports adapter and starter mismatches before generation", async () => {
    const starter = (await new TemplateLibrary(root).list()).find(
      (t) => t.manifest?.compatibility.adapter === "react-vite",
    )!;
    const manifest = starter.manifest!;
    expect(adapterProblems(manifest)).toEqual([]);
    const broken = {
      ...manifest,
      kind: "template" as const,
      validation: { ...manifest.validation, requiredOutputs: [] },
    };
    expect(adapterProblems(broken).join(" ")).toMatch(/requires a web-app starter.*requires "package.json"/s);
  });
});
