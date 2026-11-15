import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { Router } from "express";
import { z } from "zod";
import type { AppContext } from "../../context.js";
import { conflict, notFound } from "../../lib/errors.js";
import { audit } from "../audit/audit.service.js";
import { authorize } from "../auth/policy.js";
import { createZip, type ZipEntry } from "../export/zip.js";

/**
 * Packaged tools (tools/<id>/manifest.json): small, locally maintained utilities that users download and run
 * on their own hosts. The registry is read-only. A tool is served only when every file still matches the
 * SHA-256 and size recorded in its manifest (refresh with `npm run tools:manifest` after a deliberate change).
 */
const SAFE_PATH = /^(?!\/)(?!.*(?:^|\/)\.\.?(?:\/|$))[A-Za-z0-9._@+-]+(?:\/[A-Za-z0-9._@+-]+)*$/;

export const toolManifestSchema = z
  .object({
    id: z.string().regex(/^[a-z0-9][a-z0-9-]{0,62}$/),
    version: z.string().regex(/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/),
    title: z.string().min(1).max(120),
    description: z.string().min(1).max(1000),
    kind: z.literal("tool"),
    language: z.literal("python"),
    minRuntime: z.string().regex(/^\d+\.\d+$/),
    offline: z.literal(true),
    license: z.object({ spdx: z.string().min(1).max(80), notice: z.string().min(1).max(500) }).strict(),
    provenance: z
      .object({
        origin: z.literal("local"),
        maintainer: z.string().min(1).max(120),
        repository: z.string().min(1).max(300),
      })
      .strict(),
    files: z
      .array(
        z
          .object({
            path: z.string().min(1).max(200).regex(SAFE_PATH),
            sha256: z.string().regex(/^[0-9a-f]{64}$/),
            bytes: z.number().int().min(0),
          })
          .strict(),
      )
      .min(1)
      .max(500),
  })
  .strict();
export type ToolManifest = z.infer<typeof toolManifestSchema>;

export interface ToolEntry {
  manifest: ToolManifest;
  /** Absolute directory of the tool. */
  dir: string;
  /** Raw manifest.json bytes, shipped unchanged inside the archive. */
  manifestBytes: Buffer;
}
export interface ToolLoadResult {
  tools: ToolEntry[];
  problems: { dir: string; problem: string }[];
}

export const sha256 = (bytes: Buffer | string) => createHash("sha256").update(bytes).digest("hex");

/** Read every tools/<id>/manifest.json under `toolsDir`. Invalid manifests are reported, never served. */
export async function loadTools(toolsDir: string): Promise<ToolLoadResult> {
  const result: ToolLoadResult = { tools: [], problems: [] };
  let entries;
  try {
    entries = await readdir(toolsDir, { withFileTypes: true });
  } catch {
    return result;
  }
  for (const entry of entries.filter((e) => e.isDirectory()).sort((a, b) => a.name.localeCompare(b.name))) {
    const dir = path.join(toolsDir, entry.name);
    let manifestBytes: Buffer;
    try {
      manifestBytes = await readFile(path.join(dir, "manifest.json"));
    } catch {
      continue; // not a packaged tool
    }
    try {
      const manifest = toolManifestSchema.parse(JSON.parse(manifestBytes.toString("utf8")));
      if (manifest.id !== entry.name) throw new Error("manifest id must equal the directory name");
      result.tools.push({ manifest, dir, manifestBytes });
    } catch (error) {
      result.problems.push({
        dir: entry.name,
        problem: error instanceof Error ? error.message.slice(0, 300) : "invalid",
      });
    }
  }
  return result;
}

export interface VerifiedTool {
  files: { path: string; content: Buffer }[];
  problems: string[];
}

/** Read each manifest file and compare size and digest. Problems name the file, never contents. */
export async function readAndVerify(tool: ToolEntry): Promise<VerifiedTool> {
  const files: VerifiedTool["files"] = [];
  const problems: string[] = [];
  for (const file of tool.manifest.files) {
    const absolute = path.resolve(tool.dir, ...file.path.split("/"));
    if (!absolute.startsWith(tool.dir + path.sep)) {
      problems.push(`${file.path}: path escapes the tool directory`);
      continue;
    }
    let content: Buffer;
    try {
      content = await readFile(absolute);
    } catch {
      problems.push(`${file.path}: missing`);
      continue;
    }
    if (content.length !== file.bytes) problems.push(`${file.path}: size differs from manifest`);
    else if (sha256(content) !== file.sha256) problems.push(`${file.path}: checksum differs from manifest`);
    files.push({ path: file.path, content });
  }
  return { files, problems };
}

export interface ToolArchive {
  filename: string;
  archive: Buffer;
  sha256: string;
}

/** Deterministic archive: <id>-<version>/<files>, SHA256SUMS and the manifest. Throws when verification fails. */
export function buildArchive(tool: ToolEntry, verified: VerifiedTool): ToolArchive {
  const root = `${tool.manifest.id}-${tool.manifest.version}`;
  const sums = [...tool.manifest.files]
    .sort((a, b) => (a.path < b.path ? -1 : 1))
    .map((file) => `${file.sha256}  ${file.path}\n`)
    .join("");
  const entries: ZipEntry[] = [
    ...verified.files.map((file) => ({ name: `${root}/${file.path}`, content: file.content })),
    { name: `${root}/SHA256SUMS`, content: Buffer.from(sums, "utf8") },
    { name: `${root}/manifest.json`, content: tool.manifestBytes },
  ];
  const archive = createZip(entries);
  return { filename: `${root}.zip`, archive, sha256: sha256(archive) };
}

export function toolsRouter(ctx: AppContext): Router {
  const router = Router();

  async function find(id: string): Promise<ToolEntry> {
    const { tools } = await loadTools(ctx.config.TOOLS_DIR);
    const tool = tools.find((candidate) => candidate.manifest.id === id);
    if (!tool) throw notFound("Tool");
    return tool;
  }

  router.get("/", authorize(ctx, "catalog:read"), async (_req, res, next) => {
    try {
      const { tools } = await loadTools(ctx.config.TOOLS_DIR);
      const items = [];
      for (const tool of tools) {
        const verified = await readAndVerify(tool);
        const intact = verified.problems.length === 0;
        items.push({
          id: tool.manifest.id,
          version: tool.manifest.version,
          title: tool.manifest.title,
          description: tool.manifest.description,
          language: tool.manifest.language,
          minRuntime: tool.manifest.minRuntime,
          sha256: intact ? buildArchive(tool, verified).sha256 : null,
          integrity: intact ? "ok" : "modified",
          fileCount: tool.manifest.files.length,
        });
      }
      res.json({ items });
    } catch (error) {
      next(error);
    }
  });

  router.get("/:id", authorize(ctx, "catalog:read"), async (req, res, next) => {
    try {
      const tool = await find(String(req.params.id));
      const verified = await readAndVerify(tool);
      res.json({
        tool: { ...tool.manifest, integrity: verified.problems.length === 0 ? "ok" : "modified" },
      });
    } catch (error) {
      next(error);
    }
  });

  router.get("/:id/download", authorize(ctx, "catalog:read"), async (req, res, next) => {
    try {
      const tool = await find(String(req.params.id));
      const verified = await readAndVerify(tool);
      if (verified.problems.length > 0) {
        await audit(ctx, req, {
          action: "tool.download",
          outcome: "FAILURE",
          targetType: "tool",
          targetId: tool.manifest.id,
          metadata: {
            version: tool.manifest.version,
            reason: "integrity_mismatch",
            problems: verified.problems.length,
          },
        });
        throw conflict(
          "This tool was modified after its manifest was generated and cannot be downloaded. Ask an administrator to review and refresh it.",
        );
      }
      const built = buildArchive(tool, verified);
      await audit(ctx, req, {
        action: "tool.download",
        outcome: "SUCCESS",
        targetType: "tool",
        targetId: tool.manifest.id,
        metadata: { version: tool.manifest.version, sha256: built.sha256, files: tool.manifest.files.length },
      });
      res.setHeader("content-type", "application/zip");
      res.setHeader("content-disposition", `attachment; filename="${built.filename}"`);
      res.setHeader("content-length", String(built.archive.length));
      res.setHeader("x-content-type-options", "nosniff");
      res.end(built.archive);
    } catch (error) {
      next(error);
    }
  });

  return router;
}
