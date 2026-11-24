import { describe, expect, it } from "vitest";
import { assertDevelopmentEnvironment, readDemoCredentials } from "./demo-user-guard.js";

describe("demo user seed guards", () => {
  it("runs only in development or test", () => {
    expect(() => assertDevelopmentEnvironment({ NODE_ENV: "development" })).not.toThrow();
    expect(() => assertDevelopmentEnvironment({ NODE_ENV: "test" })).not.toThrow();
    expect(() => assertDevelopmentEnvironment({})).not.toThrow();
    expect(() => assertDevelopmentEnvironment({ NODE_ENV: "production" })).toThrow(/development or test/);
    expect(() => assertDevelopmentEnvironment({ NODE_ENV: "development", APP_ENV: "production" })).toThrow();
    expect(() => assertDevelopmentEnvironment({ NODE_ENV: "staging" })).toThrow();
  });

  it("requires both values and enforces the policy without echoing the password", () => {
    expect(() => readDemoCredentials({})).toThrow(/DEMO_USER_EMAIL/);
    const secret = "short-pw";
    try {
      readDemoCredentials({ DEMO_USER_EMAIL: "abhi@gmail.com", DEMO_USER_PASSWORD: secret });
      expect.unreachable();
    } catch (error) {
      expect((error as Error).message).toMatch(/policy/);
      expect((error as Error).message).not.toContain(secret);
    }
    expect(() =>
      readDemoCredentials({ DEMO_USER_EMAIL: "nope", DEMO_USER_PASSWORD: "a long enough password" }),
    ).toThrow(/email/);
    expect(
      readDemoCredentials({ DEMO_USER_EMAIL: " Abhi@Gmail.com ", DEMO_USER_PASSWORD: "a long enough password" }).email,
    ).toBe("abhi@gmail.com");
  });
});
