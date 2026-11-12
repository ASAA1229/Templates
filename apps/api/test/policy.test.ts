import { describe, expect, it } from "vitest";
import type { AuthenticatedOwner } from "../src/context.js";
import { isAllowed } from "../src/modules/auth/policy.js";

function actor(role: AuthenticatedOwner["role"]): AuthenticatedOwner {
  return { id: "00000000-0000-4000-8000-000000000001", email: "member@asaa.test", displayName: "Member", role };
}

describe("workspace role permissions", () => {
  it("allows developers and employees to contribute but not approve templates", () => {
    for (const role of ["DEVELOPER", "EMPLOYEE"] as const) {
      expect(isAllowed(actor(role), "template:submit")).toBe(true);
      expect(isAllowed(actor(role), "template:approve")).toBe(false);
      expect(isAllowed(actor(role), "template:review")).toBe(false);
    }
  });

  it("allows testers to inspect and contribute without project generation writes", () => {
    expect(isAllowed(actor("TESTER"), "template:submit")).toBe(true);
    expect(isAllowed(actor("TESTER"), "generation:read")).toBe(true);
    expect(isAllowed(actor("TESTER"), "generation:write")).toBe(false);
    expect(isAllowed(actor("TESTER"), "template:approve")).toBe(false);
  });

  it("allows administrators to review and manage members but not manage owner sessions", () => {
    expect(isAllowed(actor("ADMIN"), "template:approve")).toBe(true);
    expect(isAllowed(actor("ADMIN"), "identity:manage")).toBe(true);
    expect(isAllowed(actor("ADMIN"), "session:manage")).toBe(false);
  });

  it("allows each role to manage its own sessions and password", () => {
    for (const role of ["OWNER", "ADMIN", "DEVELOPER", "TESTER", "EMPLOYEE"] as const) {
      expect(isAllowed(actor(role), "session:manage")).toBe(true);
    }
    expect(isAllowed(actor("EMPLOYEE"), "identity:manage")).toBe(false);
  });

  it("keeps owner authority complete", () => {
    expect(isAllowed(actor("OWNER"), "identity:manage")).toBe(true);
    expect(isAllowed(actor("OWNER"), "session:manage")).toBe(true);
    expect(isAllowed(actor("OWNER"), "template:approve")).toBe(true);
  });
});
