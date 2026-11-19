import { createHash } from "node:crypto";
import { lstat, readdir, readFile } from "node:fs/promises";
import path from "node:path";
import {
  GENERATOR_MAJOR,
  placeholdersIn,
  RESERVED_VARIABLES,
  templateManifestSchema,
  unsafePathReason,
  type TemplateManifest,
} from "@asaa/contracts";

/** Hard limits for template content read from disk. */
export const LIBRARY_LIMITS = {
  manifestBytes: 64 * 1024,
  fileBytes: 512 * 1024,
  totalBytes: 4 * 1024 * 1024,
  files: 300,
} as const;

export interface LibraryTemplate {
  id: string;
  version: string;
  /** Present only when the manifest itself is valid. */
  manifest: TemplateManifest | null;
  /** Raw manifest JSON as stored; returned to clients for boundary re-validation. */
  rawManifest: unknown;
  /** Source files keyed by their posix path inside files/. */
  files: Map<string, Buffer>;
  /** SHA-256 over the manifest and every file; null when the content could not be read. */
  digest: string | null;
  problems: string[];
}

export const isUsable = (
  template: LibraryTemplate,
): template is LibraryTemplate & {
  manifest: TemplateManifest;
  digest: string;
} => template.problems.length === 0 && template.manifest !== null && template.digest !== null;

const ID_PATTERN = /^[a-z0-9][a-z0-9-]{1,79}$/;
const VERSION_PATTERN = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;

function compareVersions(a: string, b: string): number {
  const [coreA = "", preA] = a.split("-", 2);
  const [coreB = "", preB] = b.split("-", 2);
  const partsA = coreA.split(".").map(Number);
  const partsB = coreB.split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    const diff = (partsA[i] ?? 0) - (partsB[i] ?? 0);
    if (diff !== 0) return diff;
  }
  if (preA === preB) return 0;
  if (!preA) return 1;
  if (!preB) return -1;
  return preA < preB ? -1 : 1;
}

/** Deterministic digest: manifest bytes, then files sorted by path with explicit lengths. */
export function contentDigest(manifestBytes: Buffer, files: Map<string, Buffer>): string {
  const hash = createHash("sha256");
  hash.update(`manifest\0${manifestBytes.length}\0`);
  hash.update(manifestBytes);
  for (const name of [...files.keys()].sort()) {
    const bytes = files.get(name)!;
    hash.update(`\0file\0${name}\0${bytes.length}\0`);
    hash.update(bytes);
  }
  return hash.digest("hex");
}

/**
 * Walk files/ without following links. Symlinks, junctions, devices and other
 * non-regular entries are rejected, as are unsafe names and oversized content.
 */
async function readTemplateFiles(root: string, problems: string[]): Promise<Map<string, Buffer>> {
  const files = new Map<string, Buffer>();
  let total = 0;
  const walk = async (dir: string, relative: string) => {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const rel = relative ? `${relative}/${entry.name}` : entry.name;
      const reason = unsafePathReason(rel);
      if (reason) {
        problems.push(`files/${rel}: ${reason}`);
        continue;
      }
      const full = path.join(dir, entry.name);
      const stats = await lstat(full);
      if (stats.isSymbolicLink()) {
        problems.push(`files/${rel}: symbolic links are not allowed in template content.`);
      } else if (stats.isDirectory()) {
        await walk(full, rel);
      } else if (!stats.isFile()) {
        problems.push(`files/${rel}: only regular files are allowed.`);
      } else if (stats.size > LIBRARY_LIMITS.fileBytes) {
        problems.push(`files/${rel}: larger than ${LIBRARY_LIMITS.fileBytes} bytes.`);
      } else if (files.size >= LIBRARY_LIMITS.files) {
        problems.push(`Template has more than ${LIBRARY_LIMITS.files} files.`);
        return;
      } else {
        total += stats.size;
        if (total > LIBRARY_LIMITS.totalBytes) {
          problems.push(`Template content is larger than ${LIBRARY_LIMITS.totalBytes} bytes.`);
          return;
        }
        files.set(rel, await readFile(full));
      }
    }
  };
  const rootStats = await lstat(root).catch(() => null);
  if (!rootStats) problems.push("files/ folder is missing.");
  else if (rootStats.isSymbolicLink() || !rootStats.isDirectory()) problems.push("files/ must be a real folder.");
  else await walk(root, "");
  return files;
}

/** Cross-check manifest against content: every listed file exists, nothing unlisted, placeholders declared. */
function checkContent(manifest: TemplateManifest, files: Map<string, Buffer>, problems: string[]) {
  const listed = new Set(manifest.files.map((file) => file.source));
  for (const source of listed) if (!files.has(source)) problems.push(`files/${source} is listed but missing.`);
  for (const name of files.keys()) if (!listed.has(name)) problems.push(`files/${name} is not listed in the manifest.`);
  const known = new Set<string>([...RESERVED_VARIABLES, ...manifest.inputs.map((input) => input.id)]);
  const decoder = new TextDecoder("utf-8", { fatal: true });
  for (const file of manifest.files) {
    const bytes = files.get(file.source);
    if (!bytes || file.substitute === "none") continue;
    let text: string;
    try {
      text = decoder.decode(bytes);
    } catch {
      problems.push(`files/${file.source} is not valid UTF-8 text; use substitute "none" for binary files.`);
      continue;
    }
    for (const name of placeholdersIn(text)) {
      if (!known.has(name)) problems.push(`files/${file.source} uses undeclared placeholder "${name}".`);
    }
  }
  if (manifest.compatibility.generator !== GENERATOR_MAJOR) {
    problems.push(
      `Requires generator ${manifest.compatibility.generator}.x; this platform provides ${GENERATOR_MAJOR}.x.`,
    );
  }
}

async function loadTemplate(versionDir: string, id: string, version: string): Promise<LibraryTemplate> {
  const problems: string[] = [];
  const template: LibraryTemplate = {
    id,
    version,
    manifest: null,
    rawManifest: null,
    files: new Map(),
    digest: null,
    problems,
  };
  const manifestPath = path.join(versionDir, "manifest.json");
  const manifestStats = await lstat(manifestPath).catch(() => null);
  if (!manifestStats || !manifestStats.isFile() || manifestStats.isSymbolicLink()) {
    problems.push("manifest.json is missing or not a regular file.");
    return template;
  }
  if (manifestStats.size > LIBRARY_LIMITS.manifestBytes) {
    problems.push(`manifest.json is larger than ${LIBRARY_LIMITS.manifestBytes} bytes.`);
    return template;
  }
  const manifestBytes = await readFile(manifestPath);
  try {
    template.rawManifest = JSON.parse(manifestBytes.toString("utf8"));
  } catch {
    problems.push("manifest.json is not valid JSON.");
    return template;
  }
  const parsed = templateManifestSchema.safeParse(template.rawManifest);
  if (!parsed.success) {
    for (const issue of parsed.error.issues.slice(0, 10)) {
      problems.push(`manifest ${issue.path.join(".") || "(root)"}: ${issue.message}`);
    }
  } else {
    template.manifest = parsed.data;
    if (parsed.data.id !== id || parsed.data.version !== version) {
      problems.push(`Manifest identity ${parsed.data.id}@${parsed.data.version} does not match its folder.`);
    }
  }
  template.files = await readTemplateFiles(path.join(versionDir, "files"), problems);
  if (template.manifest) checkContent(template.manifest, template.files, problems);
  template.digest = contentDigest(manifestBytes, template.files);
  return template;
}

/**
 * Read-only view of the locally maintained template library:
 * `<root>/<template-id>/<version>/manifest.json` plus `files/`.
 * Content is re-read on every call so the digest always reflects what is on disk;
 * the library is small and local, so this stays cheap.
 */
export class TemplateLibrary {
  constructor(readonly root: string) {}

  async list(): Promise<LibraryTemplate[]> {
    const rootStats = await lstat(this.root).catch(() => null);
    if (!rootStats?.isDirectory()) return [];
    const templates: LibraryTemplate[] = [];
    for (const idEntry of await readdir(this.root, { withFileTypes: true })) {
      if (idEntry.name.startsWith(".")) continue;
      if (!idEntry.isDirectory() && !idEntry.isSymbolicLink()) continue;
      const idDir = path.join(this.root, idEntry.name);
      if (!ID_PATTERN.test(idEntry.name) || (await lstat(idDir)).isSymbolicLink()) {
        templates.push(this.broken(idEntry.name, "0.0.0", "Template folder name or type is not allowed."));
        continue;
      }
      for (const versionEntry of await readdir(idDir, { withFileTypes: true })) {
        const versionDir = path.join(idDir, versionEntry.name);
        if (!VERSION_PATTERN.test(versionEntry.name) || (await lstat(versionDir)).isSymbolicLink()) {
          templates.push(this.broken(idEntry.name, versionEntry.name, "Version folder name or type is not allowed."));
          continue;
        }
        if (!versionEntry.isDirectory()) continue;
        templates.push(await loadTemplate(versionDir, idEntry.name, versionEntry.name));
      }
    }
    return templates.sort((a, b) => a.id.localeCompare(b.id) || compareVersions(b.version, a.version));
  }

  /** Exact id and version; never resolves "latest" implicitly. */
  async get(id: string, version: string): Promise<LibraryTemplate | null> {
    if (!ID_PATTERN.test(id) || !VERSION_PATTERN.test(version)) return null;
    // Load only the requested version (list() would read the whole library on every lookup).
    const idDir = path.join(this.root, id);
    const versionDir = path.join(idDir, version);
    const [idStats, versionStats] = await Promise.all([
      lstat(idDir).catch(() => null),
      lstat(versionDir).catch(() => null),
    ]);
    if (!idStats || !versionStats || idStats.isSymbolicLink() || versionStats.isSymbolicLink()) return null;
    if (!idStats.isDirectory() || !versionStats.isDirectory()) return null;
    return loadTemplate(versionDir, id, version);
  }

  /** Newest usable starter for a from-scratch project type. */
  async starterFor(projectType: string): Promise<LibraryTemplate | null> {
    return (
      (await this.list()).find(
        (t) => isUsable(t) && t.manifest.kind === "starter" && t.manifest.projectType === projectType,
      ) ?? null
    );
  }

  private broken(id: string, version: string, problem: string): LibraryTemplate {
    return { id, version, manifest: null, rawManifest: null, files: new Map(), digest: null, problems: [problem] };
  }
}
