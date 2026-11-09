import { z } from "zod";

/** Validated runtime configuration; the process refuses to start on invalid values. */
const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "staging", "production"]).default("development"),
  PORT: z.coerce.number().int().min(1).max(65535).default(4000),
  WEB_ORIGIN: z.string().url().default("http://localhost:5173"),
  DATABASE_URL: z
    .string()
    .regex(/^postgres(?:ql)?:\/\//, "DATABASE_URL must be a PostgreSQL connection string."),
  SESSION_ABSOLUTE_MINUTES: z.coerce.number().int().min(5).max(7 * 24 * 60).default(720),
  SESSION_IDLE_MINUTES: z.coerce.number().int().min(1).max(24 * 60).default(30),
  COOKIE_SECURE: z
    .enum(["true", "false"])
    .default("false")
    .transform((value) => value === "true"),
  WEB_DIST_DIR: z.string().optional().default(""),
  LOG_LEVEL: z.enum(["debug", "info", "warn", "error", "silent"]).default("info"),
});

export type AppConfig = z.infer<typeof envSchema>;

export function loadConfig(source: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = envSchema.safeParse(source);
  if (!parsed.success) {
    const problems = parsed.error.issues
      .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
      .join("; ");
    throw new Error(`Invalid configuration: ${problems}`);
  }
  const config = parsed.data;
  if ((config.NODE_ENV === "production" || config.NODE_ENV === "staging") && !config.COOKIE_SECURE) {
    throw new Error("COOKIE_SECURE must be true in staging and production (HTTPS only).");
  }
  if (config.SESSION_IDLE_MINUTES > config.SESSION_ABSOLUTE_MINUTES) {
    throw new Error("SESSION_IDLE_MINUTES cannot exceed SESSION_ABSOLUTE_MINUTES.");
  }
  return config;
}
