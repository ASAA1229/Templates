import { createHash } from "node:crypto";
import {
  PROVENANCE_DIR,
  substitutePlaceholders,
  unsafePathReason,
  type TemplateInputValues,
  type TemplateManifest,
} from "@asaa/contracts";

/** A rendering problem caused by template content or configuration (never a platform fault). */
export class GenerationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GenerationError";
  }
}

export interface ProjectVariables {
  projectKey: string;
  projectName: string;
  projectSlug: string;
  projectPurpose: string;
}

export interface RenderedFile {
  path: string;
  content: Buffer;
}

export interface RenderPlan {
  files: RenderedFile[];
  directories: string[];
  totalBytes: number;
  /** SHA-256 over directories and files (sorted); excludes the provenance folder. */
  digest: string;
}

const escapers: Record<"none" | "text" | "json" | "html", (value: string) => string> = {
  none: (value) => value,
  text: (value) => value,
  // Insert as JSON string content: quotes, backslashes and control characters are escaped.
  json: (value) => JSON.stringify(value).slice(1, -1).replace(/</g, "\\u003c"),
  html: (value) =>
    value
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;"),
};

/** Values used in file and folder names must be a single safe name fragment. */
const PATH_VALUE = /^[A-Za-z0-9._-]*$/;

export function projectVariables(project: { key: string; name: string; purpose: string }): ProjectVariables {
  return {
    projectKey: project.key,
    projectName: project.name,
    projectSlug: project.key.toLowerCase(),
    projectPurpose: project.purpose,
  };
}

/**
 * Digest of an output. Only empty (leaf) folders count as folders, because on
 * disk every parent of a file also exists; this makes a plan and the files it
 * produced on disk hash identically.
 */
export function outputDigest(directories: string[], files: { path: string; content: Buffer }[]): string {
  const parents = new Set<string>();
  for (const entry of [...files.map((file) => file.path), ...directories]) {
    const parts = entry.split("/");
    for (let i = 1; i < parts.length; i++) parents.add(parts.slice(0, i).join("/"));
  }
  const leaves = [...new Set(directories)].filter((dir) => !parents.has(dir)).sort();
  const hash = createHash("sha256");
  for (const dir of leaves) hash.update(`dir\0${dir}\0`);
  for (const file of [...files].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))) {
    hash.update(`file\0${file.path}\0${file.content.length}\0`);
    hash.update(file.content);
  }
  return hash.digest("hex");
}

/**
 * Turn a validated manifest, its source files and validated values into an
 * in-memory list of files. Pure and deterministic: the same inputs always give
 * the same plan and digest. Nothing is executed and nothing touches the disk.
 */
export function renderPlan(
  manifest: TemplateManifest,
  sources: Map<string, Buffer>,
  values: TemplateInputValues,
  project: ProjectVariables,
): RenderPlan {
  const variables: Record<string, string> = { ...project };
  for (const [key, value] of Object.entries(values)) variables[key] = String(value);

  const renderPath = (template: string, what: string): string => {
    let rendered: string;
    try {
      rendered = substitutePlaceholders(template, variables, (value) => {
        if (!PATH_VALUE.test(value) || value === "." || value === "..") {
          throw new GenerationError(`A value used in the ${what} "${template}" is not a safe file name.`);
        }
        return value;
      });
    } catch (error) {
      if (error instanceof GenerationError) throw error;
      throw new GenerationError(`The ${what} "${template}" uses an unknown placeholder.`);
    }
    const reason = unsafePathReason(rendered);
    if (reason) throw new GenerationError(`Generated ${what} "${rendered}" is unsafe: ${reason}`);
    if (rendered.split("/")[0] === PROVENANCE_DIR) {
      throw new GenerationError(`Generated ${what} "${rendered}" is inside the reserved ${PROVENANCE_DIR}/ folder.`);
    }
    return rendered;
  };

  const directories = [...new Set(manifest.directories.map((dir) => renderPath(dir, "folder")))].sort();
  const files: RenderedFile[] = [];
  const seen = new Map<string, string>();
  for (const file of manifest.files) {
    if (file.when && values[file.when.input] !== file.when.equals) continue;
    const target = renderPath(file.target, "file path");
    // Case-insensitive file systems (Windows, macOS) would silently merge these.
    const folded = target.toLowerCase();
    if (seen.has(folded)) {
      throw new GenerationError(`Two files would be written to "${target}" (${seen.get(folded)} and ${file.source}).`);
    }
    seen.set(folded, file.source);
    const source = sources.get(file.source);
    if (!source) throw new GenerationError(`Template file "${file.source}" is missing.`);
    const content =
      file.substitute === "none"
        ? Buffer.from(source)
        : Buffer.from(substitutePlaceholders(source.toString("utf8"), variables, escapers[file.substitute]), "utf8");
    files.push({ path: target, content });
  }
  for (const dir of directories) {
    if (seen.has(dir.toLowerCase())) throw new GenerationError(`"${dir}" is declared as both a file and a folder.`);
  }
  for (const file of files) {
    const parts = file.path.split("/");
    for (let i = 1; i < parts.length; i++) {
      if (seen.has(parts.slice(0, i).join("/").toLowerCase())) {
        throw new GenerationError(`"${file.path}" would be written inside the file "${parts.slice(0, i).join("/")}".`);
      }
    }
  }
  files.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));

  const totalBytes = files.reduce((sum, file) => sum + file.content.length, 0);
  if (files.length > manifest.validation.maxFiles) {
    throw new GenerationError(`Output has ${files.length} files; the template allows ${manifest.validation.maxFiles}.`);
  }
  if (totalBytes > manifest.validation.maxTotalBytes) {
    throw new GenerationError(
      `Output is ${totalBytes} bytes; the template allows ${manifest.validation.maxTotalBytes}.`,
    );
  }
  const produced = new Set([...files.map((file) => file.path), ...directories]);
  for (const required of manifest.validation.requiredOutputs) {
    const target = renderPath(required, "required output");
    if (!produced.has(target)) throw new GenerationError(`Required output "${target}" was not generated.`);
  }
  return { files, directories, totalBytes, digest: outputDigest(directories, files) };
}
