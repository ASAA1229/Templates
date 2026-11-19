import { lstat, mkdir, open, readdir, readFile, realpath, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { PROVENANCE_DIR } from "@asaa/contracts";
import { outputDigest, type RenderPlan } from "./render.js";

/** File-system operations used by the writer; injectable so failure paths can be tested. */
export interface WriterFs {
  mkdir: typeof mkdir;
  writeFile: typeof writeFile;
  rename: typeof rename;
  rm: typeof rm;
}
export const nodeFs: WriterFs = { mkdir, writeFile, rename, rm };

/** Generated content is plain data: owner read/write, group/world read, never executable. */
export const FILE_MODE = 0o644;
export const DIR_MODE = 0o755;
/** Staging folders and locks older than this are leftovers from a crashed process. */
export const STALE_AFTER_MS = 30 * 60 * 1000;
/** Folders at the top of an output that are not part of the generated content digest. */
export const NON_CONTENT_DIRS = new Set([PROVENANCE_DIR, ".git"]);

export class OutputConflictError extends Error {
  constructor(readonly outputDir: string) {
    super(`An output folder named "${outputDir}" already exists.`);
    this.name = "OutputConflictError";
  }
}

export class OutputBusyError extends Error {
  constructor(readonly outputDir: string) {
    super(`Another generation is already writing "${outputDir}". Try again shortly.`);
    this.name = "OutputBusyError";
  }
}

const OUTPUT_DIR_PATTERN = /^[a-z][a-z0-9-]{1,19}$/;

export function isOutputDirName(name: string): boolean {
  return OUTPUT_DIR_PATTERN.test(name);
}

export function inside(parent: string, child: string): boolean {
  const relative = path.relative(parent, child);
  return relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative);
}

/** Resolve the real output root (creating it), so links in the configured path cannot redirect writes later. */
export async function resolveOutputRoot(root: string, fs: WriterFs = nodeFs): Promise<string> {
  await fs.mkdir(root, { recursive: true, mode: DIR_MODE });
  return realpath(root);
}

export async function outputExists(root: string, outputDir: string): Promise<boolean> {
  if (!isOutputDirName(outputDir)) throw new Error("Invalid output folder name.");
  return (await lstat(path.join(root, outputDir)).catch(() => null)) !== null;
}

/**
 * Canonical, verified location of an existing output folder: must be a real
 * directory (not a link or junction) directly inside the real output root.
 */
export async function resolveOutputDir(rootInput: string, outputDir: string): Promise<string | null> {
  if (!isOutputDirName(outputDir)) return null;
  const root = await realpath(rootInput).catch(() => null);
  if (!root) return null;
  const candidate = path.join(root, outputDir);
  const stats = await lstat(candidate).catch(() => null);
  if (!stats || stats.isSymbolicLink() || !stats.isDirectory()) return null;
  const real = await realpath(candidate).catch(() => null);
  if (!real || path.dirname(real) !== root || !inside(root, real)) return null;
  return real;
}

async function renameWithRetry(fs: WriterFs, from: string, to: string) {
  // Windows can briefly lock freshly written folders (indexers, antivirus, OneDrive).
  for (let attempt = 0; ; attempt++) {
    try {
      return await fs.rename(from, to);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (attempt >= 5 || (code !== "EPERM" && code !== "EACCES" && code !== "EBUSY")) throw error;
      await new Promise((resolve) => setTimeout(resolve, 50 * (attempt + 1)));
    }
  }
}

/** Names held by writers in this process; the lock file below covers other processes. */
const heldLocks = new Set<string>();

/**
 * Exclusive per-output-name lock. Creating the lock file with O_EXCL is atomic
 * on every supported file system, so two writers can never publish the same
 * name at the same time. A lock older than STALE_AFTER_MS is treated as left
 * behind by a crash and replaced once.
 */
export async function acquireOutputLock(root: string, outputDir: string): Promise<() => Promise<void>> {
  const key = path.join(root, outputDir).toLowerCase();
  if (heldLocks.has(key)) throw new OutputBusyError(outputDir);
  const lockPath = path.join(root, `.lock-${outputDir}`);
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const handle = await open(lockPath, "wx", FILE_MODE);
      await handle.writeFile(`${process.pid}\n`);
      await handle.close();
      heldLocks.add(key);
      return async () => {
        heldLocks.delete(key);
        await rm(lockPath, { force: true }).catch(() => undefined);
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      const age = Date.now() - ((await stat(lockPath).catch(() => null))?.mtimeMs ?? Date.now());
      if (attempt > 0 || age < STALE_AFTER_MS) throw new OutputBusyError(outputDir);
      await rm(lockPath, { force: true });
    }
  }
  throw new OutputBusyError(outputDir);
}

/** Remove staging folders and lock files abandoned by a crashed process. */
export async function cleanupStale(root: string, now = Date.now()): Promise<string[]> {
  const removed: string[] = [];
  for (const entry of await readdir(root, { withFileTypes: true }).catch(() => [])) {
    const staging = entry.name.startsWith(".staging-") && entry.isDirectory();
    const lock = entry.name.startsWith(".lock-") && entry.isFile();
    if (!staging && !lock) continue;
    const full = path.join(root, entry.name);
    const stats = await lstat(full).catch(() => null);
    if (!stats || stats.isSymbolicLink() || now - stats.mtimeMs < STALE_AFTER_MS) continue;
    if (lock && heldLocks.has(path.join(root, entry.name.slice(".lock-".length)).toLowerCase())) continue;
    await rm(full, { recursive: true, force: true }).catch(() => undefined);
    removed.push(entry.name);
  }
  return removed;
}

/**
 * Write a rendered plan as a new, independent output folder.
 *
 * Files are written into a private staging folder with exclusive-create flags
 * and fixed non-executable permissions, then the staging folder is renamed into
 * place in one step while holding an exclusive lock for the output name. An
 * existing output is never overwritten or merged into: on Windows a rename onto
 * an existing folder fails, and on POSIX it only succeeds onto an *empty* folder,
 * so no existing content can be replaced. A failure removes the staging folder,
 * so a half-written output is never left behind under the final name.
 */
export async function writeOutput(
  rootInput: string,
  outputDir: string,
  stagingId: string,
  plan: RenderPlan,
  provenance: Record<string, unknown>,
  fs: WriterFs = nodeFs,
): Promise<string> {
  if (!isOutputDirName(outputDir)) throw new Error("Invalid output folder name.");
  if (!/^[0-9a-f-]{36}$/.test(stagingId)) throw new Error("Invalid staging id.");
  const root = await resolveOutputRoot(rootInput, fs);
  const finalDir = path.join(root, outputDir);
  const staging = path.join(root, `.staging-${stagingId}`);
  if (!inside(root, finalDir) || !inside(root, staging)) throw new Error("Output escapes the generation root.");
  await cleanupStale(root);
  const release = await acquireOutputLock(root, outputDir);
  try {
    if (await outputExists(root, outputDir)) throw new OutputConflictError(outputDir);
    await fs.rm(staging, { recursive: true, force: true });
    try {
      await fs.mkdir(staging, { mode: DIR_MODE });
      const resolveTarget = (relative: string) => {
        const target = path.join(staging, ...relative.split("/"));
        if (!inside(staging, target)) throw new Error(`"${relative}" escapes the output folder.`);
        return target;
      };
      for (const dir of plan.directories) await fs.mkdir(resolveTarget(dir), { recursive: true, mode: DIR_MODE });
      for (const file of plan.files) {
        const target = resolveTarget(file.path);
        await fs.mkdir(path.dirname(target), { recursive: true, mode: DIR_MODE });
        await fs.writeFile(target, file.content, { flag: "wx", mode: FILE_MODE });
      }
      const provenanceDir = resolveTarget(PROVENANCE_DIR);
      await fs.mkdir(provenanceDir, { recursive: true, mode: DIR_MODE });
      await fs.writeFile(path.join(provenanceDir, "generation.json"), `${JSON.stringify(provenance, null, 2)}\n`, {
        flag: "wx",
        mode: FILE_MODE,
      });
      // Re-check right before publishing; rename onto an existing folder must never merge outputs.
      if (await outputExists(root, outputDir)) throw new OutputConflictError(outputDir);
      await renameWithRetry(fs, staging, finalDir);
      return finalDir;
    } catch (error) {
      await fs.rm(staging, { recursive: true, force: true }).catch(() => undefined);
      const code = (error as NodeJS.ErrnoException).code;
      // A folder that appeared between the check and the rename surfaces as a rename error.
      if (code === "ENOTEMPTY" || code === "EEXIST") throw new OutputConflictError(outputDir);
      throw error;
    }
  } finally {
    await release();
  }
}

/** Provenance written into an output folder, if it is a real file. */
export async function readProvenance(rootInput: string, outputDir: string): Promise<Record<string, unknown> | null> {
  const dir = await resolveOutputDir(rootInput, outputDir);
  if (!dir) return null;
  const file = path.join(dir, PROVENANCE_DIR, "generation.json");
  const stats = await lstat(file).catch(() => null);
  if (!stats?.isFile() || stats.size > 1024 * 1024) return null;
  try {
    return JSON.parse(await readFile(file, "utf8")) as Record<string, unknown>;
  } catch {
    return null;
  }
}

/** Remove an output this platform generated (used to compensate when recording success fails). */
export async function removeOutput(rootInput: string, outputDir: string, fs: WriterFs = nodeFs): Promise<void> {
  if (!isOutputDirName(outputDir)) throw new Error("Invalid output folder name.");
  const root = await realpath(rootInput).catch(() => null);
  if (!root) return;
  const target = path.join(root, outputDir);
  if (!inside(root, target)) throw new Error("Output escapes the generation root.");
  await fs.rm(target, { recursive: true, force: true });
}

/**
 * Digest of an output folder on disk, excluding provenance and version-control
 * metadata. Symlinks or special files make the output untrusted (null).
 */
export async function digestOutput(rootInput: string, outputDir: string): Promise<string | null> {
  const base = await resolveOutputDir(rootInput, outputDir);
  if (!base) return null;
  const directories: string[] = [];
  const files: { path: string; content: Buffer }[] = [];
  const walk = async (dir: string, relative: string): Promise<boolean> => {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const rel = relative ? `${relative}/${entry.name}` : entry.name;
      if (!relative && NON_CONTENT_DIRS.has(entry.name)) continue;
      const full = path.join(dir, entry.name);
      const stats = await lstat(full);
      if (stats.isSymbolicLink()) return false;
      if (stats.isDirectory()) {
        directories.push(rel);
        if (!(await walk(full, rel))) return false;
      } else if (stats.isFile()) files.push({ path: rel, content: await readFile(full) });
      else return false;
    }
    return true;
  };
  if (!(await walk(base, ""))) return null;
  return outputDigest(directories, files);
}
