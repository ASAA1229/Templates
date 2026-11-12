import path from "node:path";
import { fileURLToPath } from "node:url";
import { templateInputValuesSchema, type TemplateInputValues } from "@asaa/contracts";
import { describe, expect, it } from "vitest";
import { getGeneratorAdapter, renderWithAdapter } from "../src/modules/generation/adapters.js";
import { isUsable, TemplateLibrary } from "../src/modules/generation/library.js";
import { projectVariables } from "../src/modules/generation/render.js";

const LIBRARY = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../template-library");
const project = projectVariables({ key: "ADAPTER", name: "Adapter test", purpose: "Validate generator dispatch" });

async function renderStarter(id: string) {
  const template = await new TemplateLibrary(LIBRARY).get(id, "1.0.0");
  expect(template?.problems, id).toEqual([]);
  if (!template || !isUsable(template)) throw new Error(`Starter ${id} is not usable.`);
  const values = templateInputValuesSchema(template.manifest.inputs).parse({}) as TemplateInputValues;
  return renderWithAdapter({ manifest: template.manifest, sources: template.files, values, project });
}

describe("generator adapter registry (US-X02)", () => {
  it("dispatches React/Vite starters through the React adapter", async () => {
    const adapter = getGeneratorAdapter("react-vite");
    const plan = await renderStarter("starter-web-app");
    expect(adapter.id).toBe("react-vite");
    expect(plan.files.map((file) => file.path)).toContain("src/main.tsx");
    expect(plan.files.map((file) => file.path)).toContain("package.json");
  });

  it("dispatches Node API starters through the API adapter", async () => {
    const adapter = getGeneratorAdapter("node-api");
    const plan = await renderStarter("starter-api-service");
    expect(adapter.id).toBe("node-api");
    expect(plan.files.map((file) => file.path)).toContain("src/server.ts");
    expect(plan.files.map((file) => file.path)).toContain("package.json");
  });

  it("dispatches blank projects through the blank adapter", async () => {
    const adapter = getGeneratorAdapter("blank");
    const plan = await renderStarter("starter-blank");
    expect(adapter.id).toBe("blank");
    expect(plan.files.map((file) => file.path)).toEqual(
      expect.arrayContaining(["README.txt", "project.json"]),
    );
  });

  it("rejects an adapter/project-family mismatch", async () => {
    const template = await new TemplateLibrary(LIBRARY).get("starter-web-app", "1.0.0");
    if (!template || !isUsable(template)) throw new Error("Web starter is not usable.");
    const values = templateInputValuesSchema(template.manifest.inputs).parse({}) as TemplateInputValues;
    expect(() =>
      renderWithAdapter({
        manifest: {
          ...template.manifest,
          compatibility: { ...template.manifest.compatibility, adapter: "node-api" },
        },
        sources: template.files,
        values,
        project,
      }),
    ).toThrow(/requires a api-service starter/);
  });

  it("rejects a blueprint that does not match its selected adapter", async () => {
    const template = await new TemplateLibrary(LIBRARY).get("starter-web-app", "1.0.0");
    if (!template || !isUsable(template)) throw new Error("Web starter is not usable.");
    const values = templateInputValuesSchema(template.manifest.inputs).parse({}) as TemplateInputValues;
    expect(() =>
      renderWithAdapter({
        manifest: {
          ...template.manifest,
          blueprint: { ...template.manifest.blueprint!, family: "backend-service" },
        },
        sources: template.files,
        values,
        project,
      }),
    ).toThrow(/requires blueprint web-app\\/single-page-app/);
  });

  it("rejects unregistered adapters instead of executing template-provided code", () => {
    expect(() => getGeneratorAdapter("arbitrary-script")).toThrow(/not supported by this platform/);
  });
});
