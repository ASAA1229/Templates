import { randomUUID } from "node:crypto";
import { lstat, mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  AUTHORING_LIMITS,
  createDraftSchema,
  deleteDraftFileSchema,
  GENERATOR_MAJOR,
  putDraftFileSchema,
  replaceDraftManifestSchema,
  submitDraftSchema,
  TEMPLATE_MANIFEST_VERSION,
  templateInputSchema,
  templateManifestSchema,
  unsafePathReason,
  updateDraftMetadataSchema,
  type DraftSummaryView,
  type DraftView,
  type TemplateManifest,
} from "@asaa/contracts";
import { Router, type Request } from "express";
import { z } from "zod";
import { scanForSecrets } from "../../certification/secret-scan.js";
import type { AppContext } from "../../context.js";
import { conflict, forbidden, notEligible, notFound, validationFailed } from "../../lib/errors.js";
import { aiComplete, type AiFetch } from "../ai/ai.js";
import { audit } from "../audit/audit.service.js";
import { authorize } from "../auth/policy.js";
import { contentDigest, loadTemplate, TemplateLibrary } from "../generation/library.js";
import { EXCLUDED_DIRS, EXCLUDED_FILES } from "../generation/project-template-submissions.js";

const UUID = /^[0-9a-f-]{36}$/i;

interface DraftRecord {
  id: string;
  ownerId: string;
  templateId: string;
  version: string;
  aiGenerated: boolean;
  aiFiles: string[];
  status: "DRAFT" | "SUBMITTED";
  revision: number;
  submissionId: string | null;
  createdAt: string;
  updatedAt: string;
}

const isManagement = (req: Request) => req.owner!.role === "OWNER" || req.owner!.role === "ADMIN";

/** Reason a source file name cannot be part of a template, or null. */
export function unsafeSourcePath(file: string): string | null {
  const reason = unsafePathReason(file);
  if (reason) return reason;
  const parts = file.split("/");
  if (parts.some((part) => EXCLUDED_DIRS.has(part)))
    return "This folder name is reserved and cannot be part of a template.";
  if (EXCLUDED_FILES.test(parts[parts.length - 1]!)) return "Credential and key files cannot be part of a template.";
  return null;
}

const substituteFor = (file: string): "text" | "none" =>
  /\.(png|jpe?g|gif|ico|webp|woff2?|ttf|otf|zip|gz|pdf)$/i.test(file) ? "none" : "text";

const aiOutputSchema = z.object({
  title: z.string().trim().min(1).max(160),
  description: z.string().trim().max(2000).default(""),
  technologies: z
    .array(z.object({ name: z.string().trim().min(1).max(80), version: z.string().trim().min(1).max(40) }))
    .min(1)
    .max(10),
  inputs: z.array(templateInputSchema).max(10).default([]),
  files: z
    .array(z.object({ path: z.string().min(1).max(240), content: z.string().max(AUTHORING_LIMITS.fileBytes) }))
    .min(1)
    .max(20),
});

const AI_SYSTEM =
  "You design reusable software project templates. Reply with a single JSON object and nothing else. " +
  'Shape: {"title": string, "description": string, "technologies": [{"name": string, "version": string}], ' +
  '"inputs": [{"id": string, "label": string, "type": "string", "required": boolean, "default": string}], ' +
  '"files": [{"path": string, "content": string}]}. ' +
  "Use only forward-slash relative file paths. In file content you may use only these placeholders: " +
  "{{projectKey}}, {{projectName}}, {{projectSlug}}, {{projectPurpose}} and {{<inputId>}} for inputs you declare " +
  "(input ids start with a lowercase letter and use letters and digits). Never include secrets, credentials or real personal data.";

/** Pull the first balanced-looking JSON object out of a model reply. */
export function extractJsonObject(text: string): unknown {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start)
    throw notEligible("The AI answer did not contain a template definition. Try rewording the brief.");
  try {
    return JSON.parse(text.slice(start, end + 1));
  } catch {
    throw notEligible("The AI answer was not valid JSON. Try again or rewrite the brief.");
  }
}

/**
 * Template authoring workspace (D3.1 architecture, D3.2 visual editing, D3.3 source editing, D3.4 AI-assisted creation).
 * A draft is a manifest plus a files/ folder under <library>/.drafts/<id>, hidden from the catalogue and from
 * generation. The visual editor (metadata, inputs) and the source editor (files, raw manifest) write the same
 * manifest and are checked by the same library validation. Submitting stages the content for the existing review
 * pipeline; a template stays a draft until an authorized reviewer approves and publishes it.
 */
export class AuthoringService {
  private readonly locks = new Map<string, Promise<unknown>>();

  constructor(
    private readonly ctx: AppContext,
    private readonly library: TemplateLibrary,
    private readonly doFetch: AiFetch = fetch,
  ) {}

  private get draftsRoot() {
    return path.join(this.ctx.config.TEMPLATE_LIBRARY_DIR, ".drafts");
  }
  private get submissionsRoot() {
    return path.join(this.ctx.config.TEMPLATE_LIBRARY_DIR, ".submissions");
  }
  private dirOf(id: string) {
    return path.join(this.draftsRoot, id);
  }

  private serialize<T>(id: string, task: () => Promise<T>): Promise<T> {
    const next = (this.locks.get(id) ?? Promise.resolve()).catch(() => undefined).then(task);
    this.locks.set(id, next);
    void next.finally(() => this.locks.get(id) === next && this.locks.delete(id)).catch(() => undefined);
    return next;
  }

  private async readRecord(id: string): Promise<DraftRecord> {
    if (!UUID.test(id)) throw notFound("Draft");
    try {
      return JSON.parse(await readFile(path.join(this.dirOf(id), "draft.json"), "utf8")) as DraftRecord;
    } catch {
      throw notFound("Draft");
    }
  }

  private async load(req: Request, id: string, access: "read" | "write"): Promise<DraftRecord> {
    const record = await this.readRecord(id);
    const own = record.ownerId === req.owner!.id;
    if (!own && !isManagement(req)) throw notFound("Draft");
    // Management can read every draft to support authors, but only the author edits.
    if (access === "write" && !own) throw forbidden();
    if (access === "write" && record.status !== "DRAFT") throw conflict("This draft was already submitted for review.");
    return record;
  }

  private async saveRecord(record: DraftRecord, ctx: { bumpRevision: boolean }): Promise<DraftRecord> {
    const next = {
      ...record,
      revision: ctx.bumpRevision ? record.revision + 1 : record.revision,
      updatedAt: this.ctx.now().toISOString(),
    };
    await writeFile(path.join(this.dirOf(record.id), "draft.json"), JSON.stringify(next, null, 2));
    return next;
  }

  private async readManifest(id: string): Promise<TemplateManifest> {
    const raw: unknown = JSON.parse(await readFile(path.join(this.dirOf(id), "manifest.json"), "utf8"));
    return templateManifestSchema.parse(raw);
  }

  private async writeManifest(id: string, manifest: unknown) {
    await writeFile(path.join(this.dirOf(id), "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  }

  private expect(record: DraftRecord, expectedRevision: number) {
    if (record.revision !== expectedRevision) {
      throw conflict("This draft changed since you opened it. Reload and apply your edit again.");
    }
  }

  private summary(record: DraftRecord, manifest: { title: string; category: string }): DraftSummaryView {
    return {
      id: record.id,
      templateId: record.templateId,
      version: record.version,
      title: manifest.title,
      category: manifest.category,
      aiGenerated: record.aiGenerated,
      status: record.status,
      revision: record.revision,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
      ownerId: record.ownerId,
    };
  }

  async list(req: Request): Promise<DraftSummaryView[]> {
    const entries = await readdir(this.draftsRoot, { withFileTypes: true }).catch(() => []);
    const drafts: DraftSummaryView[] = [];
    for (const entry of entries) {
      if (!entry.isDirectory() || !UUID.test(entry.name)) continue;
      try {
        const record = await this.readRecord(entry.name);
        if (record.ownerId !== req.owner!.id && !isManagement(req)) continue;
        drafts.push(this.summary(record, await this.readManifest(entry.name)));
      } catch {
        // A draft whose manifest is currently invalid is still listed with what we know.
        try {
          const record = await this.readRecord(entry.name);
          if (record.ownerId === req.owner!.id || isManagement(req)) {
            drafts.push(this.summary(record, { title: record.templateId, category: "" }));
          }
        } catch {
          continue;
        }
      }
    }
    return drafts.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  async get(req: Request, id: string): Promise<DraftView> {
    const record = await this.load(req, id, "read");
    return this.view(record);
  }

  private async view(record: DraftRecord): Promise<DraftView> {
    const dir = this.dirOf(record.id);
    const template = await loadTemplate(dir, record.templateId, record.version);
    // loadTemplate reports identity mismatches against the folder name; for drafts identity lives in draft.json.
    const problems = template.problems.filter((problem) => !problem.startsWith("Manifest identity"));
    const manifest = template.manifest;
    if (manifest && (manifest.id !== record.templateId || manifest.version !== record.version)) {
      problems.push("The manifest id and version must match the draft's template id and version.");
    }
    if (manifest && (await this.library.get(manifest.id, manifest.version))) {
      problems.push(
        `${manifest.id}@${manifest.version} already exists in the template library; choose another version.`,
      );
    }
    if (template.digest && template.files.size) {
      const findings = scanForSecrets(template.files);
      for (const finding of findings) {
        problems.push(
          `files/${finding.file}${finding.line ? `:${finding.line}` : ""}: possible secret (${finding.rule}).`,
        );
      }
    }
    return {
      ...this.summary(record, {
        title: manifest?.title ?? record.templateId,
        category: manifest?.category ?? "",
      }),
      manifest: template.rawManifest,
      files: [...template.files.entries()]
        .map(([file, bytes]) => ({ path: file, bytes: bytes.length }))
        .sort((a, b) => a.path.localeCompare(b.path)),
      problems,
      aiFiles: record.aiFiles,
      submissionId: record.submissionId,
    };
  }

  // ───── create ─────

  async create(req: Request, raw: unknown): Promise<DraftView> {
    const parsed = createDraftSchema.safeParse(raw);
    if (!parsed.success) {
      const fields: Record<string, string> = {};
      for (const issue of parsed.error.issues) fields[issue.path.join(".") || "_"] ??= issue.message;
      throw validationFailed(fields, "Check the highlighted fields.");
    }
    const input = parsed.data;
    const id = randomUUID();
    const maintainer = req.owner!.displayName;
    let manifest: Record<string, unknown>;
    let files: Map<string, Buffer>;
    let aiFiles: string[] = [];
    let version = "0.1.0";

    if (input.mode === "blank") {
      files = new Map([["README.md", Buffer.from("# {{projectName}}\n\n{{projectPurpose}}\n")]]);
      manifest = this.baseManifest(input.slug, version, input.title, input.description, input.category, maintainer, [
        { name: "Plain files", version: "1" },
      ]);
    } else if (input.mode === "clone") {
      const source = await this.library.get(input.sourceId, input.sourceVersion);
      if (!source?.manifest || source.problems.length) throw notEligible("The source template is missing or invalid.");
      if (source.manifest.kind !== "template")
        throw notEligible("Only templates (not platform starters) can be copied.");
      version = input.version;
      files = new Map(source.files);
      manifest = {
        ...(source.rawManifest as Record<string, unknown>),
        id: input.slug,
        version,
        title: input.title ?? `${source.manifest.title} (copy)`,
        provenance: { origin: "local", maintainer, repository: `template:${source.id}@${source.version}` },
      };
    } else {
      const generated = await this.generateWithAi(req, input.brief);
      files = new Map();
      for (const file of generated.files) {
        const reason = unsafeSourcePath(file.path);
        if (reason) throw notEligible(`The AI proposed an unusable file "${file.path}": ${reason}`);
        files.set(file.path, Buffer.from(file.content, "utf8"));
      }
      aiFiles = [...files.keys()];
      manifest = this.baseManifest(
        input.slug,
        version,
        generated.title,
        generated.description,
        input.category,
        maintainer,
        generated.technologies,
      );
      manifest.inputs = generated.inputs;
    }
    if (await this.library.get(input.slug, version)) {
      throw conflict(`${input.slug}@${version} already exists in the template library.`);
    }
    manifest.files = [...files.keys()]
      .sort()
      .map((file) => ({ source: file, target: file, substitute: substituteFor(file) }));
    const checked = templateManifestSchema.safeParse(manifest);
    // An AI manifest may be imperfect: keep it as a draft with problems shown instead of discarding the work.
    if (!checked.success && input.mode !== "ai") {
      throw validationFailed({
        manifest: checked.error.issues
          .slice(0, 5)
          .map((issue) => issue.message)
          .join(" "),
      });
    }
    this.assertWithinLimits(files);

    await mkdir(this.draftsRoot, { recursive: true });
    const staging = path.join(this.draftsRoot, `.tmp-${id}`);
    try {
      await mkdir(path.join(staging, "files"), { recursive: true });
      for (const [file, bytes] of files) {
        const target = path.join(staging, "files", ...file.split("/"));
        await mkdir(path.dirname(target), { recursive: true });
        await writeFile(target, bytes, { flag: "wx" });
      }
      await writeFile(path.join(staging, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
      const now = this.ctx.now().toISOString();
      const record: DraftRecord = {
        id,
        ownerId: req.owner!.id,
        templateId: input.slug,
        version,
        aiGenerated: input.mode === "ai",
        aiFiles,
        status: "DRAFT",
        revision: 1,
        submissionId: null,
        createdAt: now,
        updatedAt: now,
      };
      await writeFile(path.join(staging, "draft.json"), JSON.stringify(record, null, 2));
      await rename(staging, this.dirOf(id));
    } catch (error) {
      await rm(staging, { recursive: true, force: true });
      throw error;
    }
    await audit(this.ctx, req, {
      action: "template.draft_create",
      outcome: "SUCCESS",
      targetType: "template_draft",
      targetId: id,
      metadata: { templateId: input.slug, mode: input.mode, aiGenerated: input.mode === "ai", fileCount: files.size },
    });
    return this.get(req, id);
  }

  private baseManifest(
    id: string,
    version: string,
    title: string,
    description: string,
    category: string,
    maintainer: string,
    technologies: { name: string; version: string }[],
  ): Record<string, unknown> {
    return {
      manifestVersion: TEMPLATE_MANIFEST_VERSION,
      id,
      version,
      kind: "template",
      title,
      description,
      category,
      technologies,
      inputs: [],
      files: [],
      directories: [],
      dependencies: [],
      compatibility: { generator: GENERATOR_MAJOR, adapter: "file-tree" },
      license: { spdx: "UNLICENSED" },
      provenance: { origin: "local", maintainer },
      validation: { requiredOutputs: [], maxFiles: AUTHORING_LIMITS.files, maxTotalBytes: AUTHORING_LIMITS.totalBytes },
    };
  }

  private async generateWithAi(req: Request, brief: string): Promise<z.infer<typeof aiOutputSchema>> {
    const answer = await aiComplete(this.ctx, this.doFetch, {
      system: AI_SYSTEM,
      prompt: `Design a reusable project template for this brief:\n---\n${brief}\n---`,
      requestId: req.requestId,
      maxChars: 60_000,
    });
    const parsed = aiOutputSchema.safeParse(extractJsonObject(answer));
    if (!parsed.success)
      throw notEligible("The AI answer did not match the template format. Try again or reword the brief.");
    return parsed.data;
  }

  private assertWithinLimits(files: Map<string, Buffer>) {
    if (files.size > AUTHORING_LIMITS.files)
      throw validationFailed({ files: `Use at most ${AUTHORING_LIMITS.files} files.` });
    let total = 0;
    for (const bytes of files.values()) total += bytes.length;
    if (total > AUTHORING_LIMITS.totalBytes)
      throw validationFailed({ files: "The draft is larger than the 2 MB limit." });
  }

  // ───── edit ─────

  async updateMetadata(req: Request, id: string, raw: unknown): Promise<DraftView> {
    const input = updateDraftMetadataSchema.parse(raw);
    return this.serialize(id, async () => {
      const record = await this.load(req, id, "write");
      this.expect(record, input.expectedRevision);
      const manifest = (await this.readRawManifest(id)) as Record<string, unknown>;
      const { expectedRevision: _revision, ...changes } = input;
      void _revision;
      Object.assign(
        manifest,
        Object.fromEntries(Object.entries(changes).filter(([key, value]) => key !== "license" && value !== undefined)),
      );
      if (changes.license) manifest.license = { ...(manifest.license as object), spdx: changes.license };
      let next = record;
      if (changes.version && changes.version !== record.version) next = { ...record, version: changes.version };
      await this.writeManifest(id, manifest);
      await this.saveRecord(next, { bumpRevision: true });
      return this.view(await this.readRecord(id));
    });
  }

  private async readRawManifest(id: string): Promise<unknown> {
    return JSON.parse(await readFile(path.join(this.dirOf(id), "manifest.json"), "utf8"));
  }

  async readFile(req: Request, id: string, file: string): Promise<{ path: string; content: string }> {
    await this.load(req, id, "read");
    const reason = unsafeSourcePath(file);
    if (reason) throw validationFailed({ path: reason });
    const full = path.join(this.dirOf(id), "files", ...file.split("/"));
    const stats = await lstat(full).catch(() => null);
    if (!stats?.isFile() || stats.isSymbolicLink()) throw notFound("File");
    return { path: file, content: await readFile(full, "utf8") };
  }

  async putFile(req: Request, id: string, raw: unknown): Promise<DraftView> {
    const input = putDraftFileSchema.parse(raw);
    const reason = unsafeSourcePath(input.path);
    if (reason) throw validationFailed({ path: reason });
    return this.serialize(id, async () => {
      const record = await this.load(req, id, "write");
      this.expect(record, input.expectedRevision);
      const current = await this.view(record);
      const existing = current.files.find((file) => file.path === input.path);
      if (!existing && current.files.length >= AUTHORING_LIMITS.files) {
        throw validationFailed({ path: `Use at most ${AUTHORING_LIMITS.files} files.` });
      }
      const total = current.files.reduce((sum, file) => sum + (file.path === input.path ? 0 : file.bytes), 0);
      const bytes = Buffer.from(input.content, "utf8");
      if (total + bytes.length > AUTHORING_LIMITS.totalBytes)
        throw validationFailed({ path: "The draft would exceed the 2 MB limit." });
      const target = path.join(this.dirOf(id), "files", ...input.path.split("/"));
      await mkdir(path.dirname(target), { recursive: true });
      await writeFile(target, bytes);
      const manifest = (await this.readRawManifest(id)) as { files?: { source: string }[] };
      if (!manifest.files?.some((file) => file.source === input.path)) {
        manifest.files = [
          ...(manifest.files ?? []),
          { source: input.path, target: input.path, substitute: substituteFor(input.path) } as never,
        ];
        await this.writeManifest(id, manifest);
      }
      await this.saveRecord(record, { bumpRevision: true });
      return this.view(await this.readRecord(id));
    });
  }

  async deleteFile(req: Request, id: string, raw: unknown): Promise<DraftView> {
    const input = deleteDraftFileSchema.parse(raw);
    const reason = unsafeSourcePath(input.path);
    if (reason) throw validationFailed({ path: reason });
    return this.serialize(id, async () => {
      const record = await this.load(req, id, "write");
      this.expect(record, input.expectedRevision);
      const target = path.join(this.dirOf(id), "files", ...input.path.split("/"));
      const stats = await lstat(target).catch(() => null);
      if (!stats?.isFile() || stats.isSymbolicLink()) throw notFound("File");
      await rm(target);
      const manifest = (await this.readRawManifest(id)) as { files?: { source: string }[] };
      manifest.files = (manifest.files ?? []).filter((file) => file.source !== input.path);
      await this.writeManifest(id, manifest);
      await this.saveRecord(
        { ...record, aiFiles: record.aiFiles.filter((file) => file !== input.path) },
        { bumpRevision: true },
      );
      return this.view(await this.readRecord(id));
    });
  }

  async replaceManifest(req: Request, id: string, raw: unknown): Promise<DraftView> {
    const input = replaceDraftManifestSchema.parse(raw);
    return this.serialize(id, async () => {
      const record = await this.load(req, id, "write");
      this.expect(record, input.expectedRevision);
      const parsed = templateManifestSchema.safeParse(input.manifest);
      if (!parsed.success) {
        throw validationFailed({
          manifest: parsed.error.issues
            .slice(0, 5)
            .map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`)
            .join(" "),
        });
      }
      if (parsed.data.id !== record.templateId)
        throw validationFailed({ manifest: "The template id cannot be changed here." });
      if (parsed.data.kind !== "template") throw validationFailed({ manifest: "Only templates can be authored." });
      await this.writeManifest(id, parsed.data);
      await this.saveRecord({ ...record, version: parsed.data.version }, { bumpRevision: true });
      return this.view(await this.readRecord(id));
    });
  }

  async discard(req: Request, id: string): Promise<void> {
    await this.serialize(id, async () => {
      const record = await this.load(req, id, "write");
      await rm(this.dirOf(id), { recursive: true, force: true });
      await audit(this.ctx, req, {
        action: "template.draft_discard",
        outcome: "SUCCESS",
        targetType: "template_draft",
        targetId: record.id,
        metadata: { templateId: record.templateId },
      });
    });
  }

  // ───── submit for review ─────

  async submit(req: Request, id: string, raw: unknown): Promise<{ submissionId: string; draft: DraftView }> {
    const parsed = submitDraftSchema.safeParse(raw);
    if (!parsed.success) {
      const fields: Record<string, string> = {};
      for (const issue of parsed.error.issues) fields[issue.path.join(".") || "_"] ??= issue.message;
      throw validationFailed(fields, "Submission details need attention.");
    }
    const input = parsed.data;
    return this.serialize(id, async () => {
      const record = await this.load(req, id, "write");
      this.expect(record, input.expectedRevision);
      if (record.aiGenerated && !input.aiReviewed) {
        throw validationFailed(
          { aiReviewed: "This draft contains AI-generated content. Confirm that a person has reviewed every file." },
          "AI-generated content needs a person's review before submission.",
        );
      }
      const view = await this.view(record);
      if (view.problems.length) {
        throw validationFailed(
          { draft: view.problems.slice(0, 5).join(" ") },
          "Fix the draft's validation problems first.",
        );
      }
      const dir = this.dirOf(id);
      const template = await loadTemplate(dir, record.templateId, record.version);
      const manifestBytes = await readFile(path.join(dir, "manifest.json"));
      const digest = contentDigest(manifestBytes, template.files);
      const submissionId = randomUUID();
      await mkdir(this.submissionsRoot, { recursive: true });
      const staging = path.join(this.submissionsRoot, `.tmp-${submissionId}`);
      try {
        await mkdir(path.join(staging, "files"), { recursive: true });
        await writeFile(path.join(staging, "manifest.json"), manifestBytes, { flag: "wx" });
        for (const [file, bytes] of template.files) {
          const target = path.join(staging, "files", ...file.split("/"));
          await mkdir(path.dirname(target), { recursive: true });
          await writeFile(target, bytes, { flag: "wx" });
        }
        await rename(staging, path.join(this.submissionsRoot, submissionId));
      } catch (error) {
        await rm(staging, { recursive: true, force: true });
        throw error;
      }
      const manifest = view.manifest as TemplateManifest;
      await audit(this.ctx, req, {
        action: "template.submission_create",
        outcome: "SUCCESS",
        targetType: "template_submission",
        targetId: submissionId,
        metadata: {
          draftId: id,
          source: "authoring-draft",
          templateId: record.templateId,
          title: manifest.title,
          category: manifest.category,
          version: record.version,
          fileCount: template.files.size,
          bytes: [...template.files.values()].reduce((sum, bytes) => sum + bytes.length, 0),
          digest,
          reviewStatus: "PENDING",
          aiGenerated: record.aiGenerated,
          aiFiles: record.aiFiles.slice(0, 50),
          aiReviewedBy: record.aiGenerated ? req.owner!.id : null,
        },
      });
      await this.saveRecord({ ...record, status: "SUBMITTED", submissionId }, { bumpRevision: true });
      return { submissionId, draft: await this.view(await this.readRecord(id)) };
    });
  }
}

export function authoringRouter(
  ctx: AppContext,
  service: AuthoringService = new AuthoringService(ctx, new TemplateLibrary(ctx.config.TEMPLATE_LIBRARY_DIR)),
): Router {
  const router = Router();
  const idOf = (req: Request) => String(req.params.id);
  const guard = authorize(ctx, "template:submit");

  router.get("/drafts", guard, async (req, res, next) => {
    try {
      res.json({ drafts: await service.list(req) });
    } catch (error) {
      next(error);
    }
  });
  router.post("/drafts", guard, async (req, res, next) => {
    try {
      res.status(201).json({ draft: await service.create(req, req.body) });
    } catch (error) {
      next(error);
    }
  });
  router.get("/drafts/:id", guard, async (req, res, next) => {
    try {
      res.json({ draft: await service.get(req, idOf(req)) });
    } catch (error) {
      next(error);
    }
  });
  router.get("/drafts/:id/file", guard, async (req, res, next) => {
    try {
      res.json({ file: await service.readFile(req, idOf(req), String(req.query.path ?? "")) });
    } catch (error) {
      next(error);
    }
  });
  router.patch("/drafts/:id/metadata", guard, async (req, res, next) => {
    try {
      res.json({ draft: await service.updateMetadata(req, idOf(req), req.body) });
    } catch (error) {
      next(error);
    }
  });
  router.put("/drafts/:id/file", guard, async (req, res, next) => {
    try {
      res.json({ draft: await service.putFile(req, idOf(req), req.body) });
    } catch (error) {
      next(error);
    }
  });
  router.post("/drafts/:id/file/delete", guard, async (req, res, next) => {
    try {
      res.json({ draft: await service.deleteFile(req, idOf(req), req.body) });
    } catch (error) {
      next(error);
    }
  });
  router.put("/drafts/:id/manifest", guard, async (req, res, next) => {
    try {
      res.json({ draft: await service.replaceManifest(req, idOf(req), req.body) });
    } catch (error) {
      next(error);
    }
  });
  router.post("/drafts/:id/submit", guard, async (req, res, next) => {
    try {
      res.status(201).json(await service.submit(req, idOf(req), req.body));
    } catch (error) {
      next(error);
    }
  });
  router.delete("/drafts/:id", guard, async (req, res, next) => {
    try {
      await service.discard(req, idOf(req));
      res.status(204).end();
    } catch (error) {
      next(error);
    }
  });

  return router;
}
