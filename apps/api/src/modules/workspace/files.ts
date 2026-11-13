import { createHash, randomBytes } from "node:crypto";
import { lstat, mkdir, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { branchPolicySchema, DEFAULT_BRANCH_POLICY, PROVENANCE_DIR, unsafePathReason } from "@asaa/contracts";
import type { Request } from "express";
import { z } from "zod";
import { AppError, conflict, notEligible, notFound, validationFailed } from "../../lib/errors.js";
import { audit } from "../audit/audit.service.js";
import { branchRole, parseLog, parseStatus } from "./git.js";
import type { WorkspaceService } from "./workspace.js";

/**
 * Online workspace file API (RG-11): file tree, safe read/write with optimistic-concurrency conflict
 * handling, diff, history and commit. Every path is resolved inside the project's own folder, symbolic
 * links and VCS/dependency folders are never followed, and writes require EDITOR (or owner) access.
 */
export const FILE_LIMITS = { fileBytes: 256 * 1024, treeEntries: 500, diffBytes: 200 * 1024 } as const;
const HIDDEN = new Set([".git", "node_modules"]);
const SHA = /^[0-9a-f]{7,40}$/;

const sha256 = (value: Buffer | string) => createHash("sha256").update(value).digest("hex");

export const writeFileSchema = z.object({
  path: z.string().min(1).max(240),
  content: z.string().max(FILE_LIMITS.fileBytes),
  /** SHA-256 of the version the editor started from; null when creating a new file. */
  expectedSha256: z
    .string()
    .regex(/^[0-9a-f]{64}$/)
    .nullable(),
});
export const commitSchema = z.object({
  message: z.string().trim().min(1, "A commit message is required.").max(200),
  paths: z.array(z.string().min(1).max(240)).max(200).optional(),
});

/** Relative path inside the project folder, or throws a validation error. Empty means the root. */
function relative(input: string | undefined, { allowRoot }: { allowRoot: boolean }): string {
  const value = (input ?? "").trim();
  if (!value) {
    if (allowRoot) return "";
    throw validationFailed({ path: "A file path is required." });
  }
  if (value.startsWith("/") || value.includes("\\") || /^[a-zA-Z]:/.test(value) || value.includes("\0")) {
    throw validationFailed({ path: "Use a relative path inside the project." });
  }
  if (value.split("/").some((part) => part === "." || part === "..")) {
    throw validationFailed({ path: "Paths may not contain . or .. segments." });
  }
  const reason = unsafePathReason(value);
  if (reason) throw validationFailed({ path: reason });
  if (value.split("/").some((part) => HIDDEN.has(part))) throw notFound("File");
  return value;
}

/** Walk the path segment by segment, refusing symlinks, and return the absolute location. */
async function locate(
  root: string,
  rel: string,
): Promise<{ full: string; stats: Awaited<ReturnType<typeof lstat>> | null }> {
  let current = root;
  const parts = rel ? rel.split("/") : [];
  for (const [index, part] of parts.entries()) {
    current = path.join(current, part);
    const stats = await lstat(current).catch(() => null);
    if (!stats) {
      if (index < parts.length - 1) return { full: path.join(root, rel), stats: null };
      return { full: current, stats: null };
    }
    if (stats.isSymbolicLink()) throw notEligible(`"${parts.slice(0, index + 1).join("/")}" is a symbolic link.`);
    if (index === parts.length - 1) return { full: current, stats };
    if (!stats.isDirectory()) throw notFound("File");
  }
  return { full: current, stats: await lstat(current) };
}

function isBinary(bytes: Buffer): boolean {
  return bytes.subarray(0, 8000).includes(0);
}

export class WorkspaceFiles {
  constructor(private readonly workspace: WorkspaceService) {}

  private async context(req: Request, projectId: string) {
    const resolved = await this.workspace.resolve(req, projectId);
    const dir = this.workspace.requireDir(resolved.dir, resolved.reason);
    return { ...resolved, dir };
  }

  private get ctx() {
    return this.workspace.appContext;
  }

  async tree(req: Request, projectId: string, rawPath: string | undefined) {
    const { dir } = await this.context(req, projectId);
    const rel = relative(rawPath, { allowRoot: true });
    const { full, stats } = await locate(dir, rel);
    if (!stats || !stats.isDirectory()) throw notFound("Folder");
    const entries: { name: string; path: string; type: "file" | "directory"; size: number | null }[] = [];
    let truncated = false;
    for (const entry of (await readdir(full, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
      if (HIDDEN.has(entry.name)) continue;
      const child = await lstat(path.join(full, entry.name));
      if (child.isSymbolicLink() || !(child.isFile() || child.isDirectory())) continue;
      if (entries.length >= FILE_LIMITS.treeEntries) {
        truncated = true;
        break;
      }
      entries.push({
        name: entry.name,
        path: rel ? `${rel}/${entry.name}` : entry.name,
        type: child.isDirectory() ? "directory" : "file",
        size: child.isFile() ? child.size : null,
      });
    }
    entries.sort((a, b) => (a.type === b.type ? a.name.localeCompare(b.name) : a.type === "directory" ? -1 : 1));
    return { path: rel, entries, truncated };
  }

  async read(req: Request, projectId: string, rawPath: string | undefined) {
    const { dir } = await this.context(req, projectId);
    const rel = relative(rawPath, { allowRoot: false });
    const { full, stats } = await locate(dir, rel);
    if (!stats || !stats.isFile()) throw notFound("File");
    if (stats.size > FILE_LIMITS.fileBytes) throw notEligible("This file is too large to open in the browser.");
    const bytes = await readFile(full);
    if (isBinary(bytes)) throw notEligible("Binary files cannot be opened in the editor.");
    return { path: rel, size: bytes.length, sha256: sha256(bytes), content: bytes.toString("utf8") };
  }

  async write(req: Request, projectId: string, raw: unknown) {
    const input = writeFileSchema.parse(raw);
    const { project, dir } = await this.context(req, projectId);
    await this.workspace.requireWritable(req, project);
    const rel = relative(input.path, { allowRoot: false });
    const root = rel.split("/")[0]!;
    if (root === PROVENANCE_DIR) throw notEligible("Platform provenance files cannot be edited.");
    const bytes = Buffer.from(input.content, "utf8");
    if (bytes.length > FILE_LIMITS.fileBytes) throw notEligible("This file is too large to save from the browser.");
    return this.workspace.serialize(dir, async () => {
      const { full, stats } = await locate(dir, rel);
      if (stats && !stats.isFile()) throw conflict("That path is a folder.");
      const currentSha = stats ? sha256(await readFile(full)) : null;
      if (currentSha !== input.expectedSha256) {
        await audit(this.ctx, req, {
          action: "workspace.file.conflict",
          outcome: "DENIED",
          targetType: "project",
          targetId: project.id,
          metadata: { path: rel },
        });
        throw new AppError(
          409,
          "CONFLICT",
          currentSha
            ? "This file changed since you opened it. Reload it and merge your edits."
            : "This file no longer exists. Reload to continue.",
          { currentSha256: currentSha ?? "" },
        );
      }
      await mkdir(path.dirname(full), { recursive: true });
      const temp = `${full}.${randomBytes(6).toString("hex")}.tmp`;
      try {
        await writeFile(temp, bytes, { flag: "wx", mode: 0o644 });
        await rename(temp, full);
      } finally {
        await rm(temp, { force: true });
      }
      const sha = sha256(bytes);
      await audit(this.ctx, req, {
        action: "workspace.file.write",
        outcome: "SUCCESS",
        targetType: "project",
        targetId: project.id,
        metadata: { path: rel, bytes: bytes.length, sha256: sha, created: !stats },
      });
      return { path: rel, size: bytes.length, sha256: sha, created: !stats };
    });
  }

  /** Diff of the working tree against HEAD, optionally for one file. */
  async diff(req: Request, projectId: string, rawPath: string | undefined) {
    const { dir, record } = await this.context(req, projectId);
    if (!record) throw conflict("Initialize the repository first.");
    const rel = relative(rawPath, { allowRoot: true });
    return this.workspace.serialize(dir, async () => {
      const git = this.workspace.git;
      const args = ["diff", "--no-color", "--no-ext-diff", "--no-textconv", "HEAD", ...(rel ? ["--", rel] : ["--"])];
      const result = await git.run(dir, args, { allowFailure: true });
      const untracked = parseStatus((await git.run(dir, ["status", "--porcelain=v2", "-z"])).stdout).entries.filter(
        (entry) => entry.state === "untracked" && (!rel || entry.path === rel || entry.path.startsWith(`${rel}/`)),
      );
      const patch = result.stdout.slice(0, FILE_LIMITS.diffBytes);
      return {
        path: rel,
        patch,
        truncated: result.stdout.length > FILE_LIMITS.diffBytes,
        untracked: untracked.map((entry) => entry.path),
      };
    });
  }

  async history(req: Request, projectId: string, rawPath: string | undefined, limitRaw: unknown) {
    const { dir, record } = await this.context(req, projectId);
    if (!record) throw conflict("Initialize the repository first.");
    const rel = relative(rawPath, { allowRoot: true });
    const limit = z.coerce.number().int().min(1).max(100).catch(30).parse(limitRaw);
    return this.workspace.serialize(dir, async () => {
      const result = await this.workspace.git.run(
        dir,
        [
          "log",
          `--max-count=${limit}`,
          "--no-color",
          "--format=%H%x1f%an%x1f%ae%x1f%aI%x1f%s%x1e",
          "HEAD",
          "--",
          ...(rel ? [rel] : []),
        ],
        { allowFailure: true },
      );
      return { path: rel, commits: parseLog(result.stdout) };
    });
  }

  async commitDetail(req: Request, projectId: string, sha: string) {
    const { dir, record } = await this.context(req, projectId);
    if (!record) throw conflict("Initialize the repository first.");
    if (!SHA.test(sha)) throw notFound("Commit");
    return this.workspace.serialize(dir, async () => {
      const git = this.workspace.git;
      const exists = await git.run(dir, ["cat-file", "-e", `${sha}^{commit}`], { allowFailure: true });
      if (exists.exitCode !== 0) throw notFound("Commit");
      const header = await git.run(dir, [
        "show",
        "--no-patch",
        "--no-color",
        "--format=%H%x1f%an%x1f%ae%x1f%aI%x1f%s%x1e",
        sha,
      ]);
      const files = await git.run(dir, ["show", "--no-color", "--name-status", "--format=", sha]);
      const patch = await git.run(dir, ["show", "--no-color", "--no-ext-diff", "--format=", "--patch", sha]);
      return {
        commit: parseLog(header.stdout)[0] ?? null,
        files: files.stdout
          .split("\n")
          .filter(Boolean)
          .map((line) => {
            const [status = "", ...rest] = line.split("\t");
            return { status, path: rest.join("\t") };
          }),
        patch: patch.stdout.slice(0, FILE_LIMITS.diffBytes),
        truncated: patch.stdout.length > FILE_LIMITS.diffBytes,
      };
    });
  }

  /** Commit working-tree changes; refused on the protected production branch (policy: reviewed pull request). */
  async commit(req: Request, projectId: string, raw: unknown) {
    const input = commitSchema.parse(raw);
    const { project, dir, record } = await this.context(req, projectId);
    await this.workspace.requireWritable(req, project);
    if (!record) throw conflict("Initialize the repository first.");
    const policy = record.policy ? branchPolicySchema.parse(record.policy) : DEFAULT_BRANCH_POLICY;
    const paths = (input.paths ?? []).map((candidate) => relative(candidate, { allowRoot: false }));
    return this.workspace.serialize(dir, async () => {
      const git = this.workspace.git;
      const status = parseStatus((await git.run(dir, ["status", "--porcelain=v2", "--branch", "-z"])).stdout);
      const branch = status.head.branch;
      if (!branch) throw conflict("Switch to a branch before committing.");
      if (branchRole(branch, policy) === "production") {
        throw conflict(`${branch} is the protected production branch. Create a work branch and commit there.`);
      }
      if (status.entries.length === 0) throw conflict("There are no changes to commit.");
      if (status.entries.some((entry) => entry.state === "conflicted"))
        throw conflict("Resolve conflicts before committing.");
      await git.run(dir, ["add", "--all", "--", ...(paths.length ? paths : [])]);
      await git.run(dir, ["commit", "--quiet", "--no-verify", "-m", input.message]);
      const head = (await git.run(dir, ["rev-parse", "HEAD"])).stdout.trim();
      await audit(this.ctx, req, {
        action: "workspace.commit",
        outcome: "SUCCESS",
        targetType: "project",
        targetId: project.id,
        metadata: { branch, sha: head, files: paths.length || status.entries.length },
      });
      return { sha: head, branch };
    });
  }
}
