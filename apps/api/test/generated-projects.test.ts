import path from "node:path";
import { fileURLToPath } from "node:url";
import { templateInputValuesSchema, type TemplateInputValues } from "@asaa/contracts";
import { describe, expect, it } from "vitest";
import { sampleValues } from "../src/certification/certify.js";
import { renderWithAdapter } from "../src/modules/generation/adapters.js";
import { isUsable, TemplateLibrary } from "../src/modules/generation/library.js";
import { projectVariables } from "../src/modules/generation/render.js";

const BUNDLED = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../template-library");
const PROJECT = projectVariables({ key: "VALIDATE", name: "Validation sample", purpose: "Generated project check" });

const VARIANTS: { id: string; inputs: Record<string, string | boolean>; requiredScripts: string[] }[] = [
  { id: "starter-web-app", inputs: {}, requiredScripts: ["build", "test"] },
  { id: "starter-web-app", inputs: { includeTests: false }, requiredScripts: ["build"] },
  { id: "starter-web-app", inputs: { nodeVersion: "22" }, requiredScripts: ["build"] },
  { id: "starter-api-service", inputs: {}, requiredScripts: ["build", "start"] },
  { id: "starter-api-service", inputs: { nodeVersion: "22", port: "8080" }, requiredScripts: ["build", "start"] },
];

describe("generated starter projects (static shape; full install/build is scripts/validate-generated.mjs)", () => {
  for (const variant of VARIANTS) {
    it(`${variant.id} ${JSON.stringify(variant.inputs)} has parseable package.json, tsconfig and scripts`, async () => {
      const template = (await new TemplateLibrary(BUNDLED).get(variant.id, "1.0.0"))!;
      expect(isUsable(template)).toBe(true);
      const manifest = template.manifest!;
      const values = templateInputValuesSchema(manifest.inputs).parse({
        ...sampleValues(manifest),
        ...variant.inputs,
      }) as TemplateInputValues;
      const plan = renderWithAdapter({ manifest, sources: template.files, values, project: PROJECT });
      const text = (file: string) => plan.files.find((f) => f.path === file)?.content.toString("utf8");

      const pkg = JSON.parse(text("package.json")!) as { scripts?: Record<string, string> };
      for (const script of variant.requiredScripts) expect(pkg.scripts?.[script], script).toBeTruthy();
      expect(() => JSON.parse(text("tsconfig.json")!)).not.toThrow();
      expect(plan.files.some((f) => /\{\{[^}]*\}\}/.test(f.content.toString("utf8")))).toBe(false);
    });
  }
});
