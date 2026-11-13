import { createHash } from "node:crypto";
import {
  createGenerationSchema,
  fieldErrors,
  GENERATOR_VERSION,
  templateInputValuesSchema,
  type GenerationPreviewView,
  type GenerationVerificationView,
  type GenerationView,
  type ProjectBlueprint,
  type StarterOptionView,
  type TemplateInputValues,
  type TemplateManifest,
  type TemplateOptionView,
  type TemplateSummaryView,
} from "@asaa/contracts";
import { Prisma, type CatalogItem, type Project, type ProjectGeneration } from "@prisma/client";
import type { Request } from "express";
import type { AppContext } from "../../context.js";
import { AppError, conflict, notEligible, notFound, validationFailed } from "../../lib/errors.js";
import { audit } from "../audit/audit.service.js";
import { catalogView } from "../catalog/catalog.js";
import { snapshot } from "../requirements/requirements.js";
import { isUsable, TemplateLibrary, type LibraryTemplate } from "./library.js";
import { GenerationError, projectVariables, type RenderPlan } from "./render.js";
import { renderWithAdapter } from "./adapters.js";
import {
  digestOutput,
  nodeFs,
  OutputBusyError,
  OutputConflictError,
  outputExists,
  readProvenance,
  removeOutput,
  resolveOutputRoot,
  writeOutput,
  type WriterFs,
} from "./writer.js";

type UsableTemplate = LibraryTemplate & { manifest: TemplateManifest; digest: string };
type GenerationWithProject = ProjectGeneration & { project: Project };

const UUID = /^[0-9a-f-]{36}$/i;

export function generationView(generation: GenerationWithProject): GenerationView {
  return {
    id: generation.id,
    projectId: generation.projectId,
    blueprint: generation.project.blueprint ? (generation.project.blueprint as ProjectBlueprint) : null,
    projectKey: generation.project.key,
    projectName: generation.project.name,
    mode: generation.mode,
    status: generation.status,
    templateId: generation.templateId,
    templateVersion: generation.templateVersion,
    templateDigest: generation.templateDigest,
    catalogItemId: generation.catalogItemId,
    generatorVersion: generation.generatorVersion,
    inputs: (generation.inputs ?? {}) as TemplateInputValues,
    requirements: generation.requirements,
    inputsHash: generation.inputsHash,
    outputDir: generation.outputDir,
    outputDigest: generation.outputDigest,
    files: generation.files,
    attempts: generation.attempts,
    error: generation.error,
    startedAt: generation.startedAt.toISOString(),
    completedAt: generation.completedAt?.toISOString() ?? null,
    version: generation.version,
  };
}

/** Canonical JSON (sorted keys) so the inputs hash is stable across runs. */
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

/**
 * Why a catalog record cannot be used for generation right now. An empty list
 * means eligible. Policy: only ACTIVE + TRUSTED template records whose linked
 * content is valid, generator-compatible, the same version, and byte-identical
 * to what the owner approved (digest) can be generated. There is no override.
 */
export function eligibilityProblems(item: CatalogItem, template: LibraryTemplate | null): string[] {
  const reasons: string[] = [];
  if (item.kind !== "TEMPLATE") reasons.push("Only template catalog items can start a project.");
  if (item.lifecycle === "DEPRECATED") reasons.push("This template is deprecated.");
  else if (item.lifecycle === "RETIRED") reasons.push("This template is retired.");
  else if (item.lifecycle !== "ACTIVE") reasons.push("This template is not active yet.");
  if (item.trustStatus !== "TRUSTED") reasons.push("This template has not been reviewed and trusted.");
  if (!item.contentRef || !item.contentDigest) {
    reasons.push("No approved template content is linked to this catalog item.");
    return reasons;
  }
  if (!template) {
    reasons.push(`Template content ${item.contentRef}@${item.version} is not in the local template library.`);
    return reasons;
  }
  if (!isUsable(template)) {
    reasons.push(`Template content is invalid: ${template.problems.slice(0, 3).join(" ")}`);
    return reasons;
  }
  if (template.manifest.kind !== "template") reasons.push("Linked content is a starter, not a template.");
  if (template.digest !== item.contentDigest) {
    reasons.push("Template content changed since it was approved. Review and approve it again.");
  }
  return reasons;
}

export interface GenerationServiceOptions {
  library: TemplateLibrary;
  outputRoot: string;
  fs?: WriterFs;
}

/** Project initialization and generation (US-E01, US-E02). */
export class GenerationService {
  private readonly fs: WriterFs;
  constructor(
    private readonly ctx: AppContext,
    private readonly options: GenerationServiceOptions,
  ) {
    this.fs = options.fs ?? nodeFs;
  }

  private get prisma() {
    return this.ctx.prisma;
  }

  // ───── Library and options ─────

  async librarySummaries(): Promise<TemplateSummaryView[]> {
    const [templates, linked] = await Promise.all([
      this.options.library.list(),
      this.prisma.catalogItem.findMany({ where: { contentRef: { not: null } } }),
    ]);
    return templates.map((template) => {
      const item = linked.find((row) => row.contentRef === template.id && row.version === template.version);
      const manifest = template.manifest;
      return {
        id: template.id,
        version: template.version,
        kind: manifest?.kind ?? null,
        title: manifest?.title ?? template.id,
        description: manifest?.description ?? "",
        category: manifest?.category ?? "",
        projectType: manifest?.projectType ?? null,
        technologies: manifest?.technologies ?? [],
        license: manifest?.license.spdx ?? "",
        digest: template.digest,
        valid: isUsable(template),
        problems: template.problems,
        catalogItemId: item?.id ?? null,
        approved: Boolean(item && isUsable(template) && item.contentDigest === template.digest),
      };
    });
  }

  async templateOptions(): Promise<TemplateOptionView[]> {
    const [items, templates] = await Promise.all([
      this.prisma.catalogItem.findMany({ where: { kind: "TEMPLATE" }, orderBy: { title: "asc" }, take: 200 }),
      this.options.library.list(),
    ]);
    return items.map((item) => {
      const template = templates.find((t) => t.id === item.contentRef && t.version === item.version) ?? null;
      const reasons = eligibilityProblems(item, template);
      return {
        catalogItem: catalogView(item),
        manifest: template?.manifest ? template.rawManifest : null,
        files: template?.manifest ? template.manifest.files.map(({ source, target }) => ({ source, target })) : [],
        eligible: reasons.length === 0,
        reasons,
      };
    });
  }

  async starterOptions(): Promise<StarterOptionView[]> {
    const starters: StarterOptionView[] = [];
    for (const template of await this.options.library.list()) {
      if (!isUsable(template) || template.manifest.kind !== "starter" || !template.manifest.projectType) continue;
      starters.push({
        id: template.id,
        version: template.version,
        projectType: template.manifest.projectType,
        manifest: template.rawManifest,
        digest: template.digest,
      });
    }
    return starters;
  }

  /**
   * Owner approval of library content (US-D02 trust + US-E01): creates or updates
   * the catalog record for a library template and pins the approved digest.
   */
  async approve(req: Request, id: string, version: string): Promise<{ item: CatalogItem; created: boolean }> {
    const template = await this.options.library.get(id, version);
    if (!template) throw notFound("Template");
    if (!isUsable(template)) {
      throw notEligible(`This template content is invalid and cannot be approved: ${template.problems.join(" ")}`);
    }
    const manifest = template.manifest;
    if (manifest.kind !== "template") throw notEligible("Starters are platform conventions and are not catalogued.");
    const data = {
      title: manifest.title,
      description: manifest.description,
      kind: "TEMPLATE" as const,
      category: manifest.category,
      technologies: manifest.technologies.map((tech) => tech.name.toLowerCase()).slice(0, 20),
      version: manifest.version,
      license: manifest.license.spdx,
      ownership: manifest.provenance.maintainer,
      dependencies: manifest.dependencies,
      sourceType: "AUTHORED" as const,
      sourceReference: manifest.provenance.repository ?? `template-library/${id}/${version}`,
      contentRef: id,
      contentDigest: template.digest,
      trustStatus: "TRUSTED" as const,
      lifecycle: "ACTIVE" as const,
    };
    const existing = await this.prisma.catalogItem.findUnique({ where: { slug: id } });
    if (existing && existing.sourceType === "IMPORTED") {
      throw conflict("A catalog item with this slug was imported from elsewhere; resolve the clash first.");
    }
    const item = existing
      ? await this.prisma.catalogItem.update({
          where: { id: existing.id },
          data: { ...data, rowVersion: { increment: 1 } },
        })
      : await this.prisma.catalogItem.create({ data: { slug: id, ...data } });
    await audit(this.ctx, req, {
      action: "catalog.content_approve",
      outcome: "SUCCESS",
      targetType: "catalog_item",
      targetId: item.id,
      metadata: {
        templateId: id,
        version,
        digest: template.digest,
        previousDigest: existing?.contentDigest ?? null,
      },
    });
    return { item, created: !existing };
  }

  // ───── Resolution and validation ─────

  private async resolve(
    input: ReturnType<typeof createGenerationSchema.parse>,
  ): Promise<{ template: UsableTemplate; catalogItem: CatalogItem | null }> {
    if (input.mode === "SCRATCH") {
      if (Boolean(input.starterId) !== Boolean(input.starterVersion)) {
        throw validationFailed(
          { starterId: "Choose a starter ID and version together." },
          "The selected starter reference is incomplete.",
        );
      }
      const template =
        input.starterId && input.starterVersion
          ? await this.options.library.get(input.starterId, input.starterVersion)
          : await this.options.library.starterFor(input.projectType);
      if (!template || !isUsable(template) || template.manifest.kind !== "starter") {
        throw notEligible(`No usable starter is available for "${input.projectType}" projects.`);
      }
      if (template.manifest.projectType !== input.projectType) {
        throw notEligible("The selected starter does not implement the requested project type.");
      }
      return { template, catalogItem: null };
    }
    const catalogItem = await this.prisma.catalogItem.findUnique({ where: { id: input.catalogItemId } });
    if (!catalogItem) throw notFound("Template");
    const template = catalogItem.contentRef
      ? await this.options.library.get(catalogItem.contentRef, catalogItem.version)
      : null;
    const reasons = eligibilityProblems(catalogItem, template);
    if (reasons.length > 0 || !template || !isUsable(template)) {
      throw notEligible(`This template cannot be used: ${reasons.join(" ")}`, { catalogItemId: reasons.join(" ") });
    }
    return { template, catalogItem };
  }

  private values(manifest: TemplateManifest, raw: Record<string, string | boolean>): TemplateInputValues {
    const parsed = templateInputValuesSchema(manifest.inputs).safeParse(raw);
    if (!parsed.success) {
      const fields = Object.fromEntries(
        Object.entries(fieldErrors(parsed.error)).map(([key, message]) => [
          key === "_" ? "inputs" : `inputs.${key}`,
          message,
        ]),
      );
      throw validationFailed(fields, "Check the template configuration.");
    }
    return Object.fromEntries(
      Object.entries(parsed.data as Record<string, unknown>).filter(([, value]) => value !== undefined),
    ) as TemplateInputValues;
  }

  private render(
    template: UsableTemplate,
    values: TemplateInputValues,
    project: { key: string; name: string; purpose: string },
  ): RenderPlan {
    try {
      return renderWithAdapter({
        manifest: template.manifest,
        sources: template.files,
        values,
        project: projectVariables(project),
      });
    } catch (error) {
      if (error instanceof GenerationError) throw validationFailed({ inputs: error.message }, error.message);
      throw error;
    }
  }

  private async prepare(raw: unknown) {
    const input = createGenerationSchema.parse(raw);
    const { template, catalogItem } = await this.resolve(input);
    const values = this.values(template.manifest, input.inputs);
    const blueprint = template.manifest.blueprint ?? null;
    if (input.blueprint && canonical(input.blueprint) !== canonical(blueprint)) {
      throw validationFailed(
        { blueprint: "The selected project blueprint does not match the approved starter/template." },
        "The selected project blueprint is not compatible with this source.",
      );
    }
    const plan = this.render(template, values, input.project);
    const outputDir = input.project.key.toLowerCase();
    const inputsHash = createHash("sha256")
      .update(
        canonical({
          template: { id: template.id, version: template.version, digest: template.digest },
          project: input.project,
          blueprint,
          inputs: values,
          requirements: input.requirements,
        }),
      )
      .digest("hex");
    return { input, template, catalogItem, values, plan, outputDir, inputsHash, blueprint };
  }

  private async conflicts(key: string, outputDir: string): Promise<string[]> {
    const conflicts: string[] = [];
    if (await this.prisma.project.findUnique({ where: { key }, select: { id: true } })) {
      conflicts.push(`A project with key ${key} already exists.`);
    }
    const root = await resolveOutputRoot(this.options.outputRoot, this.fs);
    if (await outputExists(root, outputDir)) conflicts.push(`An output folder named "${outputDir}" already exists.`);
    return conflicts;
  }

  // ───── Preview, generate, retry, verify ─────

  /** Validate everything and show exactly what would be generated, without writing anything. */
  async preview(raw: unknown): Promise<GenerationPreviewView> {
    const { input, template, plan, outputDir, blueprint } = await this.prepare(raw);
    return {
      blueprint,
      outputDir,
      files: plan.files.map((file) => ({ path: file.path, bytes: file.content.length })),
      directories: plan.directories,
      totalBytes: plan.totalBytes,
      outputDigest: plan.digest,
      template: { id: template.id, version: template.version, digest: template.digest, kind: template.manifest.kind },
      conflicts: await this.conflicts(input.project.key, outputDir),
    };
  }

  async generate(req: Request, raw: unknown): Promise<GenerationWithProject> {
    let prepared: Awaited<ReturnType<GenerationService["prepare"]>>;
    try {
      prepared = await this.prepare(raw);
    } catch (error) {
      if (error instanceof AppError && error.code === "NOT_ELIGIBLE") {
        await audit(this.ctx, req, {
          action: "generation.rejected",
          outcome: "DENIED",
          targetType: "catalog_item",
          targetId: (raw as { catalogItemId?: string })?.catalogItemId?.slice(0, 80),
          metadata: { reason: error.message },
        });
      }
      throw error;
    }
    const { input, template, catalogItem, values, plan, outputDir, inputsHash, blueprint } = prepared;
    const conflicts = await this.conflicts(input.project.key, outputDir);
    if (conflicts.length > 0) throw conflict(conflicts.join(" "));

    // Project, initial requirements and the generation record commit together or not at all.
    const generation = await this.prisma.$transaction(async (tx) => {
      const project = await tx.project.create({
        data: {
          key: input.project.key,
          name: input.project.name,
          purpose: input.project.purpose,
          blueprint: blueprint ? (blueprint as Prisma.InputJsonValue) : Prisma.DbNull,
          ownerId: req.owner!.id,
          requirementSeq: input.requirements.length,
        },
      });
      for (const [index, title] of input.requirements.entries()) {
        const requirement = await tx.requirement.create({
          data: { projectId: project.id, code: `REQ-${index + 1}`, title, kind: "USER_STORY" },
        });
        await tx.requirementVersion.create({
          data: {
            requirementId: requirement.id,
            version: 1,
            snapshot: snapshot(requirement, []),
            changeNote: "Captured during project initialization",
          },
        });
      }
      return tx.projectGeneration.create({
        data: {
          projectId: project.id,
          mode: input.mode,
          templateId: template.id,
          templateVersion: template.version,
          templateDigest: template.digest,
          catalogItemId: catalogItem?.id ?? null,
          generatorVersion: GENERATOR_VERSION,
          inputs: values as Prisma.InputJsonValue,
          requirements: input.requirements,
          inputsHash,
          outputDir,
          startedAt: this.ctx.now(),
        },
        include: { project: true },
      });
    });
    await audit(this.ctx, req, {
      action: "project.create",
      outcome: "SUCCESS",
      targetType: "project",
      targetId: generation.projectId,
      metadata: { key: generation.project.key, generationId: generation.id, mode: input.mode },
    });
    return this.execute(req, generation, template, plan);
  }

  async retry(req: Request, id: string, expectedVersion: number): Promise<GenerationWithProject> {
    const generation = await this.load(req, id, "write");
    if (generation.status !== "FAILED") throw conflict("Only failed generations can be retried.");
    if (generation.version !== expectedVersion) {
      throw conflict("This generation was changed elsewhere. Reload and try again.");
    }
    const template = await this.options.library.get(generation.templateId, generation.templateVersion);
    if (!template || !isUsable(template) || template.digest !== generation.templateDigest) {
      throw notEligible("The template content changed since this generation started, so it cannot be reproduced.");
    }
    if (generation.mode === "TEMPLATE") {
      const item = generation.catalogItemId
        ? await this.prisma.catalogItem.findUnique({ where: { id: generation.catalogItemId } })
        : null;
      const reasons = item ? eligibilityProblems(item, template) : ["The catalog record no longer exists."];
      if (reasons.length > 0) throw notEligible(`This template cannot be used: ${reasons.join(" ")}`);
    }
    const values = this.values(template.manifest, generation.inputs as TemplateInputValues);
    const plan = this.render(template, values, generation.project);
    const claimed = await this.prisma.projectGeneration.updateMany({
      where: { id: generation.id, version: expectedVersion, status: "FAILED" },
      data: { status: "PENDING", error: null, attempts: { increment: 1 }, version: { increment: 1 } },
    });
    if (claimed.count === 0) throw conflict("This generation was changed elsewhere. Reload and try again.");
    const current = await this.prisma.projectGeneration.findUniqueOrThrow({
      where: { id: generation.id },
      include: { project: true },
    });
    await audit(this.ctx, req, {
      action: "generation.retry",
      outcome: "SUCCESS",
      targetType: "project",
      targetId: generation.projectId,
      metadata: { generationId: generation.id, attempt: current.attempts },
    });
    return this.execute(req, current, template, plan);
  }

  /** Write the output, then record the result; never leaves a success state without an output. */
  private async execute(
    req: Request,
    generation: GenerationWithProject,
    template: UsableTemplate,
    plan: RenderPlan,
  ): Promise<GenerationWithProject> {
    const provenance = {
      generator: "asaa-templates",
      generatorVersion: GENERATOR_VERSION,
      generationId: generation.id,
      mode: generation.mode,
      template: {
        id: template.id,
        version: template.version,
        digest: template.digest,
        kind: template.manifest.kind,
        license: template.manifest.license.spdx,
        catalogItemId: generation.catalogItemId,
      },
      project: {
        key: generation.project.key,
        name: generation.project.name,
        blueprint: generation.project.blueprint,
      },
      inputs: generation.inputs,
      requirements: generation.requirements,
      inputsHash: generation.inputsHash,
      outputDigest: plan.digest,
      generatedAt: this.ctx.now().toISOString(),
    };
    try {
      await writeOutput(this.options.outputRoot, generation.outputDir, generation.id, plan, provenance, this.fs);
    } catch (error) {
      // Idempotent retry: if this very generation already published a verified output
      // (for example the process stopped before recording success), adopt it.
      const adopted = error instanceof OutputConflictError && (await this.ownsOutput(generation, plan.digest));
      if (!adopted) return this.recordWriteFailure(req, generation, error);
    }
    return this.recordSuccess(req, generation, template, plan);
  }

  /** True when the existing output folder was written by this generation and is intact. */
  private async ownsOutput(generation: GenerationWithProject, digest: string): Promise<boolean> {
    const provenance = await readProvenance(this.options.outputRoot, generation.outputDir);
    if (provenance?.generationId !== generation.id) return false;
    return (await digestOutput(this.options.outputRoot, generation.outputDir)) === digest;
  }

  private async recordWriteFailure(
    req: Request,
    generation: GenerationWithProject,
    error: unknown,
  ): Promise<GenerationWithProject> {
    const auditBase = { targetType: "project", targetId: generation.projectId } as const;
    const message =
      error instanceof OutputConflictError || error instanceof OutputBusyError
        ? error.message
        : "Writing the project files failed. No partial output was kept; you can retry.";
    this.ctx.logger.error("generation write failed", {
      generationId: generation.id,
      error: error instanceof Error ? error.message : String(error),
    });
    const failed = await this.prisma.projectGeneration.update({
      where: { id: generation.id },
      data: { status: "FAILED", error: message, completedAt: null, version: { increment: 1 } },
      include: { project: true },
    });
    await audit(this.ctx, req, {
      action: "generation.complete",
      outcome: "FAILURE",
      ...auditBase,
      metadata: { generationId: generation.id, error: message, attempt: generation.attempts },
    });
    return failed;
  }

  private async recordSuccess(
    req: Request,
    generation: GenerationWithProject,
    template: UsableTemplate,
    plan: RenderPlan,
  ): Promise<GenerationWithProject> {
    const auditBase = { targetType: "project", targetId: generation.projectId } as const;
    try {
      const succeeded = await this.prisma.projectGeneration.update({
        where: { id: generation.id },
        data: {
          status: "SUCCEEDED",
          outputDigest: plan.digest,
          files: plan.files.map((file) => file.path),
          completedAt: this.ctx.now(),
          error: null,
          version: { increment: 1 },
        },
        include: { project: true },
      });
      await audit(this.ctx, req, {
        action: "generation.complete",
        outcome: "SUCCESS",
        ...auditBase,
        metadata: {
          generationId: generation.id,
          mode: generation.mode,
          templateId: template.id,
          templateVersion: template.version,
          outputDigest: plan.digest,
          files: plan.files.length,
        },
      });
      return succeeded;
    } catch (error) {
      // Recording success failed: remove the unrecorded output and mark the attempt failed.
      await removeOutput(this.options.outputRoot, generation.outputDir, this.fs).catch(() => undefined);
      await this.prisma.projectGeneration
        .update({
          where: { id: generation.id },
          data: {
            status: "FAILED",
            error: "Recording the result failed; the output was removed. Retry.",
            version: { increment: 1 },
          },
        })
        .catch(() => undefined);
      throw error;
    }
  }

  async verify(req: Request, id: string): Promise<GenerationVerificationView> {
    const generation = await this.load(req, id);
    const problems: string[] = [];
    let renderedDigest: string | null = null;
    const template = await this.options.library.get(generation.templateId, generation.templateVersion);
    if (!template || !isUsable(template)) problems.push("The template version used is no longer available.");
    else if (template.digest !== generation.templateDigest)
      problems.push("The template content changed since generation.");
    else {
      try {
        const values = this.values(template.manifest, generation.inputs as TemplateInputValues);
        renderedDigest = this.render(template, values, generation.project).digest;
      } catch (error) {
        problems.push(error instanceof Error ? error.message : "Re-rendering failed.");
      }
    }
    const diskDigest = await digestOutput(this.options.outputRoot, generation.outputDir);
    if (generation.status !== "SUCCEEDED") problems.push("This generation has not succeeded.");
    if (!diskDigest) problems.push("The output folder is missing or contains links.");
    else if (diskDigest !== generation.outputDigest)
      problems.push("Files in the output folder were changed after generation.");
    if (renderedDigest && renderedDigest !== generation.outputDigest) {
      problems.push("Re-rendering the recorded inputs produced different files.");
    }
    const result: GenerationVerificationView = {
      reproducible: Boolean(renderedDigest && renderedDigest === generation.outputDigest),
      outputIntact: Boolean(diskDigest && diskDigest === generation.outputDigest),
      recordedDigest: generation.outputDigest,
      renderedDigest,
      diskDigest,
      problems,
    };
    await audit(this.ctx, req, {
      action: "generation.verify",
      outcome: problems.length === 0 ? "SUCCESS" : "FAILURE",
      targetType: "project",
      targetId: generation.projectId,
      metadata: { generationId: generation.id, reproducible: result.reproducible, outputIntact: result.outputIntact },
    });
    return result;
  }

  // ───── Reads ─────

  async load(req: Request, id: string, access: "read" | "write" = "read"): Promise<GenerationWithProject> {
    if (!UUID.test(id)) throw notFound("Generation");
    const generation = await this.prisma.projectGeneration.findFirst({
      where: { id, project: { OR: [
        { ownerId: req.owner!.id },
        { members: { some: { memberId: req.owner!.id, ...(access === "write" ? { role: "EDITOR" as const } : {}) } } },
      ] } },
      include: { project: true },
    });
    if (!generation) throw notFound("Generation");
    return generation;
  }

  async list(req: Request, query: { projectId?: string; status?: GenerationView["status"] }) {
    return this.prisma.projectGeneration.findMany({
      where: {
        project: { OR: [{ ownerId: req.owner!.id }, { members: { some: { memberId: req.owner!.id } } }] },
        ...(query.projectId ? { projectId: query.projectId } : {}),
        ...(query.status ? { status: query.status } : {}),
      },
      include: { project: true },
      orderBy: { startedAt: "desc" },
      take: 100,
    });
  }
}
