import { createHash } from "node:crypto";
import {
  createDeliveryRequestSchema,
  deliveryDecisionSchema,
  exportDeliverySchema,
  type DeliveryProviderView,
  type DeliveryRequestView,
} from "@asaa/contracts";
import type { DeliveryRequest, Prisma, Project } from "@prisma/client";
import { Router, type Request } from "express";
import type { AppContext } from "../../context.js";
import { conflict, forbidden, notEligible, notFound } from "../../lib/errors.js";
import { audit } from "../audit/audit.service.js";
import { authorize } from "../auth/policy.js";
import { buildProjectArchive, collectProjectFiles } from "../export/archive.js";
import { digestOutput, resolveOutputDir } from "../generation/writer.js";
import { loadProjectAccess } from "../projects/projects.js";
import { detectGitDir, GitClient } from "../workspace/git.js";
import {
  LocalDeploymentTarget,
  LocalRepositoryHost,
  PLANNED_EXTERNAL_PROVIDERS,
  type DeploymentProvider,
  type RepositoryHostProvider,
} from "./providers.js";

const UUID = /^[0-9a-f-]{36}$/i;

export function deliveryView(request: DeliveryRequest, projectKey?: string): DeliveryRequestView {
  return {
    id: request.id,
    projectId: request.projectId,
    ...(projectKey ? { projectKey } : {}),
    kind: request.kind,
    status: request.status,
    provider: request.provider,
    target: request.target,
    note: request.note,
    requestedById: request.requestedById,
    decidedById: request.decidedById,
    decisionNote: request.decisionNote,
    result: (request.result as Record<string, unknown> | null) ?? null,
    createdAt: request.createdAt.toISOString(),
    decidedAt: request.decidedAt?.toISOString() ?? null,
    executedAt: request.executedAt?.toISOString() ?? null,
  };
}

export interface DeliveryProviders {
  repositoryHosts: RepositoryHostProvider[];
  deployments: DeploymentProvider[];
}

export function defaultDeliveryProviders(ctx: AppContext): DeliveryProviders {
  return {
    repositoryHosts: [
      new LocalRepositoryHost(ctx.config.DELIVERY_DIR, ctx.config.GIT_EXECUTABLE, ctx.config.GIT_TIMEOUT_MS),
    ],
    deployments: [new LocalDeploymentTarget(ctx.config.DELIVERY_DIR)],
  };
}

export function providerViews(providers: DeliveryProviders): DeliveryProviderView[] {
  return [
    ...providers.repositoryHosts.map((p) => ({
      id: p.id,
      label: p.label,
      role: "REPOSITORY_HOST" as const,
      external: p.external,
      available: p.available,
      note: p.note,
    })),
    ...providers.deployments.map((p) => ({
      id: p.id,
      label: p.label,
      role: "DEPLOYMENT" as const,
      external: p.external,
      available: p.available,
      note: p.note,
      environments: [...p.environments],
    })),
    ...PLANNED_EXTERNAL_PROVIDERS.filter(
      (planned) =>
        ![...providers.repositoryHosts, ...providers.deployments].some((registered) => registered.id === planned.id),
    ).map((p) => ({
      id: p.id,
      label: p.label,
      role: p.id === "github" ? ("REPOSITORY_HOST" as const) : ("DEPLOYMENT" as const),
      external: p.external,
      available: p.available,
      note: p.note,
    })),
  ];
}

/** The project's generated folder and generation provenance; delivery needs a successful generation. */
export async function projectSource(ctx: AppContext, projectId: string) {
  const generation = await ctx.prisma.projectGeneration.findUnique({
    where: { projectId },
    include: { project: true },
  });
  if (!generation || generation.status !== "SUCCEEDED") {
    throw conflict("Only successfully generated projects can leave the platform.");
  }
  const directory = await resolveOutputDir(ctx.config.GENERATION_OUTPUT_DIR, generation.outputDir);
  if (!directory) throw conflict("The project's folder is unavailable.");
  return { generation, directory };
}

async function workspaceState(ctx: AppContext, directory: string) {
  if ((await detectGitDir(directory)) !== "directory") return { repository: false as const };
  const git = new GitClient(ctx.config.GIT_EXECUTABLE, ctx.config.GIT_TIMEOUT_MS, ctx.config.GENERATION_OUTPUT_DIR);
  const [head, branch, status] = await Promise.all([
    git.run(directory, ["rev-parse", "HEAD"], { allowFailure: true }),
    git.run(directory, ["symbolic-ref", "--short", "HEAD"], { allowFailure: true }),
    git.run(directory, ["status", "--porcelain"], { allowFailure: true }),
  ]);
  return {
    repository: true as const,
    head: head.exitCode === 0 ? head.stdout.trim() : null,
    branch: branch.exitCode === 0 ? branch.stdout.trim() : null,
    uncommittedChanges: status.stdout.split("\n").filter(Boolean).length,
  };
}

export async function buildArchive(ctx: AppContext, projectId: string, withWorkspace: boolean) {
  const { generation, directory } = await projectSource(ctx, projectId);
  const built = await buildProjectArchive({
    directory,
    project: { key: generation.project.key, name: generation.project.name },
    generation: {
      id: generation.id,
      templateId: generation.templateId,
      templateVersion: generation.templateVersion,
      templateDigest: generation.templateDigest,
      generatorVersion: generation.generatorVersion,
      inputsHash: generation.inputsHash,
      outputDigest: generation.outputDigest,
      completedAt: generation.completedAt?.toISOString() ?? null,
    },
    currentDigest: await digestOutput(ctx.config.GENERATION_OUTPUT_DIR, generation.outputDir),
    ...(withWorkspace ? { extra: await workspaceState(ctx, directory) } : {}),
  });
  return { ...built, sha256: createHash("sha256").update(built.archive).digest("hex"), project: generation.project };
}

/**
 * Delivery workflows (D3.12 ZIP/workspace export, D3.13 repository handoff, D3.14 deployment).
 * Exports need explicit confirmation; handoff and deployment are requested by project editors and executed only
 * after a management decision. Every step is recorded in the delivery ledger and the audit trail.
 */
export function deliveryRouter(ctx: AppContext, providers: DeliveryProviders = defaultDeliveryProviders(ctx)): Router {
  const router = Router({ mergeParams: true });

  const projectIdOf = (req: Request) => String(req.params.projectId);

  router.get("/providers", authorize(ctx, "delivery:request"), (_req, res) => {
    res.json({ providers: providerViews(providers) });
  });

  router.get("/", authorize(ctx, "project:read"), async (req, res, next) => {
    try {
      const project = await loadProjectAccess(ctx, req.owner!.id, projectIdOf(req), "read");
      const requests = await ctx.prisma.deliveryRequest.findMany({
        where: { projectId: project.id },
        orderBy: { createdAt: "desc" },
        take: 100,
      });
      res.json({ requests: requests.map((request) => deliveryView(request)) });
    } catch (error) {
      next(error);
    }
  });

  router.post("/export", authorize(ctx, "delivery:export"), async (req, res, next) => {
    try {
      const project = await loadProjectAccess(ctx, req.owner!.id, projectIdOf(req), "write");
      if (project.archivedAt) throw conflict("Restore the project before exporting it.");
      const parsed = exportDeliverySchema.safeParse(req.body);
      if (!parsed.success) {
        throw notEligible("Explicit confirmation is required to export a project.", {
          confirm: parsed.error.issues[0]?.message ?? "Confirm the export.",
        });
      }
      const { scope, note } = parsed.data;
      let built: Awaited<ReturnType<typeof buildArchive>>;
      try {
        built = await buildArchive(ctx, project.id, scope === "WORKSPACE_EXPORT");
      } catch (error) {
        await recordFailedExport(ctx, req, project, scope, note, error);
        throw error;
      }
      const now = ctx.now();
      const request = await ctx.prisma.deliveryRequest.create({
        data: {
          projectId: project.id,
          kind: scope,
          status: "EXECUTED",
          provider: "download",
          note,
          requestedById: req.owner!.id,
          decidedById: req.owner!.id,
          decidedAt: now,
          executedAt: now,
          result: { filename: built.filename, bytes: built.archive.length, sha256: built.sha256 },
        },
      });
      await audit(ctx, req, {
        action: "delivery.export",
        outcome: "SUCCESS",
        targetType: "project",
        targetId: project.id,
        metadata: { deliveryId: request.id, scope, bytes: built.archive.length, archiveSha256: built.sha256 },
      });
      res.setHeader("content-type", "application/zip");
      res.setHeader("content-disposition", `attachment; filename="${built.filename}"`);
      res.setHeader("content-length", String(built.archive.length));
      res.setHeader("x-content-type-options", "nosniff");
      res.setHeader("x-delivery-id", request.id);
      res.end(built.archive);
    } catch (error) {
      next(error);
    }
  });

  router.post("/requests", authorize(ctx, "delivery:request"), async (req, res, next) => {
    try {
      const project = await loadProjectAccess(ctx, req.owner!.id, projectIdOf(req), "write");
      if (project.archivedAt) throw conflict("Restore the project before requesting delivery.");
      const input = createDeliveryRequestSchema.parse(req.body);
      if (input.kind === "REPOSITORY_HANDOFF") {
        const host = providers.repositoryHosts.find((candidate) => candidate.id === input.provider);
        if (!host?.available)
          throw notEligible("That repository provider is not available.", {
            provider: "Choose an available provider.",
          });
      } else {
        const target = providers.deployments.find((candidate) => candidate.id === input.provider);
        if (!target?.available)
          throw notEligible("That deployment provider is not available.", {
            provider: "Choose an available provider.",
          });
        if (!target.environments.includes(input.target)) {
          throw notEligible("Unknown environment.", { target: `Choose one of: ${target.environments.join(", ")}.` });
        }
      }
      await projectSource(ctx, project.id);
      const open = await ctx.prisma.deliveryRequest.findFirst({
        where: { projectId: project.id, kind: input.kind, target: input.target, status: "REQUESTED" },
      });
      if (open) throw conflict("An identical request is already waiting for a decision.");
      const request = await ctx.prisma.deliveryRequest.create({
        data: {
          projectId: project.id,
          kind: input.kind,
          provider: input.provider,
          target: input.target,
          note: input.note,
          requestedById: req.owner!.id,
        },
      });
      await audit(ctx, req, {
        action: "delivery.request",
        outcome: "SUCCESS",
        targetType: "project",
        targetId: project.id,
        metadata: { deliveryId: request.id, kind: input.kind, provider: input.provider, target: input.target },
      });
      res.status(201).json({ request: deliveryView(request) });
    } catch (error) {
      next(error);
    }
  });

  router.post("/requests/:id/cancel", authorize(ctx, "delivery:request"), async (req, res, next) => {
    try {
      const project = await loadProjectAccess(ctx, req.owner!.id, projectIdOf(req), "write");
      const id = String(req.params.id);
      if (!UUID.test(id)) throw notFound("Delivery request");
      const request = await ctx.prisma.deliveryRequest.findFirst({ where: { id, projectId: project.id } });
      if (!request) throw notFound("Delivery request");
      if (request.requestedById !== req.owner!.id && project.ownerId !== req.owner!.id) throw forbidden();
      const changed = await ctx.prisma.deliveryRequest.updateMany({
        where: { id, status: "REQUESTED" },
        data: { status: "CANCELLED", decidedById: req.owner!.id, decidedAt: ctx.now() },
      });
      if (changed.count === 0) throw conflict("This request has already been decided.");
      await audit(ctx, req, {
        action: "delivery.cancel",
        outcome: "SUCCESS",
        targetType: "project",
        targetId: project.id,
        metadata: { deliveryId: id },
      });
      res.json({ request: deliveryView(await ctx.prisma.deliveryRequest.findUniqueOrThrow({ where: { id } })) });
    } catch (error) {
      next(error);
    }
  });

  return router;
}

async function recordFailedExport(
  ctx: AppContext,
  req: Request,
  project: Project,
  scope: string,
  note: string,
  error: unknown,
) {
  await audit(ctx, req, {
    action: "delivery.export",
    outcome: "FAILURE",
    targetType: "project",
    targetId: project.id,
    metadata: { scope, note, reason: error instanceof Error ? error.message.slice(0, 200) : "failed" },
  });
}

/**
 * Management inbox: pending handoff/deployment requests across projects, with approve/reject. Execution happens
 * here, after the decision, through the registered provider interface.
 */
export function deliveryApprovalsRouter(
  ctx: AppContext,
  providers: DeliveryProviders = defaultDeliveryProviders(ctx),
): Router {
  const router = Router();

  router.get("/requests", authorize(ctx, "delivery:approve"), async (req, res, next) => {
    try {
      const status = typeof req.query.status === "string" ? req.query.status : "REQUESTED";
      const where: Prisma.DeliveryRequestWhereInput = status === "all" ? {} : { status: status as "REQUESTED" };
      const requests = await ctx.prisma.deliveryRequest.findMany({
        where,
        include: { project: { select: { key: true } } },
        orderBy: { createdAt: "desc" },
        take: 100,
      });
      res.json({ requests: requests.map((request) => deliveryView(request, request.project.key)) });
    } catch (error) {
      next(error);
    }
  });

  router.post("/requests/:id/reject", authorize(ctx, "delivery:approve"), async (req, res, next) => {
    try {
      const id = String(req.params.id);
      if (!UUID.test(id)) throw notFound("Delivery request");
      const { note } = deliveryDecisionSchema.parse(req.body);
      const changed = await ctx.prisma.deliveryRequest.updateMany({
        where: { id, status: "REQUESTED", decidedById: null },
        data: { status: "REJECTED", decidedById: req.owner!.id, decidedAt: ctx.now(), decisionNote: note },
      });
      if (changed.count === 0) throw conflict("This request does not exist or has already been decided.");
      await audit(ctx, req, {
        action: "delivery.reject",
        outcome: "SUCCESS",
        targetType: "delivery_request",
        targetId: id,
        metadata: { note },
      });
      res.json({ request: deliveryView(await ctx.prisma.deliveryRequest.findUniqueOrThrow({ where: { id } })) });
    } catch (error) {
      next(error);
    }
  });

  router.post("/requests/:id/approve", authorize(ctx, "delivery:approve"), async (req, res, next) => {
    try {
      const id = String(req.params.id);
      if (!UUID.test(id)) throw notFound("Delivery request");
      const { note } = deliveryDecisionSchema.parse(req.body);
      const existing = await ctx.prisma.deliveryRequest.findUnique({ where: { id } });
      if (!existing) throw notFound("Delivery request");
      // Separation of duties: only the account owner may approve their own request (single-owner organisations).
      if (existing.requestedById === req.owner!.id && req.owner!.role !== "OWNER") {
        throw forbidden();
      }
      // Claim the request atomically so concurrent approvals cannot execute it twice.
      const claim = await ctx.prisma.deliveryRequest.updateMany({
        where: { id, status: "REQUESTED", decidedById: null },
        data: { decidedById: req.owner!.id, decidedAt: ctx.now(), decisionNote: note },
      });
      if (claim.count === 0) throw conflict("This request has already been decided.");
      const outcome = await execute(ctx, existing, providers).then(
        (result) => ({ ok: true as const, result }),
        (error: unknown) => ({
          ok: false as const,
          reason: error instanceof Error ? error.message.slice(0, 300) : "Delivery failed.",
        }),
      );
      const updated = await ctx.prisma.deliveryRequest.update({
        where: { id },
        data: outcome.ok
          ? { status: "EXECUTED", executedAt: ctx.now(), result: outcome.result as Prisma.InputJsonValue }
          : { status: "FAILED", result: { error: outcome.reason } },
      });
      await audit(ctx, req, {
        action: "delivery.execute",
        outcome: outcome.ok ? "SUCCESS" : "FAILURE",
        targetType: "project",
        targetId: existing.projectId,
        metadata: {
          ...(outcome.ok ? outcome.result : { reason: outcome.reason }),
          deliveryId: id,
          kind: existing.kind,
          provider: existing.provider,
          target: existing.target,
          approvedBy: req.owner!.id,
        },
      });
      res.json({ request: deliveryView(updated) });
    } catch (error) {
      next(error);
    }
  });

  return router;
}

async function execute(ctx: AppContext, request: DeliveryRequest, providers: DeliveryProviders) {
  const project = await ctx.prisma.project.findUnique({ where: { id: request.projectId } });
  if (!project) throw notFound("Project");
  if (project.archivedAt) throw conflict("The project is archived.");
  if (request.kind === "REPOSITORY_HANDOFF") {
    const host = providers.repositoryHosts.find((candidate) => candidate.id === request.provider);
    if (!host?.available) throw notEligible("The repository provider is no longer available.");
    const { generation, directory } = await projectSource(ctx, project.id);
    const files = await collectProjectFiles(directory);
    const repository = await ctx.prisma.projectRepository.findUnique({ where: { projectId: project.id } });
    const created = await host.createRepository({
      name: request.target,
      description: project.name,
      files,
      defaultBranch: repository?.defaultBranch ?? "main",
      author: {
        name: repository?.identityName ?? "ASAA Templates",
        email: repository?.identityEmail ?? "templates@localhost",
      },
    });
    return {
      ...created,
      provider: host.id,
      templateId: generation.templateId,
      templateVersion: generation.templateVersion,
    };
  }
  if (request.kind === "DEPLOYMENT") {
    const target = providers.deployments.find((candidate) => candidate.id === request.provider);
    if (!target?.available) throw notEligible("The deployment provider is no longer available.");
    const built = await buildArchive(ctx, project.id, true);
    const deployed = await target.deploy({
      projectKey: project.key,
      environment: request.target,
      archive: built.archive,
      archiveSha256: built.sha256,
    });
    return { ...deployed, provider: target.id, environment: request.target, bytes: built.archive.length };
  }
  throw notEligible("This request type is executed immediately and cannot be approved.");
}
