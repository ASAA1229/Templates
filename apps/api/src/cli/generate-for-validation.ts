/**
 * Writes a generated project to disk without the database, using the same pure pipeline as certification.
 *   tsx src/cli/generate-for-validation.ts --out <dir> --template <id> --version <v> [--inputs <json>]
 * Used by scripts/validate-generated.mjs; exits non-zero on any generation error.
 */
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { templateInputValuesSchema, type TemplateInputValues } from "@asaa/contracts";
import { sampleValues } from "../certification/certify.js";
import { renderWithAdapter } from "../modules/generation/adapters.js";
import { isUsable, TemplateLibrary } from "../modules/generation/library.js";
import { projectVariables } from "../modules/generation/render.js";

const args = process.argv.slice(2);
const option = (name: string) => {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
};
const here = path.dirname(fileURLToPath(import.meta.url));
const out = option("--out");
const id = option("--template");
const version = option("--version");
if (!out || !id || !version) {
  console.error("usage: --out <dir> --template <id> --version <v> [--inputs <json>]");
  process.exit(2);
}

const library = new TemplateLibrary(path.resolve(option("--library") ?? path.join(here, "../../template-library")));
const template = await library.get(id, version);
if (!template || !isUsable(template)) {
  console.error(`Template ${id}@${version} not found or not usable: ${template?.problems.join("; ") ?? "missing"}`);
  process.exit(1);
}
const { manifest } = template;
const overrides = JSON.parse(option("--inputs") ?? "{}") as Record<string, string | boolean>;
const values = templateInputValuesSchema(manifest.inputs).parse({
  ...sampleValues(manifest),
  ...overrides,
}) as TemplateInputValues;
const plan = renderWithAdapter({
  manifest,
  sources: template.files,
  values,
  project: projectVariables({ key: "VALIDATE", name: "Validation sample", purpose: "Generated project validation" }),
});

const root = path.resolve(out);
const inside = (relative: string) => {
  const target = path.resolve(root, relative);
  if (target !== root && !target.startsWith(root + path.sep)) throw new Error(`Unsafe path ${relative}`);
  return target;
};
await mkdir(root, { recursive: true });
for (const directory of plan.directories) await mkdir(inside(directory), { recursive: true });
for (const file of plan.files) {
  const target = inside(file.path);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, file.content);
}
console.log(`Wrote ${plan.files.length} files to ${root}`);
