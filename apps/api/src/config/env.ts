import path from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";

/** apps/api, from both src/config (tsx) and dist/config (compiled). */
const API_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

/** Validated runtime configuration; the process refuses to start on invalid values. */
const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "staging", "production"]).default("development"),
  PORT: z.coerce.number().int().min(1).max(65535).default(4000),
  WEB_ORIGIN: z.string().url().default("http://localhost:5173"),
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
  /** Where independent project outputs are written; never inside the platform source. */
  GENERATION_OUTPUT_DIR: z
    .string()
    .optional()
    .transform((value) => path.resolve(value || path.join(API_ROOT, "..", "..", ".local", "generated"))),
});

export type AppConfig = z.infer<typeof envSchema>;

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
  if (config.SESSION_IDLE_MINUTES > config.SESSION_ABSOLUTE_MINUTES) {
    throw new Error("SESSION_IDLE_MINUTES cannot exceed SESSION_ABSOLUTE_MINUTES.");
  }
  const platformSource = [path.join(API_ROOT, "src"), path.join(API_ROOT, "dist"), config.TEMPLATE_LIBRARY_DIR];
  const output = config.GENERATION_OUTPUT_DIR.toLowerCase();
  for (const protectedDir of platformSource) {
    const dir = protectedDir.toLowerCase();
    if (output === dir || output.startsWith(dir + path.sep) || dir.startsWith(output + path.sep)) {
      throw new Error("GENERATION_OUTPUT_DIR must not overlap the platform source or template library.");
    }
  }
  return config;
}
