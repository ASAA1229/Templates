import { lstat, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  branchNameProblem,
  type BranchPolicy,
  type BranchView,
  type CommitView,
  type GitIdentity,
  type RepositoryCapabilitiesView,
  type RepositoryStateView,
  type WorkingTreeEntryView,
} from "@asaa/contracts";
import { baseEnvironment, runProcess } from "../../lib/process.js";

export class GitCommandError extends Error {
  constructor(
    message: string,
    readonly stderr: string,
  ) {
    super(message);
    this.name = "GitCommandError";
  }
}

const MAX_OUTPUT = 1024 * 1024;
const MAX_STATUS_ENTRIES = 500;
const SHA = /^[0-9a-f]{40}([0-9a-f]{24})?$/;

/** Repository-relative presence of a .git entry: none, a real folder, or something unsafe (file/link). */
export async function detectGitDir(dir: string): Promise<"none" | "directory" | "unsafe"> {
  const stats = await lstat(path.join(dir, ".git")).catch(() => null);
  if (!stats) return "none";
  // A .git *file* (gitdir: …) or link could point the work tree at a repository elsewhere.
  return stats.isDirectory() && !stats.isSymbolicLink() ? "directory" : "unsafe";
}

/**
 * Thin, safe wrapper around the Git executable. Every call:
 * - uses the fixed configured executable with an argument array (no shell);
 * - pins --git-dir/--work-tree to the given project folder and sets
 *   GIT_CEILING_DIRECTORIES so Git can never discover a parent repository;
 * - ignores system/global config, disables hooks, fsmonitor, credential
 *   prompts and every network/file transport (protocol.allow=never).
 */
export class GitClient {
  private readonly supportDir: string;
  private readonly hooksDir: string;
  private readonly globalConfig: string;
  constructor(
    readonly executable: string,
    readonly timeoutMs: number,
    /** Folder that contains all project repositories (the generation output root). */
    readonly ceiling: string,
  ) {
    // Platform-owned support files next to (never inside) project folders: an empty
    // hooks folder and an empty "global" config, so user/system settings never apply.
    this.supportDir = path.join(ceiling, ".asaa-git");
    this.hooksDir = path.join(this.supportDir, "hooks");
    this.globalConfig = path.join(this.supportDir, "config");
  }

  private async ensureSupport() {
    await mkdir(this.hooksDir, { recursive: true });
    await writeFile(this.globalConfig, "", { flag: "a" });
  }

  private env(): Record<string, string> {
    return {
      ...baseEnvironment(),
      GIT_CONFIG_NOSYSTEM: "1",
      GIT_CONFIG_GLOBAL: this.globalConfig,
      GIT_TERMINAL_PROMPT: "0",
      GIT_ASKPASS: "",
      SSH_ASKPASS: "",
      GIT_OPTIONAL_LOCKS: "0",
      GIT_CEILING_DIRECTORIES: this.ceiling,
      GIT_ADVICE: "0",
    };
  }

  private safetyConfig(): string[] {
    return [
      "-c",
      `core.hooksPath=${this.hooksDir}`,
      "-c",
      "core.fsmonitor=false",
      "-c",
      "protocol.allow=never",
      "-c",
      "commit.gpgSign=false",
      "-c",
      "core.quotePath=false",
    ];
  }

  async version(): Promise<string> {
    await this.ensureSupport();
    const result = await runProcess(this.executable, ["--version"], {
      cwd: this.ceiling,
      timeoutMs: Math.min(this.timeoutMs, 10_000),
      maxOutputBytes: 4096,
      env: this.env(),
    });
    const match = result.stdout.match(/git version (\d+\.\d+\.\d+)/);
    if (result.exitCode !== 0 || !match) throw new GitCommandError("Could not read the Git version.", result.stderr);
    return match[1]!;
  }

  /** Run a Git subcommand inside one repository. Non-zero exit throws unless allowed. */
  async run(dir: string, args: string[], options: { allowFailure?: boolean } = {}) {
    await this.ensureSupport();
    const result = await runProcess(
      this.executable,
      [`--git-dir=${path.join(dir, ".git")}`, `--work-tree=${dir}`, ...this.safetyConfig(), ...args],
      { cwd: dir, timeoutMs: this.timeoutMs, maxOutputBytes: MAX_OUTPUT, env: this.env() },
    );
    if (result.exitCode !== 0 && !options.allowFailure) {
      throw new GitCommandError(`git ${args[0]} failed.`, result.stderr.slice(0, 2000));
    }
    return result;
  }

  /** `git init` without --git-dir (it would otherwise create a bare layout). */
  async init(dir: string, initialBranch: string) {
    if (branchNameProblem(initialBranch)) throw new Error("Invalid initial branch.");
    await this.ensureSupport();
    const result = await runProcess(
      this.executable,
      [...this.safetyConfig(), "init", "--quiet", `--initial-branch=${initialBranch}`, dir],
      { cwd: dir, timeoutMs: this.timeoutMs, maxOutputBytes: 64 * 1024, env: this.env() },
    );
    if (result.exitCode !== 0) throw new GitCommandError("git init failed.", result.stderr.slice(0, 2000));
  }
}

/** Parse `git status --porcelain=v2 --branch -z`. */
export function parseStatus(output: string): {
  head: RepositoryStateView["head"];
  entries: WorkingTreeEntryView[];
  truncated: boolean;
} {
  const records = output.split("\0");
  let branch: string | null = null;
  let sha: string | null = null;
  let detached = false;
  const entries: WorkingTreeEntryView[] = [];
  let truncated = false;
  const stateOf = (xy: string): WorkingTreeEntryView["state"] => {
    if (xy.includes("U") || xy === "AA" || xy === "DD") return "conflicted";
    if (xy.includes("R") || xy.includes("C")) return "renamed";
    if (xy.includes("A")) return "added";
    if (xy.includes("D")) return "deleted";
    if (xy.includes("T")) return "typechange";
    return "modified";
  };
  for (let i = 0; i < records.length; i++) {
    const record = records[i]!;
    if (!record) continue;
    if (record.startsWith("# branch.oid ")) {
      const value = record.slice("# branch.oid ".length);
      sha = SHA.test(value) ? value : null;
    } else if (record.startsWith("# branch.head ")) {
      const value = record.slice("# branch.head ".length);
      detached = value === "(detached)";
      branch = detached ? null : value;
    } else if (record.startsWith("#")) {
      continue;
    } else if (entries.length >= MAX_STATUS_ENTRIES) {
      truncated = true;
    } else if (record.startsWith("1 ") || record.startsWith("u ")) {
      const parts = record.split(" ");
      const xy = parts[1]!;
      const pathPart = parts.slice(record.startsWith("1 ") ? 8 : 10).join(" ");
      entries.push({
        path: pathPart,
        state: record.startsWith("u ") ? "conflicted" : stateOf(xy),
        staged: xy[0] !== ".",
      });
    } else if (record.startsWith("2 ")) {
      const parts = record.split(" ");
      const xy = parts[1]!;
      const from = records[++i] ?? "";
      entries.push({ path: parts.slice(9).join(" "), state: "renamed", staged: xy[0] !== ".", from });
    } else if (record.startsWith("? ")) {
      entries.push({ path: record.slice(2), state: "untracked", staged: false });
    }
  }
  return { head: { branch, sha, detached }, entries, truncated };
}

const FIELD = "\x1f";
const RECORD = "\x1e";

export function parseLog(output: string): CommitView[] {
  return output
    .split(RECORD)
    .map((record) => record.replace(/^\n/, ""))
    .filter(Boolean)
    .map((record) => {
      const [sha = "", author = "", email = "", date = "", subject = ""] = record.split(FIELD);
      return { sha, author, email, date, subject: subject.slice(0, 300) };
    })
    .filter((commit) => SHA.test(commit.sha));
}

export function branchRole(name: string, policy: BranchPolicy): BranchView["role"] {
  if (name === policy.productionBranch) return "production";
  if (name === policy.integrationBranch) return "integration";
  const prefix = name.split("/")[0];
  if (prefix === policy.featurePrefix) return "feature";
  if (prefix === policy.fixPrefix) return "fix";
  if (prefix === policy.testPrefix) return "test";
  return "other";
}

export function parseBranches(output: string, policy: BranchPolicy): BranchView[] {
  return output
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const [name = "", sha = "", head = ""] = line.split(FIELD);
      return {
        name,
        sha,
        current: head.trim() === "*",
        protected: policy.protectedBranches.includes(name),
        role: branchRole(name, policy),
      };
    })
    .filter((branch) => branch.name && SHA.test(branch.sha));
}

/**
 * Replaceable source-control provider (US-F01). The project domain talks to this
 * interface only; GitHub/GitLab/Bitbucket adapters can implement it later
 * without touching projects, generation or the workspace UI.
 */
export interface RepositoryProvider {
  capabilities(): RepositoryCapabilitiesView;
  initialize(
    dir: string,
    options: { defaultBranch: string; identity: GitIdentity; initialCommitMessage: string | null },
  ): Promise<void>;
  inspect(dir: string, policy: BranchPolicy, historyLimit: number): Promise<RepositoryStateView>;
  createBranch(dir: string, name: string, from: string, switchTo: boolean): Promise<void>;
  switchBranch(dir: string, name: string): Promise<void>;
  setIdentity(dir: string, identity: GitIdentity): Promise<void>;
  setRemote(dir: string, name: string, url: string | null): Promise<void>;
}

export class LocalGitProvider implements RepositoryProvider {
  constructor(readonly git: GitClient) {}

  capabilities(): RepositoryCapabilitiesView {
    return {
      provider: "LOCAL_GIT",
      label: "Local Git repository",
      available: true,
      initialize: true,
      status: true,
      branches: true,
      history: true,
      remotes: "configure-only",
      pullRequests: false,
      branchProtection: "advisory",
      note: "Runs on this machine only. Remotes are recorded but nothing is pushed or fetched.",
    };
  }

  async initialize(
    dir: string,
    options: { defaultBranch: string; identity: GitIdentity; initialCommitMessage: string | null },
  ) {
    await this.git.init(dir, options.defaultBranch);
    await this.setIdentity(dir, options.identity);
    if (options.initialCommitMessage) {
      await this.git.run(dir, ["add", "--all"]);
      await this.git.run(dir, [
        "commit",
        "--quiet",
        "--no-verify",
        "--allow-empty",
        "-m",
        options.initialCommitMessage,
      ]);
    }
  }

  async inspect(dir: string, policy: BranchPolicy, historyLimit: number): Promise<RepositoryStateView> {
    // Independent read-only commands run concurrently: each spawn is slow on loaded Windows hosts.
    // for-each-ref expands %1f to the unit-separator character; log fails harmlessly on an unborn branch.
    const [statusResult, refs, log] = await Promise.all([
      this.git.run(dir, ["status", "--porcelain=v2", "--branch", "-z"]),
      this.git.run(dir, ["for-each-ref", "--format=%(refname:short)%1f%(objectname)%1f%(HEAD)", "refs/heads/"]),
      this.git.run(
        dir,
        [
          "log",
          `--max-count=${Math.max(1, Math.min(historyLimit, 100))}`,
          "--no-color",
          `--format=%H%x1f%an%x1f%ae%x1f%aI%x1f%s%x1e`,
          "HEAD",
          "--",
        ],
        { allowFailure: true },
      ),
    ]);
    const status = parseStatus(statusResult.stdout);
    const branches = parseBranches(refs.stdout, policy);
    const commits = status.head.sha && log.exitCode === 0 ? parseLog(log.stdout) : [];
    return {
      head: status.head,
      branches,
      status: { clean: status.entries.length === 0, entries: status.entries, truncated: status.truncated },
      commits,
    };
  }

  async createBranch(dir: string, name: string, from: string, switchTo: boolean) {
    if (branchNameProblem(name) || branchNameProblem(from)) throw new Error("Invalid branch name.");
    await this.git.run(dir, ["branch", "--no-track", "--end-of-options", name, `refs/heads/${from}`]);
    if (switchTo) await this.git.run(dir, ["switch", "--quiet", "--end-of-options", name]);
  }

  async switchBranch(dir: string, name: string) {
    if (branchNameProblem(name)) throw new Error("Invalid branch name.");
    await this.git.run(dir, ["switch", "--quiet", "--end-of-options", name]);
  }

  async setIdentity(dir: string, identity: GitIdentity) {
    await this.git.run(dir, ["config", "--local", "user.name", identity.name]);
    await this.git.run(dir, ["config", "--local", "user.email", identity.email]);
  }

  async setRemote(dir: string, name: string, url: string | null) {
    if (!/^[a-z][a-z0-9-]{0,39}$/.test(name)) throw new Error("Invalid remote name.");
    const existing = await this.git.run(dir, ["remote"], { allowFailure: true });
    const has = existing.stdout.split("\n").includes(name);
    if (url === null) {
      if (has) await this.git.run(dir, ["remote", "remove", name]);
      return;
    }
    await this.git.run(dir, has ? ["remote", "set-url", "--", name, url] : ["remote", "add", "--", name, url]);
  }
}

/** Providers prepared for later phases: listed for capability discovery, not usable yet. */
export const FUTURE_PROVIDERS: RepositoryCapabilitiesView[] = (
  [
    ["GITHUB", "GitHub"],
    ["GITLAB", "GitLab"],
    ["BITBUCKET", "Bitbucket"],
  ] as const
).map(([provider, label]) => ({
  provider,
  label,
  available: false,
  initialize: false,
  status: false,
  branches: false,
  history: false,
  remotes: "sync",
  pullRequests: true,
  branchProtection: "enforced",
  note: "Planned. Requires owner approval and credentials stored outside source control.",
}));
