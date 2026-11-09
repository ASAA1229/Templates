/**
 * Shared API contracts (US-B06, US-C01, US-C02, US-D01, US-D02).
 *
 * Both the browser and the API validate with these schemas, so client-side
 * feedback and server-side enforcement can never drift apart. The server is
 * always authoritative: it re-validates every request with the same schema.
 */
import { z } from "zod";

export const CONTRACTS_VERSION = 1;

const trimmed = (max: number) => z.string().trim().max(max);
const required = (max: number, label: string) => trimmed(max).min(1, `${label} is required.`);

// ───── Errors ─────

export type ApiErrorCode =
  | "VALIDATION_FAILED"
  | "UNAUTHENTICATED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "CONFLICT"
  | "RATE_LIMITED"
  | "CSRF_REJECTED"
  | "PAYLOAD_TOO_LARGE"
  | "NOT_ELIGIBLE"
  | "UNAVAILABLE"
  | "INTERNAL";

export interface ApiErrorBody {
  error: {
    code: ApiErrorCode;
    message: string;
    requestId?: string;
    fields?: Record<string, string>;
  };
}

/** Flatten zod issues into a field → first message map for forms. */
export function fieldErrors(error: z.ZodError): Record<string, string> {
  const fields: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = issue.path.join(".") || "_";
    fields[key] ??= issue.message;
  }
  return fields;
}

// ───── Auth ─────

export const PASSWORD_MIN = 12;
export const PASSWORD_MAX = 256;

export const passwordSchema = z
  .string()
  .min(PASSWORD_MIN, `Use at least ${PASSWORD_MIN} characters.`)
  .max(PASSWORD_MAX, `Use at most ${PASSWORD_MAX} characters.`);

export const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email("Enter a valid email address.").max(254),
  // Login accepts any non-empty password up to the max; policy applies when setting one.
  password: z.string().min(1, "Password is required.").max(PASSWORD_MAX),
});
export type LoginInput = z.infer<typeof loginSchema>;

export const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1, "Current password is required.").max(PASSWORD_MAX),
    newPassword: passwordSchema,
  })
  .refine((value) => value.currentPassword !== value.newPassword, {
    path: ["newPassword"],
    message: "Choose a password different from the current one.",
  });
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;

export interface OwnerView {
  id: string;
  email: string;
  displayName: string;
}

export interface SessionView {
  id: string;
  createdAt: string;
  lastSeenAt: string;
  expiresAt: string;
  userAgent: string | null;
  current: boolean;
}

// ───── Projects ─────

export const PROJECT_STATUSES = ["PLANNING", "ACTIVE", "ON_HOLD", "COMPLETED"] as const;
export type ProjectStatus = (typeof PROJECT_STATUSES)[number];

export const projectKeySchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z][A-Z0-9-]{1,19}$/, "Use 2–20 letters, digits or hyphens, starting with a letter.");

export const createProjectSchema = z.object({
  key: projectKeySchema,
  name: required(120, "Name"),
  purpose: trimmed(2000).default(""),
  status: z.enum(PROJECT_STATUSES).default("PLANNING"),
});
export type CreateProjectInput = z.input<typeof createProjectSchema>;

export const updateProjectSchema = z.object({
  name: required(120, "Name").optional(),
  purpose: trimmed(2000).optional(),
  status: z.enum(PROJECT_STATUSES).optional(),
  /** Optimistic concurrency: the version the client edited. */
  expectedVersion: z.number().int().positive(),
});
export type UpdateProjectInput = z.infer<typeof updateProjectSchema>;

export const projectListQuerySchema = z.object({
  q: trimmed(120).optional(),
  status: z.enum(PROJECT_STATUSES).optional(),
  archived: z.enum(["exclude", "only", "include"]).default("exclude"),
});

export interface ProjectView {
  id: string;
  key: string;
  name: string;
  purpose: string;
  status: ProjectStatus;
  ownerId: string;
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
  version: number;
  requirementCount?: number;
}

// ───── Requirements ─────

export const REQUIREMENT_KINDS = ["REQUIREMENT", "USER_STORY"] as const;
export const PRIORITIES = ["P0", "P1", "P2"] as const;
/** Delivery states distinguish planned, developed, built, tested and released (US-C04). */
export const REQUIREMENT_STATUSES = [
  "DRAFT",
  "READY",
  "IN_DEVELOPMENT",
  "DEVELOPED",
  "BUILT",
  "TESTED",
  "RELEASED",
] as const;
export const TRACE_KINDS = ["TASK", "CODE_CHANGE", "TEST", "DEFECT", "DOCUMENTATION", "RELEASE"] as const;
export const EVIDENCE_STATUSES = ["PLANNED", "PASSED", "FAILED"] as const;

export type RequirementStatus = (typeof REQUIREMENT_STATUSES)[number];
export type TraceKind = (typeof TRACE_KINDS)[number];

const acceptanceCriteria = z
  .array(required(500, "Acceptance criterion"))
  .max(30, "Use at most 30 acceptance criteria.");

export const createRequirementSchema = z.object({
  kind: z.enum(REQUIREMENT_KINDS).default("USER_STORY"),
  title: required(200, "Title"),
  description: trimmed(5000).default(""),
  priority: z.enum(PRIORITIES).default("P1"),
  status: z.enum(REQUIREMENT_STATUSES).default("DRAFT"),
  acceptanceCriteria: acceptanceCriteria.default([]),
  dependencyIds: z.array(z.string().uuid()).max(30).default([]),
});
export type CreateRequirementInput = z.input<typeof createRequirementSchema>;

export const updateRequirementSchema = z.object({
  title: required(200, "Title").optional(),
  description: trimmed(5000).optional(),
  priority: z.enum(PRIORITIES).optional(),
  status: z.enum(REQUIREMENT_STATUSES).optional(),
  acceptanceCriteria: acceptanceCriteria.optional(),
  dependencyIds: z.array(z.string().uuid()).max(30).optional(),
  changeNote: trimmed(300).optional(),
  expectedVersion: z.number().int().positive(),
});
export type UpdateRequirementInput = z.infer<typeof updateRequirementSchema>;

export const flagRequirementSchema = z.object({
  flagged: z.boolean(),
  reason: trimmed(500).optional(),
});

export const createTraceLinkSchema = z.object({
  kind: z.enum(TRACE_KINDS),
  reference: required(300, "Reference"),
  title: trimmed(200).optional(),
  evidenceStatus: z.enum(EVIDENCE_STATUSES).default("PLANNED"),
});
export type CreateTraceLinkInput = z.input<typeof createTraceLinkSchema>;

export interface TraceLinkView {
  id: string;
  kind: TraceKind;
  reference: string;
  title: string | null;
  evidenceStatus: (typeof EVIDENCE_STATUSES)[number];
  createdAt: string;
}

export interface RequirementView {
  id: string;
  projectId: string;
  code: string;
  kind: (typeof REQUIREMENT_KINDS)[number];
  title: string;
  description: string;
  priority: (typeof PRIORITIES)[number];
  status: RequirementStatus;
  acceptanceCriteria: string[];
  flaggedForReview: boolean;
  flagReason: string | null;
  dependencyIds: string[];
  links: TraceLinkView[];
  /** True when no PASSED test evidence is linked (US-C04). */
  missingVerification: boolean;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface RequirementVersionView {
  version: number;
  changedAt: string;
  changeNote: string | null;
  snapshot: Record<string, unknown>;
}

// ───── Catalog ─────

export const CATALOG_KINDS = ["TEMPLATE", "COMPONENT", "DESIGN_ASSET", "WORKFLOW", "IMPORTED_PROJECT"] as const;
export const LIFECYCLES = ["DRAFT", "ACTIVE", "DEPRECATED", "RETIRED"] as const;
export const TRUST_STATUSES = ["UNTRUSTED", "UNDER_REVIEW", "TRUSTED"] as const;
export const SOURCE_TYPES = ["AUTHORED", "IMPORTED"] as const;
/** Version of the catalog metadata schema below (US-D02). */
export const CATALOG_METADATA_SCHEMA_VERSION = 1;

const slugSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9][a-z0-9-]{1,79}$/, "Use 2–80 lowercase letters, digits or hyphens.");
const tagList = z.array(required(40, "Tag").toLowerCase()).max(20);
const semver = z
  .string()
  .trim()
  .regex(/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/, "Use a semantic version such as 1.0.0.");

export const catalogDependencySchema = z.object({
  name: required(120, "Dependency name"),
  version: required(60, "Dependency version"),
});

export const createCatalogItemSchema = z
  .object({
    slug: slugSchema,
    title: required(160, "Title"),
    description: trimmed(4000).default(""),
    kind: z.enum(CATALOG_KINDS).default("TEMPLATE"),
    category: required(80, "Category"),
    technologies: tagList.default([]),
    tags: tagList.default([]),
    version: semver.default("0.1.0"),
    lifecycle: z.enum(LIFECYCLES).default("DRAFT"),
    sourceType: z.enum(SOURCE_TYPES).default("AUTHORED"),
    sourceReference: trimmed(500).optional(),
    license: required(80, "License"),
    ownership: required(120, "Ownership"),
    dependencies: z.array(catalogDependencySchema).max(100).default([]),
  })
  .superRefine((value, ctx) => {
    // Imported source is untrusted until scanned and reviewed; it cannot be ACTIVE yet.
    if (value.sourceType === "IMPORTED" && value.lifecycle === "ACTIVE") {
      ctx.addIssue({
        code: "custom",
        path: ["lifecycle"],
        message: "Imported items stay non-active until reviewed and trusted.",
      });
    }
    if (value.sourceType === "IMPORTED" && !value.sourceReference) {
      ctx.addIssue({
        code: "custom",
        path: ["sourceReference"],
        message: "Record where imported source came from.",
      });
    }
  });
export type CreateCatalogItemInput = z.input<typeof createCatalogItemSchema>;

export const updateCatalogItemSchema = z.object({
  title: required(160, "Title").optional(),
  description: trimmed(4000).optional(),
  category: required(80, "Category").optional(),
  technologies: tagList.optional(),
  tags: tagList.optional(),
  version: semver.optional(),
  lifecycle: z.enum(LIFECYCLES).optional(),
  trustStatus: z.enum(TRUST_STATUSES).optional(),
  license: required(80, "License").optional(),
  ownership: required(120, "Ownership").optional(),
  dependencies: z.array(catalogDependencySchema).max(100).optional(),
  expectedVersion: z.number().int().positive(),
});
export type UpdateCatalogItemInput = z.infer<typeof updateCatalogItemSchema>;

export const catalogQuerySchema = z.object({
  q: trimmed(120).optional(),
  category: trimmed(80).optional(),
  technology: trimmed(40).toLowerCase().optional(),
  tag: trimmed(40).toLowerCase().optional(),
  lifecycle: z.enum(LIFECYCLES).optional(),
  kind: z.enum(CATALOG_KINDS).optional(),
});

export interface CatalogItemView {
  id: string;
  slug: string;
  title: string;
  description: string;
  kind: (typeof CATALOG_KINDS)[number];
  category: string;
  technologies: string[];
  tags: string[];
  version: string;
  lifecycle: (typeof LIFECYCLES)[number];
  trustStatus: (typeof TRUST_STATUSES)[number];
  sourceType: (typeof SOURCE_TYPES)[number];
  sourceReference: string | null;
  license: string;
  ownership: string;
  dependencies: { name: string; version: string }[];
  /** Approved template content linked to this record (library template id), if any. */
  contentRef: string | null;
  /** SHA-256 of the template content at approval time. */
  contentDigest: string | null;
  metadataSchemaVersion: number;
  createdAt: string;
  updatedAt: string;
  rowVersion: number;
}

// ───── Dashboard and audit ─────

export interface AuditEventView {
  id: string;
  at: string;
  actorType: "OWNER" | "SYSTEM" | "ANONYMOUS";
  action: string;
  targetType: string | null;
  targetId: string | null;
  outcome: "SUCCESS" | "FAILURE" | "DENIED";
  metadata: Record<string, unknown>;
}

export interface DashboardView {
  projects: { total: number; byStatus: Record<ProjectStatus, number>; archived: number };
  requirements: {
    total: number;
    flaggedForReview: number;
    missingVerification: number;
    byStatus: Record<RequirementStatus, number>;
  };
  catalog: { total: number; untrusted: number };
  alerts: { kind: "FLAGGED" | "MISSING_VERIFICATION" | "UNTRUSTED_IMPORT"; message: string; href: string }[];
  recentActivity: AuditEventView[];
}

export const auditQuerySchema = z.object({
  action: trimmed(80).optional(),
  outcome: z.enum(["SUCCESS", "FAILURE", "DENIED"]).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  before: z.string().regex(/^\d+$/).optional(),
});

// ───── Template manifests and project generation (US-E01, US-E02) ─────

/** Version of the template manifest format below. Bump on breaking manifest changes. */
export const TEMPLATE_MANIFEST_VERSION = 1;
/** Generator engine version recorded with every generation; manifests declare the major they target. */
export const GENERATOR_VERSION = "1.0.0";
export const GENERATOR_MAJOR = 1;
/** Folder inside every generated output that holds platform provenance; templates may not write to it. */
export const PROVENANCE_DIR = ".asaa";
/** Values supplied by the platform for every generation; manifests cannot redefine them. */
export const RESERVED_VARIABLES = ["projectKey", "projectName", "projectSlug", "projectPurpose"] as const;
export const PROJECT_TYPES = ["web-app", "api-service", "blank"] as const;
export type ProjectType = (typeof PROJECT_TYPES)[number];
export const TEMPLATE_KINDS = ["template", "starter"] as const;
export const SUBSTITUTION_MODES = ["none", "text", "json", "html"] as const;
export const STRING_FORMATS = ["text", "identifier", "color", "email"] as const;

const PLACEHOLDER_PATTERN = /\{\{\s*([A-Za-z][A-Za-z0-9]*)\s*\}\}/g;

/** Names of every `{{ placeholder }}` in a text, in order of first appearance. */
export function placeholdersIn(text: string): string[] {
  return [...new Set([...text.matchAll(PLACEHOLDER_PATTERN)].map((match) => match[1]!))];
}

/**
 * Single-pass `{{ name }}` substitution. Values are inserted literally and never
 * re-scanned, so a value containing braces cannot trigger further expansion.
 * Unknown names throw instead of rendering silently.
 */
export function substitutePlaceholders(
  text: string,
  values: Record<string, string>,
  escape: (value: string) => string = (value) => value,
): string {
  return text.replace(PLACEHOLDER_PATTERN, (_match, name: string) => {
    const value = values[name];
    if (value === undefined) throw new Error(`Unknown placeholder "${name}".`);
    return escape(value);
  });
}

const WINDOWS_RESERVED = /^(con|prn|aux|nul|com[0-9]|lpt[0-9])(\..*)?$/i;
const SAFE_SEGMENT = /^[A-Za-z0-9._-]{1,100}$/;

/**
 * Validate a generated/relative path: forward slashes only, no absolute paths,
 * drive letters, traversal, empty or reserved segments, or characters outside a
 * portable set. Returns a reason when unsafe, or null when the path is safe.
 */
export function unsafePathReason(candidate: string): string | null {
  if (typeof candidate !== "string" || candidate.length === 0) return "Path is empty.";
  if (candidate.length > 240) return "Path is longer than 240 characters.";
  if (candidate.includes("\\")) return "Use forward slashes in paths.";
  if (candidate.startsWith("/") || /^[A-Za-z]:/.test(candidate)) return "Absolute paths are not allowed.";
  const segments = candidate.split("/");
  if (segments.length > 12) return "Path is nested more than 12 levels deep.";
  for (const segment of segments) {
    if (segment === "" || segment === "." || segment === "..") {
      return "Path traversal and empty segments are not allowed.";
    }
    if (!SAFE_SEGMENT.test(segment)) return `"${segment}" contains characters that are not allowed in file names.`;
    if (segment.endsWith(".")) return `"${segment}" must not end with a dot.`;
    if (WINDOWS_RESERVED.test(segment)) return `"${segment}" is a reserved device name.`;
    // Version-control metadata (hooks, config) must never come from template content.
    if (segment.toLowerCase() === ".git") return "`.git` folders are reserved for version control.";
  }
  return null;
}

const templateIdSchema = z
  .string()
  .regex(/^[a-z0-9][a-z0-9-]{1,79}$/, "Use 2–80 lowercase letters, digits or hyphens.");
const inputIdSchema = z
  .string()
  .regex(/^[a-z][A-Za-z0-9]{0,39}$/, "Input ids start with a lowercase letter and use letters and digits.");
const optionValueSchema = z.string().regex(/^[A-Za-z0-9._-]{1,60}$/, "Option values use letters, digits, . _ or -.");
const versionedNameSchema = z.object({ name: required(80, "Name"), version: required(40, "Version") });

const inputBase = {
  id: inputIdSchema,
  label: required(80, "Label"),
  description: trimmed(300).optional(),
  required: z.boolean().default(false),
};

export const templateInputSchema = z.discriminatedUnion("type", [
  z.object({
    ...inputBase,
    type: z.literal("string"),
    format: z.enum(STRING_FORMATS).default("text"),
    maxLength: z.number().int().min(1).max(200).default(80),
    default: z.string().max(200).optional(),
  }),
  z.object({
    ...inputBase,
    type: z.literal("text"),
    maxLength: z.number().int().min(1).max(2000).default(500),
    default: z.string().max(2000).optional(),
  }),
  z.object({ ...inputBase, type: z.literal("boolean"), default: z.boolean().optional() }),
  z.object({
    ...inputBase,
    type: z.literal("select"),
    options: z
      .array(z.object({ value: optionValueSchema, label: required(80, "Option label") }))
      .min(1)
      .max(30),
    default: optionValueSchema.optional(),
  }),
]);
export type TemplateInput = z.infer<typeof templateInputSchema>;

const templateFileSchema = z.object({
  /** Path of the source file inside the template's files/ folder. */
  source: z.string(),
  /** Output path; may contain `{{ placeholders }}`. */
  target: z.string().max(240),
  /** How placeholder values are escaped in the file content; "none" copies bytes unchanged. */
  substitute: z.enum(SUBSTITUTION_MODES).default("text"),
  /** Include the file only when a boolean/select input has this value. */
  when: z.object({ input: inputIdSchema, equals: z.union([z.string(), z.boolean()]) }).optional(),
});

const DEFAULT_VALIDATION = { requiredOutputs: [] as string[], maxFiles: 200, maxTotalBytes: 2 * 1024 * 1024 };

/**
 * Versioned template manifest (template definition). Catalog records describe a
 * template for discovery; the manifest plus its files/ folder is the template
 * content that generation actually uses.
 */
export const templateManifestSchema = z
  .object({
    manifestVersion: z.number().int(),
    id: templateIdSchema,
    version: z.string().regex(/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/, "Use a semantic version such as 1.0.0."),
    kind: z.enum(TEMPLATE_KINDS),
    title: required(160, "Title"),
    description: trimmed(2000).default(""),
    category: required(80, "Category"),
    /** For starters: the from-scratch project type this starter implements. */
    projectType: z.enum(PROJECT_TYPES).optional(),
    technologies: z.array(versionedNameSchema).min(1).max(20),
    inputs: z.array(templateInputSchema).max(30).default([]),
    files: z.array(templateFileSchema).min(1).max(200),
    directories: z.array(z.string().max(240)).max(50).default([]),
    dependencies: z.array(versionedNameSchema).max(100).default([]),
    compatibility: z.object({ generator: z.number().int().positive(), node: trimmed(40).optional() }),
    license: z.object({ spdx: required(80, "License"), notice: trimmed(1000).optional() }),
    provenance: z.object({
      origin: z.literal("local"),
      maintainer: required(120, "Maintainer"),
      repository: trimmed(300).optional(),
    }),
    validation: z
      .object({
        requiredOutputs: z.array(z.string().max(240)).max(50).default([]),
        maxFiles: z.number().int().min(1).max(500).default(200),
        maxTotalBytes: z
          .number()
          .int()
          .min(1)
          .max(5 * 1024 * 1024)
          .default(2 * 1024 * 1024),
      })
      .default(DEFAULT_VALIDATION),
  })
  .superRefine((manifest, ctx) => {
    const issue = (path: (string | number)[], message: string) => ctx.addIssue({ code: "custom", path, message });
    if (manifest.manifestVersion !== TEMPLATE_MANIFEST_VERSION) {
      issue(["manifestVersion"], `Unsupported manifest version ${manifest.manifestVersion}.`);
    }
    if (manifest.kind === "starter" && !manifest.projectType) {
      issue(["projectType"], "Starters must declare the project type they implement.");
    }
    const inputs = new Map<string, TemplateInput>();
    manifest.inputs.forEach((input, index) => {
      if (inputs.has(input.id)) issue(["inputs", index, "id"], `Duplicate input "${input.id}".`);
      if ((RESERVED_VARIABLES as readonly string[]).includes(input.id)) {
        issue(["inputs", index, "id"], `"${input.id}" is reserved by the platform.`);
      }
      if (input.type === "select" && input.default && !input.options.some((o) => o.value === input.default)) {
        issue(["inputs", index, "default"], "Default must be one of the options.");
      }
      inputs.set(input.id, input);
    });
    const known = new Set<string>([...RESERVED_VARIABLES, ...inputs.keys()]);
    const checkTemplatePath = (value: string, path: (string | number)[]) => {
      for (const name of placeholdersIn(value)) {
        if (!known.has(name)) issue(path, `Unknown placeholder "${name}".`);
      }
      const sample = value.replace(PLACEHOLDER_PATTERN, "x");
      const reason = unsafePathReason(sample);
      if (reason) issue(path, reason);
      else if (sample.split("/")[0] === PROVENANCE_DIR) issue(path, `${PROVENANCE_DIR}/ is reserved for provenance.`);
    };
    const sources = new Set<string>();
    const unconditionalTargets = new Set<string>();
    manifest.files.forEach((file, index) => {
      const reason = unsafePathReason(file.source);
      if (reason) issue(["files", index, "source"], reason);
      if (sources.has(file.source)) issue(["files", index, "source"], "Each source file may be listed once.");
      sources.add(file.source);
      checkTemplatePath(file.target, ["files", index, "target"]);
      if (!file.when) {
        if (unconditionalTargets.has(file.target)) issue(["files", index, "target"], "Duplicate output path.");
        unconditionalTargets.add(file.target);
        return;
      }
      const input = inputs.get(file.when.input);
      if (!input || (input.type !== "boolean" && input.type !== "select")) {
        issue(["files", index, "when", "input"], "Conditions must reference a boolean or select input.");
      } else if (input.type === "boolean" && typeof file.when.equals !== "boolean") {
        issue(["files", index, "when", "equals"], "Boolean conditions compare with true or false.");
      } else if (input.type === "select" && !input.options.some((o) => o.value === file.when!.equals)) {
        issue(["files", index, "when", "equals"], "Condition value must be one of the options.");
      }
    });
    manifest.directories.forEach((dir, index) => checkTemplatePath(dir, ["directories", index]));
    manifest.validation.requiredOutputs.forEach((out, index) =>
      checkTemplatePath(out, ["validation", "requiredOutputs", index]),
    );
  });
export type TemplateManifest = z.infer<typeof templateManifestSchema>;

// eslint-disable-next-line no-control-regex
const CONTROL_CHARS_MULTILINE = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/;
// eslint-disable-next-line no-control-regex
const CONTROL_CHARS_SINGLE_LINE = /[\u0000-\u001F\u007F]/;
const FORMAT_RULES: Record<(typeof STRING_FORMATS)[number], { pattern: RegExp; message: string } | null> = {
  text: null,
  identifier: { pattern: /^[a-z][a-z0-9-]{0,62}$/, message: "Use lowercase letters, digits and hyphens." },
  color: { pattern: /^#[0-9a-fA-F]{6}$/, message: "Use a hex colour such as #2563eb." },
  email: { pattern: /^[^\s@<>"']+@[^\s@<>"']+\.[^\s@<>"']+$/, message: "Enter a valid email address." },
};

/**
 * Build the schema for one template's configuration values from its manifest.
 * Used by the browser for form feedback and by the API as the authority.
 * Unknown keys are rejected; defaults are applied; braces are refused as a
 * defence-in-depth measure against placeholder injection.
 */
export function templateInputValuesSchema(inputs: TemplateInput[]) {
  const shape: Record<string, z.ZodType> = {};
  for (const input of inputs) {
    if (input.type === "boolean") {
      shape[input.id] = z.boolean({ message: `${input.label} must be yes or no.` }).default(input.default ?? false);
      continue;
    }
    if (input.type === "select") {
      const values = input.options.map((option) => option.value) as [string, ...string[]];
      const base = z.enum(values, { message: `Choose a ${input.label.toLowerCase()}.` });
      shape[input.id] =
        input.default !== undefined ? base.default(input.default) : input.required ? base : base.optional();
      continue;
    }
    const controlChars = input.type === "text" ? CONTROL_CHARS_MULTILINE : CONTROL_CHARS_SINGLE_LINE;
    const rule = input.type === "string" ? FORMAT_RULES[input.format] : null;
    const base = z
      .string({ message: `${input.label} is required.` })
      .trim()
      .max(input.maxLength, `Use at most ${input.maxLength} characters.`)
      .refine((value) => !value.includes("{{") && !value.includes("}}"), "Curly-brace placeholders are not allowed.")
      .refine((value) => !controlChars.test(value), "Remove control characters.")
      .refine((value) => !rule || value === "" || rule.pattern.test(value), rule?.message ?? "Invalid value.")
      .refine((value) => !input.required || value.length > 0, `${input.label} is required.`);
    shape[input.id] = input.default !== undefined || !input.required ? base.default(input.default ?? "") : base;
  }
  return z.object(shape).strict();
}
export type TemplateInputValues = Record<string, string | boolean>;

const inputValuesRecord = z
  .record(z.string().max(40), z.union([z.string().max(2000), z.boolean()]))
  .refine((value) => Object.keys(value).length <= 40, "Too many configuration values.")
  .default({});

export const generationProjectSchema = z.object({
  key: projectKeySchema,
  name: required(120, "Name"),
  purpose: trimmed(2000).default(""),
});

export const GENERATION_MODES = ["SCRATCH", "TEMPLATE"] as const;
export const GENERATION_STATUSES = ["PENDING", "SUCCEEDED", "FAILED"] as const;

const initialRequirements = z
  .array(required(200, "Requirement"))
  .max(20, "Add at most 20 initial requirements.")
  .default([]);

export const createGenerationSchema = z.discriminatedUnion("mode", [
  z.object({
    mode: z.literal("SCRATCH"),
    projectType: z.enum(PROJECT_TYPES, { message: "Choose a project type." }),
    project: generationProjectSchema,
    inputs: inputValuesRecord,
    /** Initial requirements captured by the wizard; created as draft user stories. */
    requirements: initialRequirements,
  }),
  z.object({
    mode: z.literal("TEMPLATE"),
    catalogItemId: z.string().uuid("Choose a template."),
    project: generationProjectSchema,
    inputs: inputValuesRecord,
    requirements: initialRequirements,
  }),
]);
export type CreateGenerationInput = z.input<typeof createGenerationSchema>;

export const generationActionSchema = z.object({ expectedVersion: z.number().int().positive() });

export const generationListQuerySchema = z.object({
  projectId: z.string().uuid().optional(),
  status: z.enum(GENERATION_STATUSES).optional(),
});

export interface TemplateSummaryView {
  id: string;
  version: string;
  kind: (typeof TEMPLATE_KINDS)[number] | null;
  title: string;
  description: string;
  category: string;
  projectType: ProjectType | null;
  technologies: { name: string; version: string }[];
  license: string;
  digest: string | null;
  valid: boolean;
  problems: string[];
  /** For library templates: the catalog record linked to this content, if any. */
  catalogItemId: string | null;
  /** The linked catalog record approved exactly this content (digest match). */
  approved: boolean;
}

export interface TemplateOptionView {
  catalogItem: CatalogItemView;
  /** Raw manifest; the browser re-validates it with templateManifestSchema before use. */
  manifest: unknown;
  files: { source: string; target: string }[];
  eligible: boolean;
  reasons: string[];
}

export interface StarterOptionView {
  projectType: ProjectType;
  manifest: unknown;
  digest: string;
}

export interface GenerationPreviewView {
  outputDir: string;
  files: { path: string; bytes: number }[];
  directories: string[];
  totalBytes: number;
  outputDigest: string;
  template: { id: string; version: string; digest: string; kind: (typeof TEMPLATE_KINDS)[number] };
  /** Problems that would stop generation right now (duplicate key, existing output folder). */
  conflicts: string[];
}

export interface GenerationView {
  id: string;
  projectId: string;
  projectKey: string;
  projectName: string;
  mode: (typeof GENERATION_MODES)[number];
  status: (typeof GENERATION_STATUSES)[number];
  templateId: string;
  templateVersion: string;
  templateDigest: string;
  catalogItemId: string | null;
  generatorVersion: string;
  inputs: TemplateInputValues;
  requirements: string[];
  inputsHash: string;
  outputDir: string;
  outputDigest: string | null;
  files: string[];
  attempts: number;
  error: string | null;
  startedAt: string;
  completedAt: string | null;
  version: number;
}

export interface GenerationVerificationView {
  /** Re-rendering the recorded inputs reproduces the recorded output digest. */
  reproducible: boolean;
  /** The files on disk still match the recorded output digest. */
  outputIntact: boolean;
  recordedDigest: string | null;
  renderedDigest: string | null;
  diskDigest: string | null;
  problems: string[];
}

// ───── Engineering workspace: source control and environment (US-F01, US-F02, US-F03) ─────

export const REPOSITORY_PROVIDERS = ["LOCAL_GIT", "GITHUB", "GITLAB", "BITBUCKET"] as const;
export type RepositoryProviderKind = (typeof REPOSITORY_PROVIDERS)[number];
export const BRANCH_KINDS = ["integration", "feature", "fix", "test"] as const;
export type BranchKind = (typeof BRANCH_KINDS)[number];

/**
 * Strict, portable branch-name rule (a subset of git check-ref-format): lowercase
 * letters, digits, ".", "_", "-" and "/" separators; no leading "-" (option
 * injection), no "..", "//", "@{", ".lock" or trailing "/" or ".". Returns a
 * reason when invalid, or null.
 */
export function branchNameProblem(name: string): string | null {
  if (typeof name !== "string" || name.length === 0) return "Branch name is required.";
  if (name.length > 100) return "Use at most 100 characters.";
  if (!/^[a-z0-9][a-z0-9._/-]*$/.test(name)) {
    return "Use lowercase letters, digits, '.', '_', '-' and '/', starting with a letter or digit.";
  }
  if (name.includes("..") || name.includes("//") || name.includes("@{")) return "Branch name contains '..' or '//'.";
  if (name.endsWith("/") || name.endsWith(".") || name.endsWith(".lock")) {
    return "Branch name cannot end with '/', '.' or '.lock'.";
  }
  if (name.split("/").some((segment) => segment.startsWith("."))) return "Path segments cannot start with '.'.";
  if (name === "head") return "'head' is reserved.";
  return null;
}

export const branchNameSchema = z
  .string()
  .trim()
  .superRefine((value, ctx) => {
    const problem = branchNameProblem(value);
    if (problem) ctx.addIssue({ code: "custom", message: problem });
  });
const branchPrefixSchema = z
  .string()
  .trim()
  .regex(/^[a-z][a-z0-9-]{0,19}$/, "Use 1–20 lowercase letters, digits or hyphens.");
export const branchTopicSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9][a-z0-9._-]{0,59}$/, "Use lowercase letters, digits, '.', '_' or '-' (max 60).")
  .refine((value) => !value.includes("..") && !value.endsWith(".") && !value.endsWith(".lock"), {
    message: "Topic cannot contain '..' or end with '.' or '.lock'.",
  });

/**
 * Project branching policy, defaulting to the platform convention:
 * main = production, dev = integration, new/fix/test = work branches.
 * Merges are never automated; protection is advisory for local repositories
 * and enforced by the hosting provider where supported.
 */
export const branchPolicySchema = z
  .object({
    productionBranch: branchNameSchema.default("main"),
    integrationBranch: branchNameSchema.default("dev"),
    featurePrefix: branchPrefixSchema.default("new"),
    fixPrefix: branchPrefixSchema.default("fix"),
    testPrefix: branchPrefixSchema.default("test"),
    protectedBranches: z.array(branchNameSchema).max(10).default(["main", "dev"]),
    requireReviewFor: z.array(branchNameSchema).max(10).default(["main", "dev"]),
  })
  .superRefine((policy, ctx) => {
    if (policy.productionBranch === policy.integrationBranch) {
      ctx.addIssue({ code: "custom", path: ["integrationBranch"], message: "Use a different branch from production." });
    }
    const prefixes = [policy.featurePrefix, policy.fixPrefix, policy.testPrefix];
    if (new Set(prefixes).size !== prefixes.length) {
      ctx.addIssue({ code: "custom", path: ["fixPrefix"], message: "Work branch prefixes must be different." });
    }
    if (prefixes.includes(policy.productionBranch) || prefixes.includes(policy.integrationBranch)) {
      ctx.addIssue({
        code: "custom",
        path: ["featurePrefix"],
        message: "Work prefixes cannot reuse the production or integration branch name.",
      });
    }
    if (!policy.protectedBranches.includes(policy.productionBranch)) {
      ctx.addIssue({
        code: "custom",
        path: ["protectedBranches"],
        message: "The production branch must stay protected.",
      });
    }
  });
export type BranchPolicy = z.infer<typeof branchPolicySchema>;
export const DEFAULT_BRANCH_POLICY: BranchPolicy = branchPolicySchema.parse({});

// eslint-disable-next-line no-control-regex
const NO_CONTROL = /^[^\u0000-\u001F\u007F]*$/;
export const gitIdentitySchema = z.object({
  name: required(100, "Name")
    .regex(NO_CONTROL, "Remove control characters.")
    .refine((value) => !/[<>]/.test(value), "Name cannot contain < or >."),
  email: z.string().trim().toLowerCase().email("Enter a valid email address.").max(254),
});
export type GitIdentity = z.infer<typeof gitIdentitySchema>;

/**
 * Remote URLs are recorded for later use only; nothing is pushed or fetched.
 * Only https:// or scp-style SSH URLs without embedded credentials are allowed,
 * which rules out file://, ext:: and other local or command transports.
 */
export function remoteUrlProblem(url: string): string | null {
  if (url.length > 500) return "Use at most 500 characters.";
  if (/\s/.test(url) || !NO_CONTROL.test(url)) return "Remote URL cannot contain spaces or control characters.";
  if (url.startsWith("-")) return "Remote URL cannot start with '-'.";
  const ssh = /^git@[A-Za-z0-9.-]+:[A-Za-z0-9._~/-]+$/;
  if (ssh.test(url)) return url.includes("..") ? "Remote path cannot contain '..'." : null;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return "Use an https:// URL or git@host:owner/repo.git.";
  }
  if (parsed.protocol !== "https:") return "Only https:// and SSH (git@host:path) remotes are allowed.";
  if (parsed.username || parsed.password)
    return "Do not put credentials in the URL; configure them outside the platform.";
  if (parsed.search || parsed.hash) return "Remote URL cannot contain a query or fragment.";
  return null;
}

export const remoteUrlSchema = z
  .string()
  .trim()
  .superRefine((value, ctx) => {
    const problem = remoteUrlProblem(value);
    if (problem) ctx.addIssue({ code: "custom", message: problem });
  });

export const initRepositorySchema = z.object({
  identity: gitIdentitySchema,
  policy: branchPolicySchema.default(DEFAULT_BRANCH_POLICY),
  /** Commit the generated files as the first commit on the production branch. */
  initialCommit: z.boolean().default(true),
});
export type InitRepositoryInput = z.input<typeof initRepositorySchema>;

export const createBranchSchema = z.object({
  kind: z.enum(BRANCH_KINDS, { message: "Choose a branch type." }),
  /** Optional topic for work branches: new/<topic>, fix/<topic>, test/<topic>. */
  topic: branchTopicSchema.optional().or(z.literal("").transform(() => undefined)),
  /** Existing branch to start from; defaults per policy. */
  from: branchNameSchema.optional(),
  switchTo: z.boolean().default(false),
});
export type CreateBranchInput = z.input<typeof createBranchSchema>;

export const updateIdentitySchema = z.object({
  identity: gitIdentitySchema,
  expectedVersion: z.number().int().positive(),
});
export const updatePolicySchema = z.object({
  policy: branchPolicySchema,
  expectedVersion: z.number().int().positive(),
});
export const updateRemoteSchema = z.object({
  url: remoteUrlSchema.nullable(),
  expectedVersion: z.number().int().positive(),
});

export interface RepositoryCapabilitiesView {
  provider: RepositoryProviderKind;
  label: string;
  available: boolean;
  initialize: boolean;
  status: boolean;
  branches: boolean;
  history: boolean;
  /** "configure-only": remotes are recorded but nothing is transmitted. */
  remotes: "none" | "configure-only" | "sync";
  pullRequests: boolean;
  /** "advisory": warnings only; "enforced": provider rejects disallowed changes. */
  branchProtection: "advisory" | "enforced";
  note: string;
}

export interface RepositoryRecordView {
  id: string;
  provider: RepositoryProviderKind;
  defaultBranch: string;
  policy: BranchPolicy;
  identity: GitIdentity;
  remote: { name: string; url: string } | null;
  adoptedExisting: boolean;
  initializedAt: string;
  updatedAt: string;
  version: number;
}

export const WORKING_TREE_STATES = [
  "added",
  "modified",
  "deleted",
  "renamed",
  "untracked",
  "conflicted",
  "typechange",
] as const;

export interface WorkingTreeEntryView {
  path: string;
  state: (typeof WORKING_TREE_STATES)[number];
  staged: boolean;
  from?: string;
}

export interface BranchView {
  name: string;
  sha: string;
  current: boolean;
  protected: boolean;
  role: "production" | "integration" | "feature" | "fix" | "test" | "other";
}

export interface CommitView {
  sha: string;
  author: string;
  email: string;
  date: string;
  subject: string;
}

export interface RepositoryStateView {
  head: { branch: string | null; sha: string | null; detached: boolean };
  branches: BranchView[];
  status: { clean: boolean; entries: WorkingTreeEntryView[]; truncated: boolean };
  commits: CommitView[];
}

export interface WorkspaceView {
  project: { id: string; key: string; name: string; archived: boolean };
  output: { available: boolean; outputDir: string | null; reason: string | null };
  git: { available: boolean; version: string | null; message: string | null };
  providers: RepositoryCapabilitiesView[];
  /** none: no repository; existing: a .git folder exists but is not registered; registered: tracked by the platform. */
  detection: "none" | "existing" | "registered" | "missing" | "unsafe";
  repository: RepositoryRecordView | null;
  state: RepositoryStateView | null;
  warnings: string[];
  activity: AuditEventView[];
}

export interface BranchCreateResultView {
  branch: BranchView;
  warnings: string[];
}

// ───── Reproducible environment specification (US-F03) ─────

export const ENVIRONMENT_TOOLS = ["node", "npm", "pnpm", "yarn", "git", "postgresql", "docker"] as const;
export type EnvironmentTool = (typeof ENVIRONMENT_TOOLS)[number];
export const PACKAGE_MANAGERS = ["npm", "pnpm", "yarn", "none"] as const;
export const DATABASE_ENGINES = ["none", "postgresql"] as const;

/** "*", "24", "24.x", "24.1", "24.1.2" or ">=22[.1[.0]]". */
export const versionRequirementSchema = z
  .string()
  .trim()
  .regex(/^(\*|(>=)?\d{1,3}(\.\d{1,3}){0,2}|\d{1,3}\.x)$/, 'Use a version such as 24, 24.x, >=22 or "*".');

const commandLines = z.array(trimmed(300).min(1).regex(NO_CONTROL, "Remove control characters.")).max(20).default([]);

const SECRET_NAME = /(SECRET|TOKEN|PASSWORD|PASSWD|PRIVATE|API_?KEY|CREDENTIAL)/;

export const environmentVariableSchema = z
  .object({
    name: z
      .string()
      .trim()
      .regex(/^[A-Z][A-Z0-9_]{0,63}$/, "Use UPPER_SNAKE_CASE (max 64)."),
    description: trimmed(300).default(""),
    required: z.boolean().default(false),
    /** Secret values are never stored; only the name and description are recorded. */
    secret: z.boolean().default(false),
    /** Non-secret example value, e.g. a port or local URL without credentials. */
    example: trimmed(200).regex(NO_CONTROL, "Remove control characters.").default(""),
  })
  .superRefine((variable, ctx) => {
    if (variable.secret && variable.example) {
      ctx.addIssue({ code: "custom", path: ["example"], message: "Secret variables cannot have an example value." });
    }
    if (!variable.secret && SECRET_NAME.test(variable.name)) {
      ctx.addIssue({ code: "custom", path: ["secret"], message: "This looks like a secret; mark it as secret." });
    }
    if (/:\/\/[^/\s:@]+:[^/\s@]+@/.test(variable.example)) {
      ctx.addIssue({ code: "custom", path: ["example"], message: "Examples cannot contain credentials." });
    }
  });

export const environmentSpecSchema = z
  .object({
    schemaVersion: z.literal(1).default(1),
    tools: z
      .array(
        z.object({
          name: z.enum(ENVIRONMENT_TOOLS),
          version: versionRequirementSchema,
          required: z.boolean().default(true),
        }),
      )
      .max(ENVIRONMENT_TOOLS.length)
      .default([]),
    packageManager: z
      .object({ name: z.enum(PACKAGE_MANAGERS), version: versionRequirementSchema.default("*") })
      .default({ name: "none", version: "*" }),
    commands: z
      .object({ install: commandLines, dev: commandLines, build: commandLines, test: commandLines })
      .default({ install: [], dev: [], build: [], test: [] }),
    variables: z.array(environmentVariableSchema).max(50).default([]),
    database: z
      .object({ engine: z.enum(DATABASE_ENGINES), version: versionRequirementSchema.default("*") })
      .default({ engine: "none", version: "*" }),
    notes: trimmed(2000).default(""),
  })
  .superRefine((spec, ctx) => {
    const tools = spec.tools.map((tool) => tool.name);
    if (new Set(tools).size !== tools.length)
      ctx.addIssue({ code: "custom", path: ["tools"], message: "List each tool once." });
    const names = spec.variables.map((variable) => variable.name);
    if (new Set(names).size !== names.length) {
      ctx.addIssue({ code: "custom", path: ["variables"], message: "Each variable name may appear once." });
    }
  });
export type EnvironmentSpec = z.infer<typeof environmentSpecSchema>;

export const updateEnvironmentSchema = z.object({
  spec: environmentSpecSchema,
  expectedVersion: z.number().int().nonnegative(),
});

/** True when a concrete version (e.g. "24.16.0") meets a requirement. */
export function versionSatisfies(actual: string, requirement: string): boolean {
  if (requirement === "*") return true;
  const parts = (value: string) =>
    value
      .replace(/^v/, "")
      .split(/[.+-]/)
      .slice(0, 3)
      .map((part) => Number(part) || 0);
  const have = parts(actual);
  if (requirement.startsWith(">=")) {
    const want = parts(requirement.slice(2));
    for (let i = 0; i < 3; i++) {
      if ((have[i] ?? 0) !== (want[i] ?? 0)) return (have[i] ?? 0) > (want[i] ?? 0);
    }
    return true;
  }
  const want = requirement.replace(/\.x$/, "").split(".").map(Number);
  return want.every((value, index) => have[index] === value);
}

export interface EnvironmentCheckResultView {
  name: EnvironmentTool;
  requirement: string;
  required: boolean;
  found: boolean;
  version: string | null;
  ok: boolean;
  message: string;
}

export interface EnvironmentView {
  spec: EnvironmentSpec;
  /** 0 when the spec is inferred and not yet saved. */
  version: number;
  source: "inferred" | "saved";
  updatedAt: string | null;
}

export interface EnvironmentCheckView {
  checkedAt: string;
  ok: boolean;
  results: EnvironmentCheckResultView[];
}
