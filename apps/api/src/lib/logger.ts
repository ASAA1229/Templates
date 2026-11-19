/**
 * Minimal structured JSON logger (no dependency). Values under keys that look
 * sensitive are redacted so passwords, tokens and cookies never reach logs.
 */
type Level = "debug" | "info" | "warn" | "error";
const ORDER: Record<Level | "silent", number> = { debug: 10, info: 20, warn: 30, error: 40, silent: 99 };
const SENSITIVE = /pass(word)?|secret|token|cookie|authorization|hash|session/i;

export function redact(value: unknown, depth = 0): unknown {
  if (depth > 5 || value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map((item) => redact(item, depth + 1));
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([key, item]) => [
      key,
      SENSITIVE.test(key) ? "[REDACTED]" : redact(item, depth + 1),
    ]),
  );
}

export interface Logger {
  debug(message: string, fields?: Record<string, unknown>): void;
  info(message: string, fields?: Record<string, unknown>): void;
  warn(message: string, fields?: Record<string, unknown>): void;
  error(message: string, fields?: Record<string, unknown>): void;
}

export function createLogger(level: Level | "silent" = "info"): Logger {
  const write = (at: Level, message: string, fields: Record<string, unknown> = {}) => {
    if (ORDER[at] < ORDER[level]) return;
    const line = JSON.stringify({ time: new Date().toISOString(), level: at, message, ...(redact(fields) as object) });
    (at === "error" || at === "warn" ? process.stderr : process.stdout).write(line + "\n");
  };
  return {
    debug: (message, fields) => write("debug", message, fields),
    info: (message, fields) => write("info", message, fields),
    warn: (message, fields) => write("warn", message, fields),
    error: (message, fields) => write("error", message, fields),
  };
}
