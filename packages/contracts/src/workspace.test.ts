import { describe, expect, it } from "vitest";
import {
  branchNameProblem,
  branchPolicySchema,
  createBranchSchema,
  DEFAULT_BRANCH_POLICY,
  environmentSpecSchema,
  gitIdentitySchema,
  remoteUrlProblem,
  versionSatisfies,
} from "./index.js";

describe("branch names", () => {
  it("accepts portable names and rejects option injection, traversal and ref syntax", () => {
    for (const ok of ["main", "dev", "new/login-page", "fix/issue_12", "test/a.b"])
      expect(branchNameProblem(ok), ok).toBeNull();
    for (const bad of [
      "",
      "-f",
      "--force",
      "a..b",
      "a//b",
      "a/",
      "a.",
      "x.lock",
      "a@{1}",
      "Main",
      "a b",
      "a;b",
      "new/.hidden",
      "head",
      "a\\b",
    ]) {
      expect(branchNameProblem(bad), bad).not.toBeNull();
    }
  });

  it("normalises topics and keeps the platform defaults", () => {
    expect(createBranchSchema.parse({ kind: "feature", topic: " Login " })).toMatchObject({
      topic: "login",
      switchTo: false,
    });
    expect(createBranchSchema.parse({ kind: "fix", topic: "" }).topic).toBeUndefined();
    expect(createBranchSchema.safeParse({ kind: "merge" }).success).toBe(false);
    expect(DEFAULT_BRANCH_POLICY).toEqual({
      productionBranch: "main",
      integrationBranch: "dev",
      featurePrefix: "new",
      fixPrefix: "fix",
      testPrefix: "test",
      protectedBranches: ["main", "dev"],
      requireReviewFor: ["main", "dev"],
    });
  });

  it("rejects inconsistent policies", () => {
    expect(branchPolicySchema.safeParse({ integrationBranch: "main" }).success).toBe(false);
    expect(branchPolicySchema.safeParse({ fixPrefix: "new" }).success).toBe(false);
    expect(branchPolicySchema.safeParse({ featurePrefix: "dev" }).success).toBe(false);
    expect(branchPolicySchema.safeParse({ protectedBranches: ["dev"] }).success).toBe(false);
  });
});

describe("identity and remotes", () => {
  it("validates identity without control characters or angle brackets", () => {
    expect(gitIdentitySchema.parse({ name: " Ada ", email: "ADA@Example.com" })).toEqual({
      name: "Ada",
      email: "ada@example.com",
    });
    expect(gitIdentitySchema.safeParse({ name: "Ada\nX", email: "a@b.co" }).success).toBe(false);
    expect(gitIdentitySchema.safeParse({ name: "Ada <x>", email: "a@b.co" }).success).toBe(false);
  });

  it("allows only credential-free https and scp-style SSH remotes", () => {
    expect(remoteUrlProblem("https://github.com/acme/app.git")).toBeNull();
    expect(remoteUrlProblem("git@github.com:acme/app.git")).toBeNull();
    for (const bad of [
      "https://user:pass@github.com/a.git",
      "https://ghp_token@github.com/a.git",
      "http://github.com/a.git",
      "file:///etc",
      "ext::sh -c id",
      "ssh://git@host/a.git",
      "-uhttps://x",
      "git@host:../../etc",
      "https://github.com/a.git?token=x",
    ]) {
      expect(remoteUrlProblem(bad), bad).not.toBeNull();
    }
  });
});

describe("environment specification", () => {
  it("applies defaults and validates names, versions and commands", () => {
    const spec = environmentSpecSchema.parse({ tools: [{ name: "node", version: ">=22" }] });
    expect(spec).toMatchObject({
      schemaVersion: 1,
      packageManager: { name: "none" },
      variables: [],
      database: { engine: "none" },
    });
    expect(environmentSpecSchema.safeParse({ tools: [{ name: "node", version: "latest" }] }).success).toBe(false);
    expect(environmentSpecSchema.safeParse({ tools: [{ name: "rust", version: "1" }] }).success).toBe(false);
    expect(
      environmentSpecSchema.safeParse({
        tools: [
          { name: "git", version: "2" },
          { name: "git", version: "2" },
        ],
      }).success,
    ).toBe(false);
    expect(environmentSpecSchema.safeParse({ variables: [{ name: "lower" }] }).success).toBe(false);
    expect(environmentSpecSchema.safeParse({ commands: { install: ["npm ci\u0007"] } }).success).toBe(false);
  });

  it("never accepts secret values", () => {
    expect(
      environmentSpecSchema.safeParse({ variables: [{ name: "API_KEY", secret: true, example: "x" }] }).success,
    ).toBe(false);
    expect(environmentSpecSchema.safeParse({ variables: [{ name: "GITHUB_TOKEN" }] }).success).toBe(false);
    expect(
      environmentSpecSchema.safeParse({ variables: [{ name: "DATABASE_URL", example: "postgresql://a:b@h/db" }] })
        .success,
    ).toBe(false);
    expect(
      environmentSpecSchema.safeParse({ variables: [{ name: "DATABASE_URL", example: "postgresql://localhost/db" }] })
        .success,
    ).toBe(true);
  });

  it("compares versions against requirements", () => {
    expect(versionSatisfies("24.16.0", ">=22")).toBe(true);
    expect(versionSatisfies("v20.1.0", ">=22")).toBe(false);
    expect(versionSatisfies("2.55.0.windows.5", ">=2.28")).toBe(true);
    expect(versionSatisfies("24.16.0", "24")).toBe(true);
    expect(versionSatisfies("24.16.0", "24.x")).toBe(true);
    expect(versionSatisfies("24.16.0", "24.15")).toBe(false);
    expect(versionSatisfies("1.0.0", "*")).toBe(true);
  });
});
