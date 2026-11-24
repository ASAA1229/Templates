import { describe, expect, it } from "vitest";
import { loadConfig } from "../config/env.js";
import { RateLimiter } from "../middleware/security.js";
import { isAllowed } from "../modules/auth/policy.js";
import { redact } from "./logger.js";
import { hashPassword, needsRehash, verifyPassword } from "./password.js";
import { hashToken, newSessionToken } from "./tokens.js";

describe("password hashing", () => {
  it("verifies the right password and rejects others", async () => {
    const hash = await hashPassword("a long enough password");
    expect(hash.startsWith("scrypt$")).toBe(true);
    expect(hash).not.toContain("a long enough password");
    expect(await verifyPassword("a long enough password", hash)).toBe(true);
    expect(await verifyPassword("a long enough passworD", hash)).toBe(false);
    expect(needsRehash(hash)).toBe(false);
  });

  it("rejects malformed stored hashes without throwing", async () => {
    expect(await verifyPassword("x", "plaintext")).toBe(false);
    expect(await verifyPassword("x", "scrypt$0$0$0$a$b")).toBe(false);
  });
});

describe("session tokens", () => {
  it("are random 256-bit values stored only as SHA-256", () => {
    const a = newSessionToken();
    const b = newSessionToken();
    expect(a.token).not.toBe(b.token);
    expect(a.tokenHash).toBe(hashToken(a.token));
    expect(a.tokenHash).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("rate limiter", () => {
  it("blocks after the limit and resets after the window", () => {
    let now = 0;
    const limiter = new RateLimiter(2, 1000, () => now);
    expect(limiter.consume("k")).toBe(0);
    expect(limiter.consume("k")).toBe(0);
    expect(limiter.consume("k")).toBeGreaterThan(0);
    now = 1001;
    expect(limiter.consume("k")).toBe(0);
  });
});

describe("authorization policy", () => {
  it("allows the owner and denies anonymous callers", () => {
    expect(isAllowed({ id: "1", email: "o@x.y", displayName: "O", role: "OWNER" }, "project:write")).toBe(true);
    expect(isAllowed(undefined, "project:read")).toBe(false);
  });
});

describe("configuration", () => {
  const base = { DATABASE_URL: "postgresql://u:p@127.0.0.1:5432/db" };

  it("applies defaults and rejects unsafe production cookies", () => {
    expect(loadConfig(base).PORT).toBe(4000);
    expect(() => loadConfig({ ...base, NODE_ENV: "production" })).toThrow(/COOKIE_SECURE/);
    expect(() => loadConfig({ DATABASE_URL: "mysql://x" })).toThrow(/PostgreSQL/);
    expect(() => loadConfig({ ...base, SESSION_IDLE_MINUTES: "60", SESSION_ABSOLUTE_MINUTES: "30" })).toThrow();
  });
});

describe("log redaction", () => {
  it("removes sensitive values at any depth", () => {
    expect(redact({ email: "a", password: "p", nested: { sessionToken: "t", ok: 1 } })).toEqual({
      email: "a",
      password: "[REDACTED]",
      nested: { sessionToken: "[REDACTED]", ok: 1 },
    });
  });
});

describe("password hashing cost", () => {
  it("uses at least OWASP-equivalent scrypt parameters and flags weaker stored hashes for rehash", async () => {
    const hash = await hashPassword("a long enough password");
    const [, n, r, p] = hash.split("$").map(Number);
    expect(n).toBeGreaterThanOrEqual(2 ** 16);
    expect(r).toBeGreaterThanOrEqual(8);
    expect(p).toBeGreaterThanOrEqual(2);
    const legacy = ["scrypt", 2 ** 15, 8, 1, ...hash.split("$").slice(4)].join("$");
    expect(needsRehash(legacy)).toBe(true);
  });
});

describe("session cookie Secure flag", () => {
  const base = { DATABASE_URL: "postgresql://u:p@127.0.0.1:5432/x" };
  it("may be off only for a loopback web origin", () => {
    expect(() => loadConfig({ ...base, WEB_ORIGIN: "http://127.0.0.1:5000", COOKIE_SECURE: "false" })).not.toThrow();
    expect(() => loadConfig({ ...base, WEB_ORIGIN: "http://localhost:5000" })).not.toThrow();
    expect(() => loadConfig({ ...base, WEB_ORIGIN: "http://192.168.1.20:5000", COOKIE_SECURE: "false" })).toThrow(
      /COOKIE_SECURE/,
    );
    expect(() => loadConfig({ ...base, WEB_ORIGIN: "https://templates.example.test" })).toThrow(/COOKIE_SECURE/);
    expect(() =>
      loadConfig({ ...base, WEB_ORIGIN: "https://templates.example.test", COOKIE_SECURE: "true" }),
    ).not.toThrow();
  });
});
