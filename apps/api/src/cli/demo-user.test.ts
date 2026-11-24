import { describe, expect, it } from "vitest";
import {
  SEED_DISPLAY_NAME,
  assertDevelopmentEnvironment,
  assertSeedOwnedAccount,
  readDemoCredentials,
} from "./demo-user-guard.js";

describe("demo user seed guards", () => {
  it("runs only in development or test", () => {
    expect(() => assertDevelopmentEnvironment({ NODE_ENV: "development" })).not.toThrow();
    expect(() => assertDevelopmentEnvironment({ NODE_ENV: "test" })).not.toThrow();
    expect(() => assertDevelopmentEnvironment({ APP_ENV: "development" })).not.toThrow();
    expect(() => assertDevelopmentEnvironment({})).toThrow(/explicitly/);
    expect(() => assertDevelopmentEnvironment({ NODE_ENV: " " })).toThrow(/explicitly/);
    expect(() => assertDevelopmentEnvironment({ NODE_ENV: "production" })).toThrow(/development or test/);
    expect(() => assertDevelopmentEnvironment({ NODE_ENV: "development", APP_ENV: "production" })).toThrow();
    expect(() => assertDevelopmentEnvironment({ NODE_ENV: "staging" })).toThrow();
  });

  it("requires both values and enforces the policy without echoing the password", () => {
    expect(() => readDemoCredentials({})).toThrow(/DEMO_USER_EMAIL/);
    const secret = "short-pw";
    try {
      readDemoCredentials({ DEMO_USER_EMAIL: "demo.owner@example.invalid", DEMO_USER_PASSWORD: secret });
      expect.unreachable();
    } catch (error) {
      expect((error as Error).message).toMatch(/policy/);
      expect((error as Error).message).not.toContain(secret);
    }
    expect(() =>
      readDemoCredentials({ DEMO_USER_EMAIL: "nope", DEMO_USER_PASSWORD: "a long enough password" }),
    ).toThrow(/email/);
    expect(
      readDemoCredentials({
        DEMO_USER_EMAIL: " Demo.Owner@Example.invalid ",
        DEMO_USER_PASSWORD: "a long enough password",
      }).email,
    ).toBe("demo.owner@example.invalid");
  });

  it("labels the seeded account and refuses to touch an account the seed did not create", () => {
    expect(SEED_DISPLAY_NAME).toBe("Demo Owner – TEMPORARY / TEST DATA");
    expect(() => assertSeedOwnedAccount("demo.owner@example.invalid", true)).not.toThrow();
    expect(() => assertSeedOwnedAccount("real.admin@example.invalid", false)).toThrow(/not the demo seed/);
  });
});
