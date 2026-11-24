import path from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { readOidcConfig } from "../modules/auth/oidc.js";

/** apps/api, from both src/config (tsx) and dist/config (compiled). */
const API_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

/** Validated runtime configuration; the process refuses to start on invalid values. */
const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "staging", "production"]).default("development"),
  PORT: z.coerce.number().int().min(1).max(65535).default(4000),
  /** Interface the API binds to. Containers set 0.0.0.0 and publish the port to loopback only. */
  HOST: z.string().trim().min(1).default("127.0.0.1"),
  /** Express "trust proxy" setting: loopback (default), or uniquelocal when behind the bundled web container. */
  TRUST_PROXY: z.enum(["loopback", "uniquelocal"]).default("loopback"),
  WEB_ORIGIN: z.string().url().default("http://localhost:5000"),
  DATABASE_URL: z.string().regex(/^postgres(?:ql)?:\/\//, "DATABASE_URL must be a PostgreSQL connection string."),
  SESSION_ABSOLUTE_MINUTES: z.coerce
    .number()
    .int()
    .min(5)
    .max(7 * 24 * 60)
    .default(720),
  SESSION_IDLE_MINUTES: z.coerce
    .number()
    .int()
    .min(1)
    .max(24 * 60)
    .default(30),
  COOKIE_SECURE: z
    .enum(["true", "false"])
    .default("false")
    .transform((value) => value === "true"),
  WEB_DIST_DIR: z.string().optional().default(""),
  LOG_LEVEL: z.enum(["debug", "info", "warn", "error", "silent"]).default("info"),
  /** Read-only, locally maintained template content (manifests + files). */
  TEMPLATE_LIBRARY_DIR: z
    .string()
    .optional()
    .transform((value) => path.resolve(value || path.join(API_ROOT, "template-library"))),
  /** Git executable used by the local repository provider (absolute path or a name on PATH). */
  GIT_EXECUTABLE: z
    .string()
    .trim()
    .default("git")
    .refine(
      (value) => /^[A-Za-z0-9._-]+$/.test(value) || path.isAbsolute(value),
      "Use a program name or an absolute path.",
    ),
  /** Upper bound for any single Git command. */
  GIT_TIMEOUT_MS: z.coerce.number().int().min(1000).max(120_000).default(20_000),
  /** Key (base64 of 32 bytes, or a passphrase of 16+ characters) that encrypts TOTP secrets at rest. */
  MFA_ENCRYPTION_KEY: z.string().min(16).optional(),
  /** When true, OWNER/ADMIN accounts must enable MFA before privileged actions are allowed. */
  REQUIRE_MFA_PRIVILEGED: z
    .enum(["true", "false"])
    .default("false")
    .transform((value) => value === "true"),
  /** Build/test job isolation: auto uses a Docker container when usable (daemon up, image present), else a process. */
  JOB_ISOLATION: z.enum(["auto", "process", "container"]).default("auto"),
  /** Image for container jobs. It must already exist locally; images are never pulled. */
  JOB_CONTAINER_IMAGE: z
    .string()
    .trim()
    .regex(/^[A-Za-z0-9][A-Za-z0-9._/:@-]{0,199}$/, "Invalid image reference.")
    .default("node:24.22.3-alpine3.24"),
  /** Where independent project outputs are written; never inside the platform source. */
  GENERATION_OUTPUT_DIR: z
    .string()
    .optional()
    .transform((value) => path.resolve(value || path.join(API_ROOT, "..", "..", ".local", "generated"))),
  /**
   * Local delivery sink: repository handoff copies and deployment bundles are written here by the built-in
   * local providers. Nothing is ever sent to an external host by default.
   */
  DELIVERY_DIR: z
    .string()
    .optional()
    .transform((value) => path.resolve(value || path.join(API_ROOT, "..", "..", ".local", "delivery"))),
  /** Optional connector endpoints (Jenkins / Nexus). Unset means only the local mock connectors exist. */
  CONNECTOR_JENKINS_URL: z
    .string()
    .trim()
    .url()
    .optional()
    .or(z.literal("").transform(() => undefined)),
  CONNECTOR_JENKINS_JOBS: z.string().trim().default(""),
  CONNECTOR_NEXUS_URL: z
    .string()
    .trim()
    .url()
    .optional()
    .or(z.literal("").transform(() => undefined)),
  CONNECTOR_NEXUS_REPOSITORIES: z.string().trim().default(""),
  /** JARVIS mini-features (summaries, classification, review assist). Off unless explicitly enabled. */
  JARVIS_FEATURES_ENABLED: z
    .enum(["true", "false"])
    .default("false")
    .transform((value) => value === "true"),
  /** Repository-level packaged tools (tools/<id>/manifest.json). Read-only. */
  TOOLS_DIR: z
    .string()
    .optional()
    .transform((value) => path.resolve(value || path.join(API_ROOT, "..", "..", "tools"))),
  /** Optional AI assistance. Off by default. */
  AI_ENABLED: z
    .enum(["true", "false"])
    .default("false")
    .transform((value) => value === "true"),
  AI_PROVIDER: z.enum(["ollama", "jarvis"]).default("ollama"),
  OLLAMA_URL: z.string().url().default("http://127.0.0.1:11434"),
  OLLAMA_MODEL: z
    .string()
    .trim()
    .regex(/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,99}$/)
    .default("llama3.2"),
  JARVIS_AI_URL: z.string().url().default("http://127.0.0.1:3100"),
  JARVIS_AI_KEY: z.string().optional(),
  AI_TIMEOUT_MS: z.coerce.number().int().min(1000).max(300_000).default(60_000),
  /**
   * ASAA ecosystem event producer (asaa.event.v1). Disabled unless ASAA_EVENTS_URL, ASAA_ORG_ID and credentials
   * (a static token, or Keycloak client credentials) are all set. Secrets come from the environment only.
   */
  ASAA_EVENTS_URL: z
    .string()
    .trim()
    .url()
    .optional()
    .or(z.literal("").transform(() => undefined)),
  ASAA_ORG_ID: z
    .string()
    .trim()
    .min(1)
    .max(128)
    .optional()
    .or(z.literal("").transform(() => undefined)),
  ASAA_EVENTS_TOKEN_URL: z
    .string()
    .trim()
    .url()
    .optional()
    .or(z.literal("").transform(() => undefined)),
  ASAA_EVENTS_CLIENT_ID: z.string().trim().min(1).max(200).default("templates-events"),
  ASAA_EVENTS_CLIENT_SECRET: z
    .string()
    .min(1)
    .max(512)
    .optional()
    .or(z.literal("").transform(() => undefined)),
  /**
   * Optional single sign-on through the shared ASAA identity provider (confidential client `templates-web`).
   * Enabled only when all three are set. SSO signs in existing local accounts only; roles stay in Templates.
   */
  TEMPLATES_OIDC_ISSUER: z.string().trim().optional().or(z.literal("").transform(() => undefined)),
  TEMPLATES_OIDC_CLIENT_ID: z.string().trim().optional().or(z.literal("").transform(() => undefined)),
  TEMPLATES_OIDC_CLIENT_SECRET: z.string().max(512).optional().or(z.literal("").transform(() => undefined)),
  /** Static bearer token fallback when client credentials are not configured. */
  ASAA_EVENTS_TOKEN: z
    .string()
    .min(1)
    .max(8192)
    .optional()
    .or(z.literal("").transform(() => undefined)),
});

export type AppConfig = z.infer<typeof envSchema>;

function isLoopbackHost(hostname: string): boolean {
  return ["localhost", "127.0.0.1", "::1"].includes(hostname.replace(/^\[|\]$/g, ""));
}

/** HTTPS is required for ASAA endpoints unless they are loopback (local development). */
function secureOrLoopback(url: string): boolean {
  const parsed = new URL(url);
  return parsed.protocol === "https:" || (parsed.protocol === "http:" && isLoopbackHost(parsed.hostname));
}

/** Non-fatal configuration notes for the operator (logged at startup; never contain values). */
export function configWarnings(config: AppConfig): string[] {
  const warnings: string[] = [];
  if (config.ASAA_EVENTS_TOKEN && config.ASAA_EVENTS_TOKEN_URL && config.ASAA_EVENTS_CLIENT_SECRET) {
    warnings.push(
      "Both ASAA_EVENTS_TOKEN and client credentials are set; the client credentials are used and the static token is ignored.",
    );
  }
  return warnings;
}

/** True only when the producer is fully configured; partial configuration leaves it disabled. */
export function asaaEventsEnabled(config: AppConfig): boolean {
  const credentials =
    Boolean(config.ASAA_EVENTS_TOKEN) ||
    Boolean(config.ASAA_EVENTS_TOKEN_URL && config.ASAA_EVENTS_CLIENT_ID && config.ASAA_EVENTS_CLIENT_SECRET);
  return Boolean(config.ASAA_EVENTS_URL && config.ASAA_ORG_ID && credentials);
}

export function loadConfig(source: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = envSchema.safeParse(source);
  if (!parsed.success) {
    const problems = parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; ");
    throw new Error(`Invalid configuration: ${problems}`);
  }
  const config = parsed.data;
  if ((config.NODE_ENV === "production" || config.NODE_ENV === "staging") && !config.COOKIE_SECURE) {
    throw new Error("COOKIE_SECURE must be true in staging and production (HTTPS only).");
  }
  // The session cookie may be sent without the Secure attribute only on a loopback origin.
  if (!config.COOKIE_SECURE && !isLoopbackHost(new URL(config.WEB_ORIGIN).hostname)) {
    throw new Error("COOKIE_SECURE must be true unless WEB_ORIGIN is a loopback address.");
  }
  if (config.REQUIRE_MFA_PRIVILEGED && !config.MFA_ENCRYPTION_KEY) {
    throw new Error("REQUIRE_MFA_PRIVILEGED needs MFA_ENCRYPTION_KEY to be set.");
  }
  if (config.AI_ENABLED && config.AI_PROVIDER === "ollama") {
    const host = new URL(config.OLLAMA_URL).hostname.replace(/^\[|\]$/g, "");
    if (!["localhost", "127.0.0.1", "::1"].includes(host)) {
      throw new Error("OLLAMA_URL must point to this machine (localhost, 127.0.0.1 or ::1); remote AI is not allowed.");
    }
  }
  // Fail closed: half-configured client credentials must not silently fall back to another credential.
  if (Boolean(config.ASAA_EVENTS_TOKEN_URL) !== Boolean(config.ASAA_EVENTS_CLIENT_SECRET)) {
    throw new Error("ASAA_EVENTS_TOKEN_URL and ASAA_EVENTS_CLIENT_SECRET must be set together.");
  }
  for (const [name, value] of [
    ["ASAA_EVENTS_URL", config.ASAA_EVENTS_URL],
    ["ASAA_EVENTS_TOKEN_URL", config.ASAA_EVENTS_TOKEN_URL],
  ] as const) {
    if (!value) continue;
    if (!secureOrLoopback(value)) throw new Error(`${name} must use HTTPS unless it is a loopback address.`);
    const parsed = new URL(value);
    if (parsed.username || parsed.password) throw new Error(`${name} must not contain credentials.`);
  }
  // Throws on a malformed or non-HTTPS (non-loopback) issuer; returns undefined (SSO off) when not fully configured.
  readOidcConfig(config, config.WEB_ORIGIN);
  const jarvisUrl = new URL(config.JARVIS_AI_URL);
  if (
    !["http:", "https:"].includes(jarvisUrl.protocol) ||
    !["localhost", "127.0.0.1", "::1"].includes(jarvisUrl.hostname.replace(/^\[|\]$/g, "")) ||
    jarvisUrl.username ||
    jarvisUrl.password ||
    jarvisUrl.search ||
    jarvisUrl.hash ||
    (jarvisUrl.pathname !== "" && jarvisUrl.pathname !== "/")
  ) {
    throw new Error("JARVIS_AI_URL must be a local gateway origin (localhost, 127.0.0.1 or ::1).");
  }
  if (
    config.AI_ENABLED &&
    config.AI_PROVIDER === "jarvis" &&
    !/^jrv_[a-f0-9]{12}_[A-Za-z0-9_-]{43}$/.test(config.JARVIS_AI_KEY ?? "")
  ) {
    throw new Error("A valid JARVIS site key is required when AI_PROVIDER=jarvis and AI_ENABLED=true.");
  }
  if (config.JARVIS_FEATURES_ENABLED && !/^jrv_[a-f0-9]{12}_[A-Za-z0-9_-]{43}$/.test(config.JARVIS_AI_KEY ?? "")) {
    throw new Error("A valid JARVIS site key (JARVIS_AI_KEY) is required when JARVIS_FEATURES_ENABLED=true.");
  }
  if (config.SESSION_IDLE_MINUTES > config.SESSION_ABSOLUTE_MINUTES) {
    throw new Error("SESSION_IDLE_MINUTES cannot exceed SESSION_ABSOLUTE_MINUTES.");
  }
  const platformSource = [path.join(API_ROOT, "src"), path.join(API_ROOT, "dist"), config.TEMPLATE_LIBRARY_DIR];
  const delivery = config.DELIVERY_DIR.toLowerCase();
  for (const protectedDir of platformSource) {
    const dir = protectedDir.toLowerCase();
    if (delivery === dir || delivery.startsWith(dir + path.sep) || dir.startsWith(delivery + path.sep)) {
      throw new Error("DELIVERY_DIR must not overlap the platform source or template library.");
    }
  }
  if (delivery === config.GENERATION_OUTPUT_DIR.toLowerCase()) {
    throw new Error("DELIVERY_DIR must differ from GENERATION_OUTPUT_DIR.");
  }
  const output = config.GENERATION_OUTPUT_DIR.toLowerCase();
  for (const protectedDir of platformSource) {
    const dir = protectedDir.toLowerCase();
    if (output === dir || output.startsWith(dir + path.sep) || dir.startsWith(output + path.sep)) {
      throw new Error("GENERATION_OUTPUT_DIR must not overlap the platform source or template library.");
    }
  }
  return config;
}
