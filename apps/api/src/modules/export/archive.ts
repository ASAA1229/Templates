import { createHash } from "node:crypto";
import { lstat, readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { notEligible } from "../../lib/errors.js";
import { createZip, type ZipEntry } from "./zip.js";

/** Never exported: VCS metadata and dependency folders. */
const EXCLUDED = new Set([".git", "node_modules"]);
export const EXPORT_LIMITS = { files: 2000, fileBytes: 10 * 1024 * 1024, totalBytes: 50 * 1024 * 1024 } as const;

export interface ArchiveSource {
  directory: string;
  project: { key: string; name: string };
  generation: {
    id: string;
    templateId: string;
    templateVersion: string;
    templateDigest: string;
    generatorVersion: string;
    inputsHash: string;
    outputDigest: string | null;
    completedAt: string | null;
  };
  /** Digest of what is on disk now; compared with generation.outputDigest. */
  currentDigest: string | null;
}

const sha256 = (value: Buffer | string) => createHash("sha256").update(value).digest("hex");

/** Collect regular files only: symlinks and special files make the export unsafe and are refused. */
async function collect(root: string): Promise<{ path: string; content: Buffer }[]> {
  const files: { path: string; content: Buffer }[] = [];
  let total = 0;
  const walk = async (dir: string, relative: string) => {
    for (const entry of (await readdir(dir, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
      if (EXCLUDED.has(entry.name)) continue;
      const rel = relative ? `${relative}/${entry.name}` : entry.name;
      const full = path.join(dir, entry.name);
      const stats = await lstat(full);
      if (stats.isSymbolicLink()) throw notEligible(`Cannot export: "${rel}" is a symbolic link.`);
      if (stats.isDirectory()) await walk(full, rel);
      else if (stats.isFile()) {
        if (stats.size > EXPORT_LIMITS.fileBytes) throw notEligible(`Cannot export: "${rel}" is too large.`);
        total += stats.size;
        if (files.length >= EXPORT_LIMITS.files || total > EXPORT_LIMITS.totalBytes) {
          throw notEligible("Cannot export: the project is larger than the export limits.");
        }
        files.push({ path: rel, content: await readFile(full) });
      } else throw notEligible(`Cannot export: "${rel}" is not a regular file.`);
    }
  };
  await walk(root, "");
  return files;
}

/** Complete, deterministic ZIP of a generated project with a manifest, provenance and SHA-256 checksums. */
export async function buildProjectArchive(
  source: ArchiveSource,
): Promise<{ filename: string; archive: Buffer; manifest: unknown }> {
  const files = await collect(source.directory);
  const rootName = source.project.key.toLowerCase().replace(/[^a-z0-9._-]/g, "-");
  const manifest = {
    schemaVersion: 1,
    project: source.project,
    generation: source.generation,
    modifiedSinceGeneration: source.currentDigest !== source.generation.outputDigest,
    excluded: [...EXCLUDED],
    totals: { files: files.length, bytes: files.reduce((sum, file) => sum + file.content.length, 0) },
    files: files.map((file) => ({ path: file.path, bytes: file.content.length, sha256: sha256(file.content) })),
  };
  const manifestBytes = Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  const sums = Buffer.from(
    `${[...manifest.files.map((file) => `${file.sha256}  ${file.path}`), `${sha256(manifestBytes)}  EXPORT-MANIFEST.json`].join("\n")}\n`,
    "utf8",
  );
  const entries: ZipEntry[] = [
    ...files.map((file) => ({ name: `${rootName}/${file.path}`, content: file.content })),
    { name: `${rootName}/EXPORT-MANIFEST.json`, content: manifestBytes },
    { name: `${rootName}/SHA256SUMS`, content: sums },
  ];
  const reserved = files.find((file) => ["EXPORT-MANIFEST.json", "SHA256SUMS"].includes(file.path));
  if (reserved) throw notEligible(`Cannot export: "${reserved.path}" collides with an export metadata file.`);
  const archive = createZip(entries);
  return {
    filename: `${rootName}-${(source.generation.outputDigest ?? sha256(archive)).slice(0, 12)}.zip`,
    archive,
    manifest,
  };
}
