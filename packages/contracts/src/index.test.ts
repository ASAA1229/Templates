import { describe, expect, it } from "vitest";
import {
  changePasswordSchema,
  createCatalogItemSchema,
  createProjectSchema,
  createRequirementSchema,
  fieldErrors,
  loginSchema,
} from "./index.js";

describe("auth contracts", () => {
  it("normalises email and rejects malformed input", () => {
    expect(loginSchema.parse({ email: " Owner@Example.COM ", password: "x" }).email).toBe("owner@example.com");
    expect(loginSchema.safeParse({ email: "nope", password: "" }).success).toBe(false);
  });

  it("enforces password policy and a different new password", () => {
    const short = changePasswordSchema.safeParse({ currentPassword: "a", newPassword: "short" });
    expect(short.success).toBe(false);
    const same = changePasswordSchema.safeParse({
      currentPassword: "correct horse battery",
      newPassword: "correct horse battery",
    });
    expect(same.success).toBe(false);
    if (!same.success) expect(fieldErrors(same.error).newPassword).toMatch(/different/);
  });
});

describe("project and requirement contracts", () => {
  it("uppercases keys and applies defaults", () => {
    expect(createProjectSchema.parse({ key: "web-app", name: " Site " })).toEqual({
      key: "WEB-APP",
      name: "Site",
      purpose: "",
      status: "PLANNING",
    });
    expect(createProjectSchema.safeParse({ key: "1x", name: "A" }).success).toBe(false);
  });

  it("bounds acceptance criteria and dependency ids", () => {
    expect(createRequirementSchema.safeParse({ title: "T", dependencyIds: ["not-a-uuid"] }).success).toBe(false);
    expect(createRequirementSchema.safeParse({ title: "T", acceptanceCriteria: Array(31).fill("x") }).success).toBe(
      false,
    );
  });
});

describe("catalog contracts", () => {
  const base = { slug: "react-starter", title: "React starter", category: "web", license: "MIT", ownership: "ASAA" };

  it("accepts authored metadata with defaults", () => {
    const parsed = createCatalogItemSchema.parse({ ...base, technologies: ["React"] });
    expect(parsed.technologies).toEqual(["react"]);
    expect(parsed.version).toBe("0.1.0");
  });

  it("keeps imported items non-active and requires their source reference", () => {
    const result = createCatalogItemSchema.safeParse({ ...base, sourceType: "IMPORTED", lifecycle: "ACTIVE" });
    expect(result.success).toBe(false);
    if (!result.success) {
      const fields = fieldErrors(result.error);
      expect(fields.lifecycle).toBeDefined();
      expect(fields.sourceReference).toBeDefined();
    }
  });

  it("rejects non-semantic versions", () => {
    expect(createCatalogItemSchema.safeParse({ ...base, version: "v1" }).success).toBe(false);
  });
});
