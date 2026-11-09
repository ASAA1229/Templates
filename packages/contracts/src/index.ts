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
const required = (max: number, label: string) =>
  trimmed(max).min(1, `${label} is required.`);

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
export const TRACE_KINDS = [
  "TASK",
  "CODE_CHANGE",
  "TEST",
  "DEFECT",
  "DOCUMENTATION",
  "RELEASE",
] as const;
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
