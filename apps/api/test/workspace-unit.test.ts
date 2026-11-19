import { DEFAULT_BRANCH_POLICY, type BranchView } from "@asaa/contracts";
import { describe, expect, it } from "vitest";
import {
  baseEnvironment,
  ProcessOutputLimitError,
  ProcessTimeoutError,
  ProcessUnavailableError,
  runProcess,
} from "../src/lib/process.js";
import { BranchPlanError, planBranch, stateWarnings } from "../src/modules/workspace/branch-policy.js";
import { parseBranches, parseLog, parseStatus } from "../src/modules/workspace/git.js";

const node = process.execPath;
const options = { cwd: process.cwd(), timeoutMs: 10_000, maxOutputBytes: 64 * 1024, env: baseEnvironment() };

describe("safe process runner", () => {
  it("passes arguments literally without a shell", async () => {
    const result = await runProcess(
      node,
      ["-e", "console.log(JSON.stringify(process.argv.slice(1)))", "a; echo pwned", "$(whoami)", "`id`", "| x"],
      options,
    );
    expect(JSON.parse(result.stdout)).toEqual(["a; echo pwned", "$(whoami)", "`id`", "| x"]);
  });

  it("does not inherit the parent environment", async () => {
    process.env.ASAA_SECRET_PROBE = "leak";
    try {
      const result = await runProcess(node, ["-e", "console.log(process.env.ASAA_SECRET_PROBE ?? 'absent')"], options);
      expect(result.stdout.trim()).toBe("absent");
    } finally {
      delete process.env.ASAA_SECRET_PROBE;
    }
  });

  it("reports a missing executable distinctly", async () => {
    await expect(runProcess("asaa-definitely-not-installed", ["--version"], options)).rejects.toBeInstanceOf(
      ProcessUnavailableError,
    );
  });

  it("kills commands that exceed the timeout", async () => {
    const started = Date.now();
    await expect(
      runProcess(node, ["-e", "setTimeout(() => {}, 30000)"], { ...options, timeoutMs: 500 }),
    ).rejects.toBeInstanceOf(ProcessTimeoutError);
    expect(Date.now() - started).toBeLessThan(5000);
  });

  it("kills commands that produce too much output", async () => {
    await expect(
      runProcess(node, ["-e", "process.stdout.write('x'.repeat(5 * 1024 * 1024))"], {
        ...options,
        maxOutputBytes: 1024,
      }),
    ).rejects.toBeInstanceOf(ProcessOutputLimitError);
  });

  it("rejects NUL bytes in arguments", () => {
    expect(() => runProcess(node, ["-e", "1\0"], options)).toThrow(/Invalid process argument/);
  });
});

describe("git output parsing", () => {
  it("parses porcelain v2 status including renames, untracked and conflicts", () => {
    const sha = "a".repeat(40);
    const output = [
      `# branch.oid ${sha}`,
      "# branch.head new/login",
      "1 .M N... 100644 100644 100644 abc abc src/app.ts",
      "1 A. N... 000000 100644 100644 000 abc src/new file.ts",
      "1 .D N... 100644 100644 000000 abc abc gone.txt",
      "2 R. N... 100644 100644 100644 abc abc R100 docs/b.txt",
      "docs/a.txt",
      "u UU N... 100644 100644 100644 100644 a b c conflict.txt",
      "? notes.txt",
      "",
    ].join("\0");
    const parsed = parseStatus(output);
    expect(parsed.head).toEqual({ branch: "new/login", sha, detached: false });
    expect(parsed.entries).toEqual([
      { path: "src/app.ts", state: "modified", staged: false },
      { path: "src/new file.ts", state: "added", staged: true },
      { path: "gone.txt", state: "deleted", staged: false },
      { path: "docs/b.txt", state: "renamed", staged: true, from: "docs/a.txt" },
      { path: "conflict.txt", state: "conflicted", staged: true },
      { path: "notes.txt", state: "untracked", staged: false },
    ]);
    expect(parseStatus("# branch.oid (initial)\0# branch.head main\0").head).toEqual({
      branch: "main",
      sha: null,
      detached: false,
    });
  });

  it("caps very large status listings", () => {
    const many = Array.from({ length: 700 }, (_, i) => `? file-${i}.txt`).join("\0");
    const parsed = parseStatus(many);
    expect(parsed.entries).toHaveLength(500);
    expect(parsed.truncated).toBe(true);
  });

  it("parses log and branch records and drops malformed lines", () => {
    const sha = "b".repeat(40);
    expect(
      parseLog(`${sha}\x1fOwner\x1fo@x.test\x1f2026-11-09T10:00:00+05:30\x1fInitial commit\x1e\nnot-a-sha\x1fx\x1e`),
    ).toEqual([
      { sha, author: "Owner", email: "o@x.test", date: "2026-11-09T10:00:00+05:30", subject: "Initial commit" },
    ]);
    expect(parseBranches(`main\x1f${sha}\x1f*\nnew/a\x1f${sha}\x1f \n`, DEFAULT_BRANCH_POLICY)).toEqual([
      { name: "main", sha, current: true, protected: true, role: "production" },
      { name: "new/a", sha, current: false, protected: false, role: "feature" },
    ]);
  });
});

describe("branch policy", () => {
  const sha = "c".repeat(40);
  const branch = (name: string): BranchView => ({ name, sha, current: false, protected: false, role: "other" });

  it("starts work from dev when it exists, otherwise from main with a warning", () => {
    const fromMain = planBranch(DEFAULT_BRANCH_POLICY, [branch("main")], { kind: "feature", topic: "login" });
    expect(fromMain).toMatchObject({ name: "new/login", from: "main" });
    expect(fromMain.warnings[0]).toMatch(/dev does not exist yet/);
    const fromDev = planBranch(DEFAULT_BRANCH_POLICY, [branch("main"), branch("dev")], { kind: "fix", topic: "crash" });
    expect(fromDev).toEqual({ name: "fix/crash", from: "dev", warnings: [] });
    const explicit = planBranch(DEFAULT_BRANCH_POLICY, [branch("main"), branch("dev")], {
      kind: "test",
      topic: "audit",
      from: "main",
    });
    expect(explicit.warnings[0]).toMatch(/should start from dev/);
  });

  it("warns for protected integration branches and never plans a merge", () => {
    const plan = planBranch(DEFAULT_BRANCH_POLICY, [branch("main")], { kind: "integration", switchTo: true });
    expect(plan.name).toBe("dev");
    expect(plan.warnings.join(" ")).toMatch(/never merged automatically/);
    expect(plan.warnings.join(" ")).toMatch(/protected/);
    expect(plan.warnings.join(" ")).toMatch(/working directly on the protected branch dev/);
  });

  it("rejects duplicates, missing start points and path clashes", () => {
    const branches = [branch("main"), branch("dev"), branch("new")];
    const attempt = (request: Parameters<typeof planBranch>[2]) => {
      try {
        planBranch(DEFAULT_BRANCH_POLICY, branches, request);
        return null;
      } catch (error) {
        return error as BranchPlanError;
      }
    };
    expect(attempt({ kind: "integration" })).toMatchObject({ kind: "conflict" });
    expect(attempt({ kind: "fix", topic: "x", from: "release" })).toMatchObject({ field: "from", kind: "invalid" });
    expect(attempt({ kind: "feature", topic: "login" })?.message).toMatch(/cannot coexist with new/);
    expect(attempt({ kind: "integration", topic: "x" })).toMatchObject({ field: "topic" });
  });

  it("flags protected and detached heads", () => {
    expect(stateWarnings(DEFAULT_BRANCH_POLICY, { branch: "main", detached: false })[0]).toMatch(
      /protected branch main/,
    );
    expect(stateWarnings(DEFAULT_BRANCH_POLICY, { branch: null, detached: true })[0]).toMatch(/detached HEAD/);
    expect(stateWarnings(DEFAULT_BRANCH_POLICY, { branch: "new/x", detached: false })).toEqual([]);
  });
});
