import { randomUUID } from "node:crypto";
import { lstat, mkdir, readFile, readdir, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { Router } from "express";
import {
  GENERATOR_MAJOR,
  TEMPLATE_MANIFEST_VERSION,
  templateManifestSchema,
  templateInputSchema,
  unsafePathReason,
  type ProjectBlueprint,
  type TemplateInput,
} from "@asaa/contracts";
import type { AppContext } from "../../context.js";
import { conflict, notFound, validationFailed } from "../../lib/errors.js";
import { audit } from "../audit/audit.service.js";
import { authorize } from "../auth/policy.js";
import { loadOwnedProject } from "../projects/projects.js";
import { resolveOutputDir } from "../generation/writer.js";
import { contentDigest } from "./library.js";
import { catalogView } from "../catalog/catalog.js";
import type { GenerationService } from "../generation/generation.service.js";

const MAX_FILES = 200;
const MAX_FILE_BYTES = 512 * 1024;
const MAX_TOTAL_BYTES = 4 * 1024 * 1024;
const EXCLUDED_DIRS = new Set([".git", ".asaa", "node_modules", "dist", "build", "coverage", ".next", ".venv", "venv"]);
const EXCLUDED_FILES = /^(\.env($|\.)|.*\.(pem|key|p12|pfx)$|id_rsa|id_ed25519|credentials(\.json)?$)$/i;
const SECRET_PATTERNS = [
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
  /\bAKIA[0-9A-Z]{16}\b/,
  /\bgithub_pat_[A-Za-z0-9_]{20,}\b/,
  /\bgh[pousr]_[A-Za-z0-9]{30,}\b/,
  /\bsk-proj-[A-Za-z0-9_-]{20,}\b/,
];

type SubmissionInput = {
  title: string;
  slug: string;
  description: string;
  category: string;
  version: string;
  license: string;
  customerPermission: boolean;
  rightsConfirmed: boolean;
  secretsChecked: boolean;
  inputs: TemplateInput[];
};

function parseInput(raw: unknown): SubmissionInput {
  const value = raw as Record<string, unknown>;
  const issues: Record<string, string> = {};
  const text = (key: string, max: number) => {
    const v = typeof value?.[key] === "string" ? (value[key] as string).trim() : "";
    if (!v || v.length > max) issues[key] = `Enter a value of 1–${max} characters.`;
    return v;
  };
  const result: SubmissionInput = {
    title: text("title", 160),
    slug: text("slug", 80).toLowerCase(),
    description: typeof value?.description === "string" ? value.description.trim().slice(0, 2000) : "",
    category: text("category", 80),
    version: text("version", 40),
    license: text("license", 80),
    customerPermission: value?.customerPermission === true,
    rightsConfirmed: value?.rightsConfirmed === true,
    secretsChecked: value?.secretsChecked === true,
    inputs: [],
  };
  const rawInputs = value?.inputs === undefined ? [] : value.inputs;
  if (!Array.isArray(rawInputs) || rawInputs.length > 30) {
    issues.inputs = "Provide at most 30 valid reusable input definitions.";
  } else {
    const parsedInputs = rawInputs.map((entry) => templateInputSchema.safeParse(entry));
    if (parsedInputs.some((entry) => !entry.success)) {
      issues.inputs = "One or more reusable input definitions are invalid.";
    } else {
      result.inputs = parsedInputs.map((entry) => (entry as { success: true; data: TemplateInput }).data);
    }
  }
  if (!/^[a-z0-9][a-z0-9-]{1,79}$/.test(result.slug)) issues.slug = "Use a lowercase template slug (2–80 characters).";
  if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(result.version)) issues.version = "Use semantic versioning, e.g. 1.0.0.";
  if (!result.customerPermission) issues.customerPermission = "Confirm customer permission or that no customer-owned material is included.";
  if (!result.rightsConfirmed) issues.rightsConfirmed = "Confirm you have the rights to contribute this work.";
  if (!result.secretsChecked) issues.secretsChecked = "Confirm the project was checked for secrets and private data.";
  if (Object.keys(issues).length) throw validationFailed(issues, "Template submission details need attention.");
  return result;
}

async function collectFiles(root: string) {
  const files: { path: string; bytes: Buffer }[] = [];
  let total = 0;
  async function walk(dir: string, relative: string) {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      if (entry.name === ".DS_Store" || EXCLUDED_DIRS.has(entry.name)) continue;
      const rel = relative ? `${relative}/${entry.name}` : entry.name;
      const unsafe = unsafePathReason(rel);
      if (unsafe) throw validationFailed({ files: `${rel}: ${unsafe}` }, "The project contains an unsafe path.");
      if (EXCLUDED_FILES.test(entry.name)) continue;
      const full = path.join(dir, entry.name);
      const stats = await lstat(full);
      if (stats.isSymbolicLink()) throw validationFailed({ files: `${rel}: symbolic links are not accepted.` });
      if (stats.isDirectory()) {
        await walk(full, rel);
        continue;
      }
      if (!stats.isFile()) throw validationFailed({ files: `${rel}: only regular files are accepted.` });
      if (stats.size > MAX_FILE_BYTES) throw validationFailed({ files: `${rel}: exceeds the per-file limit.` });
      if (files.length >= MAX_FILES) throw validationFailed({ files: `The project exceeds the ${MAX_FILES}-file limit.` });
      total += stats.size;
      if (total > MAX_TOTAL_BYTES) throw validationFailed({ files: "The project exceeds the 4 MB template contribution limit." });
      const bytes = await readFile(full);
      const sample = bytes.toString("utf8");
      if (SECRET_PATTERNS.some((pattern) => pattern.test(sample))) {
        throw validationFailed({ files: `${rel}: possible credential or private-key material detected.` });
      }
      files.push({ path: rel, bytes });
    }
  }
  await walk(root, "");
  if (!files.length) throw validationFailed({ files: "There are no eligible source files to contribute." });
  return files.sort((a, b) => a.path.localeCompare(b.path));
}

function technologies(blueprint: ProjectBlueprint | null): { name: string; version: string }[] {
  const entries = blueprint
    ? [...blueprint.runtimes, ...blueprint.languages, ...blueprint.frameworks, ...blueprint.databases]
    : [];
  const unique = new Map(entries.map((entry) => [`${entry.name.toLowerCase()}@${entry.version}`, entry]));
  return [...unique.values()].slice(0, 20).length ? [...unique.values()].slice(0, 20) : [{ name: "Project source", version: "1" }];
}

export function projectTemplateSubmissionsRouter(ctx: AppContext, generation: GenerationService): Router {
  const router = Router();

  router.post("/:projectId/template-submissions", authorize(ctx, "template:submit"), async (req, res, next) => {
    try {
      const input = parseInput(req.body);
      const project = await loadOwnedProject(ctx, req.owner!.id, String(req.params.projectId));
      if (project.archivedAt) throw conflict("Restore the project before submitting it as a template.");
      const generated = await ctx.prisma.projectGeneration.findUnique({ where: { projectId: project.id } });
      if (!generated || generated.status !== "SUCCEEDED") throw conflict("Only successfully generated projects can be contributed.");
      const output = await resolveOutputDir(ctx.config.GENERATION_OUTPUT_DIR, generated.outputDir);
      if (!output) throw conflict("The project's source folder is unavailable.");
      const files = await collectFiles(output);
      const blueprint = project.blueprint ? (project.blueprint as ProjectBlueprint) : null;
      const manifest = {
        manifestVersion: TEMPLATE_MANIFEST_VERSION,
        id: input.slug,
        version: input.version,
        kind: "template" as const,
        title: input.title,
        description: input.description,
        category: input.category,
        technologies: technologies(blueprint),
        ...(blueprint ? { blueprint } : {}),
        inputs: input.inputs,
        files: files.map(({ path: filePath }) => ({
          source: filePath,
          target: filePath,
          substitute: /\.(png|jpe?g|gif|webp|ico|pdf|zip|gz|woff2?|ttf|eot|mp[34]|wasm)$/i.test(filePath)
            ? "none" as const
            : "text" as const,
        })),
        directories: [],
        dependencies: [],
        compatibility: { generator: GENERATOR_MAJOR, adapter: "file-tree" as const },
        license: { spdx: input.license },
        provenance: { origin: "local" as const, maintainer: req.owner!.displayName, repository: `project:${project.key}` },
        validation: { requiredOutputs: [], maxFiles: MAX_FILES, maxTotalBytes: MAX_TOTAL_BYTES },
      };
      const parsed = templateManifestSchema.safeParse(manifest);
      if (!parsed.success) {
        throw validationFailed({ manifest: parsed.error.issues.map((issue) => issue.message).slice(0, 8).join(" ") });
      }
      const submissionsRoot = path.join(ctx.config.TEMPLATE_LIBRARY_DIR, ".submissions");
      await mkdir(submissionsRoot, { recursive: true });
      const id = randomUUID();
      const staging = path.join(submissionsRoot, `.tmp-${id}`);
      const destination = path.join(submissionsRoot, id);
      try {
        await mkdir(path.join(staging, "files"), { recursive: true });
        await writeFile(path.join(staging, "manifest.json"), JSON.stringify(parsed.data, null, 2), { flag: "wx" });
        for (const file of files) {
          const target = path.join(staging, "files", ...file.path.split("/"));
          await mkdir(path.dirname(target), { recursive: true });
          await writeFile(target, file.bytes, { flag: "wx" });
        }
        await rename(staging, destination);
      } catch (error) {
        await import("node:fs/promises").then(({ rm }) => rm(staging, { recursive: true, force: true }));
        throw error;
      }
      const digest = contentDigest(Buffer.from(JSON.stringify(parsed.data, null, 2)), new Map(files.map((file) => [file.path, file.bytes])));
      await audit(ctx, req, {
        action: "template.submission_create",
        outcome: "SUCCESS",
        targetType: "template_submission",
        targetId: id,
        metadata: { projectId: project.id, projectKey: project.key, templateId: input.slug, version: input.version, fileCount: files.length, bytes: files.reduce((sum, f) => sum + f.bytes.length, 0), digest, reviewStatus: "PENDING" },
      });
      res.status(201).json({ submission: { id, templateId: input.slug, version: input.version, title: input.title, status: "PENDING_REVIEW", fileCount: files.length } });
    } catch (error) {
      next(error);
    }
  });

  router.get("/template-submissions", authorize(ctx, "template:review"), async (_req, res, next) => {
    try {
      const events = await ctx.prisma.auditEvent.findMany({
        where: {
          targetType: "template_submission",
          action: { in: ["template.submission_create", "template.submission_approve"] },
          outcome: "SUCCESS",
        },
        orderBy: { at: "desc" },
        take: 200,
      });
      const created = new Map<string, (typeof events)[number]>();
      const latest = new Map<string, (typeof events)[number]>();
      for (const event of events) {
        if (event.action === "template.submission_create" && !created.has(event.targetId)) {
          created.set(event.targetId, event);
        }
        if (!latest.has(event.targetId)) latest.set(event.targetId, event);
      }
      res.json({
        submissions: [...created.entries()].map(([id, event]) => ({
          id,
          createdAt: event.at.toISOString(),
          actorId: event.actorId,
          ...(event.metadata as Record<string, unknown>),
          status: latest.get(id)?.action === "template.submission_approve" ? "APPROVED" : "PENDING_REVIEW",
        })),
      });
    } catch (error) {
      next(error);
    }
  });

  router.post("/template-submissions/:id/approve", authorize(ctx, "template:approve"), async (req, res, next) => {
    try {
      const id = String(req.params.id);
      if (!/^[0-9a-f-]{36}$/i.test(id)) throw notFound("Template submission");
      const submissionsRoot = path.join(ctx.config.TEMPLATE_LIBRARY_DIR, ".submissions");
      const source = path.join(submissionsRoot, id);
      const sourceStats = await lstat(source).catch(() => null);
      if (!sourceStats?.isDirectory() || sourceStats.isSymbolicLink()) throw notFound("Template submission");
      const manifestPath = path.join(source, "manifest.json");
      const manifestStats = await lstat(manifestPath).catch(() => null);
      if (!manifestStats?.isFile() || manifestStats.isSymbolicLink() || manifestStats.size > 64 * 1024) {
        throw validationFailed({ manifest: "The pending manifest is missing, unsafe or too large." });
      }
      const manifestBytes = await readFile(manifestPath);
      const rawManifest: unknown = JSON.parse(manifestBytes.toString("utf8"));
      const parsedManifest = templateManifestSchema.safeParse(rawManifest);
      if (!parsedManifest.success) throw validationFailed({ manifest: "The pending manifest failed schema validation." });
      const manifest = parsedManifest.data;
      if (!/^[a-z0-9][a-z0-9-]{1,79}$/.test(manifest.id) || !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(manifest.version)) {
        throw validationFailed({ manifest: "The pending template identity is invalid." });
      }
      const pendingFiles = await collectFiles(path.join(source, "files"));
      const actualDigest = contentDigest(manifestBytes, new Map(pendingFiles.map((file) => [file.path, file.bytes])));
      const createdEvent = await ctx.prisma.auditEvent.findFirst({
        where: { action: "template.submission_create", targetType: "template_submission", targetId: id, outcome: "SUCCESS" },
        orderBy: { at: "asc" },
      });
      const expectedDigest = (createdEvent?.metadata as Record<string, unknown> | undefined)?.digest;
      if (typeof expectedDigest !== "string" || actualDigest !== expectedDigest) {
        throw conflict("The pending submission content changed after it was submitted; approval is blocked.");
      }
      const libraryRoot = path.resolve(ctx.config.TEMPLATE_LIBRARY_DIR);
      const target = path.resolve(libraryRoot, manifest.id, manifest.version);
      if (!target.startsWith(libraryRoot + path.sep)) throw validationFailed({ manifest: "The target path is outside the template library." });
      if (await lstat(target).catch(() => null)) throw conflict("This template version already exists in the library.");
      await mkdir(path.dirname(target), { recursive: true });
      await rename(source, target);
      try {
        const approved = await generation.approve(req, manifest.id, manifest.version);
        await audit(ctx, req, { action: "template.submission_approve", outcome: "SUCCESS", targetType: "template_submission", targetId: id, metadata: { catalogItemId: approved.item.id, templateId: manifest.id, version: manifest.version } });
        res.status(201).json({ submissionId: id, item: catalogView(approved.item), status: "APPROVED" });
      } catch (error) {
        await mkdir(submissionsRoot, { recursive: true });
        await rename(target, source).catch(() => undefined);
        throw error;
      }
    } catch (error) {
      next(error);
    }
  });

  return router;
}
