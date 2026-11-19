import { copyFile, lstat, mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { conflict } from "../../lib/errors.js";

/** Regular files of a project folder, keyed by posix path; skips VCS, dependency and platform folders. */
export async function readCurrentFiles(root: string): Promise<Map<string, Buffer>> {
  const files = new Map<string, Buffer>();
  const walk = async (dir: string, relative: string) => {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      if (!relative && [".git", ".asaa", "node_modules"].includes(entry.name)) continue;
      const rel = relative ? `${relative}/${entry.name}` : entry.name;
      const full = path.join(dir, entry.name);
      const stats = await lstat(full);
      if (stats.isSymbolicLink()) throw conflict(`"${rel}" is a symbolic link; updates are refused.`);
      if (stats.isDirectory()) await walk(full, rel);
      else if (stats.isFile()) files.set(rel, await readFile(full));
    }
  };
  await walk(root, "");
  return files;
}

export interface UpdateChange {
  path: string;
  action: "unchanged" | "update" | "add" | "remove" | "conflict";
}

/**
 * Write the safe subset of an update plan. Conflicts are never touched; every file that is replaced or
 * removed is first copied to <backup>/ inside the project so the change can be rolled back by hand.
 */
export async function applyChanges(
  directory: string,
  backup: string,
  changes: UpdateChange[],
  target: Map<string, Buffer>,
): Promise<{ applied: string[]; skipped: string[] }> {
  const applied: string[] = [];
  const skipped: string[] = [];
  for (const change of changes) {
    if (change.action === "conflict") skipped.push(change.path);
    if (change.action !== "update" && change.action !== "add" && change.action !== "remove") continue;
    const segments = change.path.split("/");
    const file = path.join(directory, ...segments);
    if (change.action !== "add") {
      const backupPath = path.join(directory, ...backup.split("/"), ...segments);
      await mkdir(path.dirname(backupPath), { recursive: true });
      await copyFile(file, backupPath);
    }
    if (change.action === "remove") await rm(file, { force: true });
    else {
      await mkdir(path.dirname(file), { recursive: true });
      await writeFile(file, target.get(change.path)!);
    }
    applied.push(change.path);
  }
  return { applied, skipped };
}
