import { lstat, mkdir, readdir, readFile, realpath, rename, rm, writeFile } from "node:fs/promises";
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

export class OutputConflictError extends Error {
  constructor(readonly outputDir: string) {
    super(`An output folder named "${outputDir}" already exists.`);
    this.name = "OutputConflictError";
  }
}

const OUTPUT_DIR_PATTERN = /^[a-z][a-z0-9-]{1,19}$/;

function inside(parent: string, child: string): boolean {
  const relative = path.relative(parent, child);
  return relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative);
}

/** Resolve the real output root (creating it), so links in the configured path cannot redirect writes later. */
export async function resolveOutputRoot(root: string, fs: WriterFs = nodeFs): Promise<string> {
  await fs.mkdir(root, { recursive: true });
  return realpath(root);
}

export async function outputExists(root: string, outputDir: string): Promise<boolean> {
  if (!OUTPUT_DIR_PATTERN.test(outputDir)) throw new Error("Invalid output folder name.");
  return (await lstat(path.join(root, outputDir)).catch(() => null)) !== null;
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

/**
 * Write a rendered plan as a new, independent output folder.
 *
 * Files are written into a private staging folder with exclusive-create flags,
 * then the staging folder is renamed into place in one step. An existing output
 * is never overwritten or merged into, and a failure removes the staging folder,
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
  if (!OUTPUT_DIR_PATTERN.test(outputDir)) throw new Error("Invalid output folder name.");
  if (!/^[0-9a-f-]{36}$/.test(stagingId)) throw new Error("Invalid staging id.");
  const root = await resolveOutputRoot(rootInput, fs);
  const finalDir = path.join(root, outputDir);
  const staging = path.join(root, `.staging-${stagingId}`);
  if (!inside(root, finalDir) || !inside(root, staging)) throw new Error("Output escapes the generation root.");
  if (await outputExists(root, outputDir)) throw new OutputConflictError(outputDir);

  await fs.rm(staging, { recursive: true, force: true });
  try {
    await fs.mkdir(staging);
    const resolveTarget = (relative: string) => {
      const target = path.join(staging, ...relative.split("/"));
      if (!inside(staging, target)) throw new Error(`"${relative}" escapes the output folder.`);
      return target;
    };
    for (const dir of plan.directories) await fs.mkdir(resolveTarget(dir), { recursive: true });
    for (const file of plan.files) {
      const target = resolveTarget(file.path);
      await fs.mkdir(path.dirname(target), { recursive: true });
      await fs.writeFile(target, file.content, { flag: "wx" });
    }
    const provenanceDir = resolveTarget(PROVENANCE_DIR);
    await fs.mkdir(provenanceDir, { recursive: true });
    await fs.writeFile(path.join(provenanceDir, "generation.json"), `${JSON.stringify(provenance, null, 2)}\n`, {
      flag: "wx",
    });
    // Re-check right before publishing; rename onto an existing folder must never merge outputs.
    if (await outputExists(root, outputDir)) throw new OutputConflictError(outputDir);
    await renameWithRetry(fs, staging, finalDir);
    return finalDir;
  } catch (error) {
    await fs.rm(staging, { recursive: true, force: true }).catch(() => undefined);
    throw error;
  }
}

/** Remove an output this platform generated (used to compensate when recording success fails). */
export async function removeOutput(rootInput: string, outputDir: string, fs: WriterFs = nodeFs): Promise<void> {
  if (!OUTPUT_DIR_PATTERN.test(outputDir)) throw new Error("Invalid output folder name.");
  const root = await realpath(rootInput).catch(() => null);
  if (!root) return;
  const target = path.join(root, outputDir);
  if (!inside(root, target)) throw new Error("Output escapes the generation root.");
  await fs.rm(target, { recursive: true, force: true });
}

/** Digest of an output folder on disk, excluding provenance; symlinks make the output untrusted. */
export async function digestOutput(rootInput: string, outputDir: string): Promise<string | null> {
  if (!OUTPUT_DIR_PATTERN.test(outputDir)) return null;
  const root = await realpath(rootInput).catch(() => null);
  if (!root) return null;
  const base = path.join(root, outputDir);
  if (!(await lstat(base).catch(() => null))?.isDirectory()) return null;
  const directories: string[] = [];
  const files: { path: string; content: Buffer }[] = [];
  const walk = async (dir: string, relative: string): Promise<boolean> => {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const rel = relative ? `${relative}/${entry.name}` : entry.name;
      if (!relative && entry.name === PROVENANCE_DIR) continue;
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
