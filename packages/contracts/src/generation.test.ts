import { describe, expect, it } from "vitest";
import {
  createGenerationSchema,
  fieldErrors,
  placeholdersIn,
  substitutePlaceholders,
  templateInputValuesSchema,
  templateManifestSchema,
  unsafePathReason,
  type TemplateInput,
} from "./index.js";

const manifest = (overrides: Record<string, unknown> = {}) => ({
  manifestVersion: 1,
  id: "landing",
  version: "1.0.0",
  kind: "template",
  title: "Landing",
  category: "Marketing",
  technologies: [{ name: "HTML", version: "5" }],
  inputs: [
    { id: "headline", label: "Headline", type: "string", required: true },
    { id: "withContact", label: "Contact", type: "boolean", default: true },
  ],
  files: [
    { source: "index.html", target: "index.html", substitute: "html" },
    {
      source: "contact.html",
      target: "pages/{{projectSlug}}-contact.html",
      when: { input: "withContact", equals: true },
    },
  ],
  compatibility: { generator: 1 },
  license: { spdx: "MIT" },
  provenance: { origin: "local", maintainer: "Owner" },
  ...overrides,
});

const issues = (value: unknown) => {
  const result = templateManifestSchema.safeParse(value);
  return result.success ? [] : result.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`);
};

describe("template manifest schema", () => {
  it("accepts a valid manifest and applies defaults", () => {
    const parsed = templateManifestSchema.parse(manifest());
    expect(parsed.validation).toEqual({ requiredOutputs: [], maxFiles: 200, maxTotalBytes: 2 * 1024 * 1024 });
    expect(parsed.files[0]!.substitute).toBe("html");
    expect(parsed.files[1]!.substitute).toBe("text");
  });

  it("rejects unsupported manifest versions and starters without a project type", () => {
    expect(issues(manifest({ manifestVersion: 2 }))).toEqual(["manifestVersion: Unsupported manifest version 2."]);
    expect(issues(manifest({ kind: "starter" }))).toEqual([
      "projectType: Starters must declare the project type they implement.",
    ]);
  });

  it("rejects unsafe, reserved and duplicate paths", () => {
    const bad = issues(
      manifest({
        files: [
          { source: "../secret", target: "a.txt" },
          { source: "b", target: "/etc/passwd" },
          { source: "c", target: "x/../../y" },
          { source: "d", target: ".asaa/generation.json" },
          { source: "e", target: "same.txt" },
          { source: "f", target: "same.txt" },
          { source: "g", target: "C:/Windows/x" },
        ],
      }),
    );
    expect(bad).toEqual([
      "files.0.source: Path traversal and empty segments are not allowed.",
      "files.1.target: Absolute paths are not allowed.",
      "files.2.target: Path traversal and empty segments are not allowed.",
      "files.3.target: .asaa/ is reserved for provenance.",
      "files.5.target: Duplicate output path.",
      "files.6.target: Absolute paths are not allowed.",
    ]);
  });

  it("rejects unknown placeholders, reserved or duplicate input ids and bad conditions", () => {
    const bad = issues(
      manifest({
        inputs: [
          { id: "projectKey", label: "Key", type: "string" },
          { id: "dup", label: "A", type: "string" },
          { id: "dup", label: "B", type: "string" },
          { id: "size", label: "Size", type: "select", options: [{ value: "s", label: "S" }], default: "xl" },
        ],
        files: [
          { source: "a", target: "{{unknown}}.txt" },
          { source: "b", target: "b.txt", when: { input: "dup", equals: true } },
          { source: "c", target: "c.txt", when: { input: "size", equals: "m" } },
        ],
      }),
    );
    expect(bad).toEqual([
      'inputs.0.id: "projectKey" is reserved by the platform.',
      'inputs.2.id: Duplicate input "dup".',
      "inputs.3.default: Default must be one of the options.",
      'files.0.target: Unknown placeholder "unknown".',
      "files.1.when.input: Conditions must reference a boolean or select input.",
      "files.2.when.equals: Condition value must be one of the options.",
    ]);
  });

  it("rejects remote provenance; only local content is supported in this phase", () => {
    expect(issues(manifest({ provenance: { origin: "git", maintainer: "x" } })).length).toBe(1);
  });
});

describe("safe paths and substitution", () => {
  it("classifies paths", () => {
    expect(unsafePathReason("src/app/main.ts")).toBeNull();
    expect(unsafePathReason(".gitignore")).toBeNull();
    for (const bad of [
      "",
      "/abs",
      "a\\b",
      "a//b",
      "..",
      "a/./b",
      "nul",
      "aux.txt",
      "a b",
      "x.",
      "a/b:c",
      "é",
      ".git/hooks/post-commit",
      "src/.GIT/config",
    ]) {
      expect(unsafePathReason(bad), bad).not.toBeNull();
    }
    expect(unsafePathReason(Array.from({ length: 13 }, () => "a").join("/"))).toMatch(/12 levels/);
  });

  it("substitutes in a single pass and refuses unknown names", () => {
    expect(placeholdersIn("{{a}} {{ b }} {{a}}")).toEqual(["a", "b"]);
    expect(substitutePlaceholders("{{a}}-{{ b }}", { a: "{{b}}", b: "2" })).toBe("{{b}}-2");
    expect(() => substitutePlaceholders("{{c}}", {})).toThrow(/Unknown placeholder/);
  });
});

describe("template input values", () => {
  const inputs: TemplateInput[] = [
    { id: "headline", label: "Headline", type: "string", format: "text", required: true, maxLength: 20 },
    {
      id: "color",
      label: "Colour",
      type: "string",
      format: "color",
      required: false,
      maxLength: 7,
      default: "#000000",
    },
    { id: "email", label: "Email", type: "string", format: "email", required: false, maxLength: 80 },
    { id: "notes", label: "Notes", type: "text", required: false, maxLength: 100 },
    { id: "tests", label: "Tests", type: "boolean", required: false },
    {
      id: "size",
      label: "Size",
      type: "select",
      required: true,
      options: [
        { value: "s", label: "S" },
        { value: "m", label: "M" },
      ],
    },
  ];
  const schema = templateInputValuesSchema(inputs);

  it("applies defaults for optional values", () => {
    expect(schema.parse({ headline: " Hi ", size: "m" })).toEqual({
      headline: "Hi",
      color: "#000000",
      email: "",
      notes: "",
      tests: false,
      size: "m",
    });
  });

  it("reports required, format, length, injection and unknown-key problems by field", () => {
    const result = schema.safeParse({
      headline: "",
      color: "red",
      email: "not-an-email",
      notes: "{{projectKey}}",
      tests: "yes",
      size: "xl",
      extra: 1,
    });
    expect(result.success).toBe(false);
    const fields = fieldErrors(result.error!);
    expect(fields).toMatchObject({
      headline: "Headline is required.",
      color: "Use a hex colour such as #2563eb.",
      email: "Enter a valid email address.",
      notes: "Curly-brace placeholders are not allowed.",
      tests: "Tests must be yes or no.",
      size: "Choose a size.",
    });
    expect(fields._ ?? Object.values(fields).join(" ")).toMatch(/extra|Unrecognized/i);
    expect(schema.safeParse({ headline: "x".repeat(21), size: "s" }).success).toBe(false);
    expect(schema.safeParse({ headline: "line\nbreak", size: "s" }).success).toBe(false);
    expect(schema.safeParse({ headline: "ok", notes: "multi\nline", size: "s" }).success).toBe(true);
  });
});

describe("generation request", () => {
  it("requires a valid mode, project and template reference", () => {
    const scratch = createGenerationSchema.parse({
      mode: "SCRATCH",
      projectType: "web-app",
      project: { key: "web-1", name: "Web" },
    });
    expect(scratch).toMatchObject({ project: { key: "WEB-1", purpose: "" }, inputs: {}, requirements: [] });
    expect(
      createGenerationSchema.safeParse({ mode: "TEMPLATE", catalogItemId: "x", project: { key: "AB", name: "x" } })
        .success,
    ).toBe(false);
    expect(createGenerationSchema.safeParse({ mode: "CLONE", project: { key: "AB", name: "x" } }).success).toBe(false);
  });
});
