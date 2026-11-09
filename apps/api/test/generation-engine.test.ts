import { cp, mkdir, mkdtemp, readdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { templateInputValuesSchema, type TemplateManifest } from "@asaa/contracts";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { isUsable, TemplateLibrary, type LibraryTemplate } from "../src/modules/generation/library.js";
import { GenerationError, projectVariables, renderPlan } from "../src/modules/generation/render.js";
import { digestOutput, nodeFs, OutputConflictError, writeOutput } from "../src/modules/generation/writer.js";

const LIBRARY = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../template-library");
const project = projectVariables({ key: "SHOP", name: 'Acme "Shop" <Ltd>', purpose: "Sell things & more" });

let work: string;
beforeEach(async () => {
  work = await mkdtemp(path.join(tmpdir(), "asaa-gen-"));
});
afterEach(async () => {
  await rm(work, { recursive: true, force: true });
});

async function usable(id: string, version = "1.0.0", root = LIBRARY) {
  const template = await new TemplateLibrary(root).get(id, version);
  expect(template?.problems).toEqual([]);
  if (!template || !isUsable(template)) throw new Error(`${id} not usable`);
  return template;
}

function values(template: LibraryTemplate & { manifest: TemplateManifest }, raw: Record<string, unknown>) {
  return templateInputValuesSchema(template.manifest.inputs).parse(raw) as Record<string, string | boolean>;
}

/** Copy one library template into a scratch library so it can be tampered with. */
async function scratchCopy(id: string) {
  const root = path.join(work, "library");
  await cp(path.join(LIBRARY, id), path.join(root, id), { recursive: true });
  const dir = path.join(root, id, "1.0.0");
  const manifestPath = path.join(dir, "manifest.json");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  return {
    root,
    dir,
    manifest,
    saveManifest: (next: unknown) => writeFile(manifestPath, JSON.stringify(next)),
    load: async () => (await new TemplateLibrary(root).get(id, "1.0.0"))!,
  };
}

describe("bundled template library", () => {
  it("loads every bundled starter and template without problems and with stable digests", async () => {
    const all = await new TemplateLibrary(LIBRARY).list();
    expect(all.map((t) => `${t.id}@${t.version}`).sort()).toEqual([
      "landing-page@1.0.0",
      "starter-api-service@1.0.0",
      "starter-blank@1.0.0",
      "starter-web-app@1.0.0",
    ]);
    for (const template of all) expect(template.problems, template.id).toEqual([]);
    const again = await new TemplateLibrary(LIBRARY).list();
    expect(again.map((t) => t.digest)).toEqual(all.map((t) => t.digest));
    expect(await new TemplateLibrary(LIBRARY).starterFor("web-app")).toMatchObject({ id: "starter-web-app" });
  });

  it("refuses unsafe ids and versions instead of joining them into paths", async () => {
    const library = new TemplateLibrary(LIBRARY);
    expect(await library.get("../landing-page", "1.0.0")).toBeNull();
    expect(await library.get("landing-page", "../../etc")).toBeNull();
  });
});

describe("template content validation (library boundary)", () => {
  it("rejects invalid manifests and unsupported manifest versions", async () => {
    const copy = await scratchCopy("landing-page");
    await copy.saveManifest({ ...copy.manifest, manifestVersion: 2 });
    expect((await copy.load()).problems.join(" ")).toMatch(/Unsupported manifest version 2/);
    await writeFile(path.join(copy.dir, "manifest.json"), "{ not json");
    expect((await copy.load()).problems).toEqual(["manifest.json is not valid JSON."]);
  });

  it("rejects templates built for an unsupported generator version", async () => {
    const copy = await scratchCopy("landing-page");
    await copy.saveManifest({ ...copy.manifest, compatibility: { generator: 2 } });
    const template = await copy.load();
    expect(isUsable(template)).toBe(false);
    expect(template.problems.join(" ")).toMatch(/Requires generator 2\.x/);
  });

  it("rejects manifests whose identity does not match the folder", async () => {
    const copy = await scratchCopy("landing-page");
    await copy.saveManifest({ ...copy.manifest, version: "9.9.9" });
    expect((await copy.load()).problems.join(" ")).toMatch(/does not match its folder/);
  });

  it("rejects missing, unlisted and undeclared-placeholder files", async () => {
    const copy = await scratchCopy("landing-page");
    await writeFile(path.join(copy.dir, "files", "extra.txt"), "surprise");
    await writeFile(path.join(copy.dir, "files", "site.json"), '{ "x": "{{secretToken}}" }');
    await rm(path.join(copy.dir, "files", "README.txt"));
    const problems = (await copy.load()).problems.join("\n");
    expect(problems).toMatch(/extra\.txt is not listed/);
    expect(problems).toMatch(/undeclared placeholder "secretToken"/);
    expect(problems).toMatch(/README\.txt is listed but missing/);
  });

  it("rejects symbolic links and junctions that could escape the template", async () => {
    const copy = await scratchCopy("landing-page");
    const outside = path.join(work, "outside");
    await mkdir(outside);
    await writeFile(path.join(outside, "secret.txt"), "do not copy");
    // Junctions need no special privileges on Windows; plain symlinks elsewhere.
    await symlink(outside, path.join(copy.dir, "files", "linked"), process.platform === "win32" ? "junction" : "dir");
    const template = await copy.load();
    expect(isUsable(template)).toBe(false);
    expect(template.problems.join(" ")).toMatch(/symbolic links are not allowed/);
    expect([...template.files.keys()].some((name) => name.includes("secret"))).toBe(false);
  });

  it("rejects oversized files", async () => {
    const copy = await scratchCopy("landing-page");
    await writeFile(path.join(copy.dir, "files", "README.txt"), "x".repeat(600 * 1024));
    expect((await copy.load()).problems.join(" ")).toMatch(/larger than/);
  });

  it("changes the digest when any byte of content changes", async () => {
    const copy = await scratchCopy("landing-page");
    const before = (await copy.load()).digest;
    await writeFile(path.join(copy.dir, "files", "README.txt"), "changed");
    expect((await copy.load()).digest).not.toEqual(before);
  });
});

describe("rendering", () => {
  it("renders deterministically with escaping matched to each file type", async () => {
    const template = await usable("landing-page");
    const input = values(template, {
      headline: "<script>alert(1)</script>",
      tagline: 'He said "hi"\nthen left',
      contactEmail: "hello@acme.test",
    });
    const first = renderPlan(template.manifest, template.files, input, project);
    const second = renderPlan(template.manifest, template.files, input, project);
    expect(first.digest).toEqual(second.digest);
    expect(first.files.map((f) => f.path)).toEqual([
      "README.txt",
      "assets/styles.css",
      "contact.html",
      "index.html",
      "site.json",
    ]);
    const file = (name: string) => first.files.find((f) => f.path === name)!.content.toString("utf8");
    expect(file("index.html")).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(file("index.html")).not.toContain("<script>alert");
    expect(file("index.html")).toContain("Acme &quot;Shop&quot; &lt;Ltd&gt;");
    const site = JSON.parse(file("site.json"));
    expect(site).toMatchObject({
      name: 'Acme "Shop" <Ltd>',
      tagline: 'He said "hi"\nthen left',
      accentColor: "#1d4ed8",
    });
    expect(file("assets/styles.css")).toContain("--accent: #1d4ed8;");
  });

  it("applies conditional files from boolean inputs", async () => {
    const template = await usable("landing-page");
    const plan = renderPlan(
      template.manifest,
      template.files,
      values(template, { headline: "Hi", includeContact: false }),
      project,
    );
    expect(plan.files.map((f) => f.path)).not.toContain("contact.html");
    const web = await usable("starter-web-app");
    const noTests = renderPlan(web.manifest, web.files, values(web, { includeTests: false }), project);
    expect(noTests.files.map((f) => f.path)).not.toContain("src/App.test.ts");
    expect(
      JSON.parse(noTests.files.find((f) => f.path === "package.json")!.content.toString()).scripts.test,
    ).toBeUndefined();
  });

  it("never re-expands placeholders that appear inside values", () => {
    const manifest = {
      ...baseManifest(),
      inputs: [{ id: "note", label: "Note", type: "text", required: false, maxLength: 200 }],
      files: [{ source: "a.txt", target: "a.txt", substitute: "text" }],
    } as unknown as TemplateManifest;
    const plan = renderPlan(
      manifest,
      new Map([["a.txt", Buffer.from("{{note}}|{{projectKey}}")]]),
      { note: "{{projectKey}}" },
      project,
    );
    expect(plan.files[0]!.content.toString()).toBe("{{projectKey}}|SHOP");
  });

  it("rejects path traversal, absolute paths and unsafe names produced by values", () => {
    const manifest = {
      ...baseManifest(),
      inputs: [{ id: "name", label: "Name", type: "string", format: "text", required: true, maxLength: 80 }],
      files: [{ source: "a.txt", target: "src/{{name}}.txt", substitute: "text" }],
    } as unknown as TemplateManifest;
    const files = new Map([["a.txt", Buffer.from("x")]]);
    for (const name of ["../../evil", "..", "/etc/passwd", "C:\\Windows\\x", "a/b", "con", "bad name", "x:y"]) {
      expect(() => renderPlan(manifest, files, { name }, project), name).toThrow(GenerationError);
    }
    expect(renderPlan(manifest, files, { name: "good-name_1" }, project).files[0]!.path).toBe("src/good-name_1.txt");
  });

  it("rejects duplicate output paths, including case-only differences", () => {
    const manifest = {
      ...baseManifest(),
      inputs: [{ id: "name", label: "Name", type: "string", format: "text", required: true, maxLength: 80 }],
      files: [
        { source: "a.txt", target: "readme.txt", substitute: "text" },
        { source: "b.txt", target: "{{name}}.txt", substitute: "text" },
      ],
    } as unknown as TemplateManifest;
    const files = new Map([
      ["a.txt", Buffer.from("a")],
      ["b.txt", Buffer.from("b")],
    ]);
    expect(() => renderPlan(manifest, files, { name: "README" }, project)).toThrow(/Two files would be written/);
  });

  it("enforces size, count and required-output validation", () => {
    const files = new Map([["a.txt", Buffer.from("0123456789")]]);
    const tooBig = { ...baseManifest(), validation: { requiredOutputs: [], maxFiles: 10, maxTotalBytes: 5 } };
    expect(() => renderPlan(tooBig as TemplateManifest, files, {}, project)).toThrow(/allows 5/);
    const missing = {
      ...baseManifest(),
      validation: { requiredOutputs: ["main.txt"], maxFiles: 10, maxTotalBytes: 100 },
    };
    expect(() => renderPlan(missing as TemplateManifest, files, {}, project)).toThrow(/Required output "main.txt"/);
  });
});

describe("writing outputs", () => {
  async function plan() {
    const template = await usable("starter-blank");
    return renderPlan(template.manifest, template.files, values(template, {}), project);
  }
  const id = "00000000-0000-4000-8000-000000000001";

  it("writes an independent output with provenance and a matching on-disk digest", async () => {
    const rendered = await plan();
    const out = await writeOutput(work, "shop", id, rendered, { generationId: id });
    expect((await readdir(out)).sort()).toEqual([
      ".asaa",
      ".editorconfig",
      ".gitignore",
      "README.txt",
      "docs",
      "project.json",
      "src",
    ]);
    expect(JSON.parse(await readFile(path.join(out, ".asaa", "generation.json"), "utf8"))).toEqual({
      generationId: id,
    });
    expect(await digestOutput(work, "shop")).toBe(rendered.digest);
    expect((await readdir(work)).filter((name) => name.startsWith(".staging"))).toEqual([]);
  });

  it("never overwrites or merges into an existing output folder", async () => {
    await mkdir(path.join(work, "shop"));
    await writeFile(path.join(work, "shop", "keep.txt"), "mine");
    await expect(writeOutput(work, "shop", id, await plan(), {})).rejects.toBeInstanceOf(OutputConflictError);
    expect(await readdir(path.join(work, "shop"))).toEqual(["keep.txt"]);
  });

  it("removes the staging folder and leaves no output when a write fails part-way", async () => {
    let writes = 0;
    const failing = {
      ...nodeFs,
      writeFile: (async (...args: Parameters<typeof nodeFs.writeFile>) => {
        if (++writes === 3) throw Object.assign(new Error("disk full"), { code: "ENOSPC" });
        return nodeFs.writeFile(...args);
      }) as typeof nodeFs.writeFile,
    };
    await expect(writeOutput(work, "shop", id, await plan(), {}, failing)).rejects.toThrow("disk full");
    expect(await readdir(work)).toEqual([]);
  });

  it("refuses invalid output names", async () => {
    await expect(writeOutput(work, "../escape", id, await plan(), {})).rejects.toThrow(/Invalid output folder/);
  });

  it("detects tampering with generated files", async () => {
    const rendered = await plan();
    await writeOutput(work, "shop", id, rendered, {});
    await writeFile(path.join(work, "shop", "README.txt"), "edited");
    expect(await digestOutput(work, "shop")).not.toBe(rendered.digest);
  });
});

function baseManifest() {
  return {
    manifestVersion: 1,
    id: "unit",
    version: "1.0.0",
    kind: "template",
    title: "Unit",
    description: "",
    category: "Test",
    technologies: [{ name: "Text", version: "1" }],
    inputs: [],
    files: [{ source: "a.txt", target: "a.txt", substitute: "text" }],
    directories: [],
    dependencies: [],
    compatibility: { generator: 1 },
    license: { spdx: "MIT" },
    provenance: { origin: "local", maintainer: "Test" },
    validation: { requiredOutputs: [], maxFiles: 10, maxTotalBytes: 1000 },
  };
}
