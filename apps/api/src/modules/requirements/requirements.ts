import {
  createRequirementSchema,
  createTraceLinkSchema,
  flagRequirementSchema,
  updateRequirementSchema,
  type RequirementView,
} from "@asaa/contracts";
import type { Prisma, Requirement, TraceLink } from "@prisma/client";
import { Router } from "express";
import type { AppContext } from "../../context.js";
import { conflict, notFound, validationFailed } from "../../lib/errors.js";
import { audit } from "../audit/audit.service.js";
import { authorize } from "../auth/policy.js";
import { loadProjectAccess } from "../projects/projects.js";

type RequirementWithRelations = Requirement & {
  links: TraceLink[];
  dependsOn: { dependsOnId: string }[];
};

const include = { links: { orderBy: { createdAt: "asc" } }, dependsOn: { select: { dependsOnId: true } } } as const;

export function requirementView(requirement: RequirementWithRelations): RequirementView {
  return {
    id: requirement.id,
    projectId: requirement.projectId,
    code: requirement.code,
    kind: requirement.kind,
    title: requirement.title,
    description: requirement.description,
    priority: requirement.priority,
    status: requirement.status,
    acceptanceCriteria: requirement.acceptanceCriteria,
    flaggedForReview: requirement.flaggedForReview,
    flagReason: requirement.flagReason,
    dependencyIds: requirement.dependsOn.map((dependency) => dependency.dependsOnId),
    links: requirement.links.map((link) => ({
      id: link.id,
      kind: link.kind,
      reference: link.reference,
      title: link.title,
      evidenceStatus: link.evidenceStatus,
      createdAt: link.createdAt.toISOString(),
    })),
    missingVerification: !requirement.links.some((link) => link.kind === "TEST" && link.evidenceStatus === "PASSED"),
    version: requirement.version,
    createdAt: requirement.createdAt.toISOString(),
    updatedAt: requirement.updatedAt.toISOString(),
  };
}

/** Snapshot of the editable fields, stored as an immutable version (US-C02). */
export function snapshot(requirement: Requirement, dependencyIds: string[]): Prisma.InputJsonValue {
  return {
    kind: requirement.kind,
    title: requirement.title,
    description: requirement.description,
    priority: requirement.priority,
    status: requirement.status,
    acceptanceCriteria: requirement.acceptanceCriteria,
    flaggedForReview: requirement.flaggedForReview,
    flagReason: requirement.flagReason,
    dependencyIds,
  };
}

/**
 * Dependencies must stay inside the same project (US-I03) and must not create a
 * cycle. Returns the validated, de-duplicated list.
 */
async function validateDependencies(
  tx: Prisma.TransactionClient,
  projectId: string,
  requirementId: string | null,
  dependencyIds: string[],
): Promise<string[]> {
  const unique = [...new Set(dependencyIds)];
  if (requirementId && unique.includes(requirementId)) {
    throw validationFailed({ dependencyIds: "A requirement cannot depend on itself." });
  }
  if (!unique.length) return unique;
  const found = await tx.requirement.findMany({ where: { id: { in: unique }, projectId }, select: { id: true } });
  if (found.length !== unique.length) {
    throw validationFailed({ dependencyIds: "Dependencies must be requirements of the same project." });
  }
  if (requirementId) {
    // Walk the existing graph from the proposed dependencies; reaching this requirement means a cycle.
    const edges = await tx.requirementDependency.findMany({
      where: { requirement: { projectId } },
      select: { requirementId: true, dependsOnId: true },
    });
    const graph = new Map<string, string[]>();
    for (const edge of edges)
      graph.set(edge.requirementId, [...(graph.get(edge.requirementId) ?? []), edge.dependsOnId]);
    const stack = [...unique];
    const seen = new Set<string>();
    while (stack.length) {
      const current = stack.pop()!;
      if (current === requirementId) throw validationFailed({ dependencyIds: "This dependency would create a cycle." });
      if (seen.has(current)) continue;
      seen.add(current);
      stack.push(...(graph.get(current) ?? []));
    }
  }
  return unique;
}

export function requirementsRouter(ctx: AppContext): Router {
  const router = Router({ mergeParams: true });

  async function loadRequirement(ownerId: string, projectId: string, id: string, access: "read" | "write" = "read") {
    await loadProjectAccess(ctx, ownerId, projectId, access);
    if (!/^[0-9a-f-]{36}$/i.test(id)) throw notFound("Requirement");
    const requirement = await ctx.prisma.requirement.findFirst({ where: { id, projectId }, include });
    if (!requirement) throw notFound("Requirement");
    return requirement;
  }

  router.get("/", authorize(ctx, "requirement:read"), async (req, res, next) => {
    try {
      const projectId = String(req.params.projectId);
      await loadProjectAccess(ctx, req.owner!.id, projectId, "read");
      const requirements = await ctx.prisma.requirement.findMany({
        where: { projectId },
        include,
        orderBy: { createdAt: "asc" },
      });
      res.json({ requirements: requirements.map(requirementView) });
    } catch (error) {
      next(error);
    }
  });

  router.post("/", authorize(ctx, "requirement:write"), async (req, res, next) => {
    try {
      const projectId = String(req.params.projectId);
      const input = createRequirementSchema.parse(req.body);
      const project = await loadProjectAccess(ctx, req.owner!.id, projectId, "write");
      if (project.archivedAt) throw conflict("Restore the project before adding requirements.");
      const created = await ctx.prisma.$transaction(async (tx) => {
        const dependencyIds = await validateDependencies(tx, projectId, null, input.dependencyIds);
        const { requirementSeq } = await tx.project.update({
          where: { id: projectId },
          data: { requirementSeq: { increment: 1 } },
          select: { requirementSeq: true },
        });
        const { dependencyIds: _ignored, ...fields } = input;
        const requirement = await tx.requirement.create({
          data: {
            ...fields,
            projectId,
            code: `REQ-${requirementSeq}`,
            dependsOn: { create: dependencyIds.map((dependsOnId) => ({ dependsOnId })) },
          },
          include,
        });
        await tx.requirementVersion.create({
          data: {
            requirementId: requirement.id,
            version: 1,
            snapshot: snapshot(requirement, dependencyIds),
            changeNote: "Created",
          },
        });
        return requirement;
      });
      await audit(ctx, req, {
        action: "requirement.create",
        outcome: "SUCCESS",
        targetType: "requirement",
        targetId: created.id,
        metadata: { projectId, code: created.code },
      });
      res.status(201).json({ requirement: requirementView(created) });
    } catch (error) {
      next(error);
    }
  });

  router.get("/:id", authorize(ctx, "requirement:read"), async (req, res, next) => {
    try {
      const requirement = await loadRequirement(req.owner!.id, String(req.params.projectId), String(req.params.id), "read");
      const versions = await ctx.prisma.requirementVersion.findMany({
        where: { requirementId: requirement.id },
        orderBy: { version: "desc" },
      });
      res.json({
        requirement: requirementView(requirement),
        versions: versions.map((version) => ({
          version: version.version,
          changedAt: version.changedAt.toISOString(),
          changeNote: version.changeNote,
          snapshot: version.snapshot,
        })),
      });
    } catch (error) {
      next(error);
    }
  });

  router.patch("/:id", authorize(ctx, "requirement:write"), async (req, res, next) => {
    try {
      const projectId = String(req.params.projectId);
      const { expectedVersion, changeNote, dependencyIds, ...changes } = updateRequirementSchema.parse(req.body);
      const current = await loadRequirement(req.owner!.id, projectId, String(req.params.id), "write");
      const updated = await ctx.prisma.$transaction(async (tx) => {
        const result = await tx.requirement.updateMany({
          where: { id: current.id, version: expectedVersion },
          data: { ...changes, version: { increment: 1 } },
        });
        if (result.count === 0) throw conflict("This requirement was changed elsewhere. Reload and try again.");
        let deps = current.dependsOn.map((dependency) => dependency.dependsOnId);
        if (dependencyIds) {
          deps = await validateDependencies(tx, projectId, current.id, dependencyIds);
          await tx.requirementDependency.deleteMany({ where: { requirementId: current.id } });
          await tx.requirementDependency.createMany({
            data: deps.map((dependsOnId) => ({ requirementId: current.id, dependsOnId })),
          });
        }
        const requirement = await tx.requirement.findUniqueOrThrow({ where: { id: current.id }, include });
        await tx.requirementVersion.create({
          data: {
            requirementId: current.id,
            version: requirement.version,
            snapshot: snapshot(requirement, deps),
            changeNote: changeNote || null,
          },
        });
        return requirement;
      });
      await audit(ctx, req, {
        action: "requirement.update",
        outcome: "SUCCESS",
        targetType: "requirement",
        targetId: current.id,
        metadata: {
          projectId,
          version: updated.version,
          fields: [...Object.keys(changes), ...(dependencyIds ? ["dependencyIds"] : [])],
        },
      });
      res.json({ requirement: requirementView(updated) });
    } catch (error) {
      next(error);
    }
  });

  router.post("/:id/flag", authorize(ctx, "requirement:write"), async (req, res, next) => {
    try {
      const input = flagRequirementSchema.parse(req.body);
      if (input.flagged && !input.reason) throw validationFailed({ reason: "Explain what needs review." });
      const current = await loadRequirement(req.owner!.id, String(req.params.projectId), String(req.params.id), "write");
      const requirement = await ctx.prisma.requirement.update({
        where: { id: current.id },
        data: { flaggedForReview: input.flagged, flagReason: input.flagged ? input.reason! : null },
        include,
      });
      await audit(ctx, req, {
        action: input.flagged ? "requirement.flag" : "requirement.unflag",
        outcome: "SUCCESS",
        targetType: "requirement",
        targetId: current.id,
      });
      res.json({ requirement: requirementView(requirement) });
    } catch (error) {
      next(error);
    }
  });

  router.post("/:id/links", authorize(ctx, "requirement:write"), async (req, res, next) => {
    try {
      const input = createTraceLinkSchema.parse(req.body);
      const current = await loadRequirement(req.owner!.id, String(req.params.projectId), String(req.params.id));
      if (current.links.length >= 100) throw conflict("A requirement can have at most 100 trace links.");
      await ctx.prisma.traceLink.create({ data: { ...input, title: input.title || null, requirementId: current.id } });
      const requirement = await ctx.prisma.requirement.findUniqueOrThrow({ where: { id: current.id }, include });
      await audit(ctx, req, {
        action: "requirement.link.add",
        outcome: "SUCCESS",
        targetType: "requirement",
        targetId: current.id,
        metadata: { kind: input.kind, evidenceStatus: input.evidenceStatus },
      });
      res.status(201).json({ requirement: requirementView(requirement) });
    } catch (error) {
      next(error);
    }
  });

  router.delete("/:id/links/:linkId", authorize(ctx, "requirement:write"), async (req, res, next) => {
    try {
      const current = await loadRequirement(req.owner!.id, String(req.params.projectId), String(req.params.id));
      const linkId = String(req.params.linkId);
      if (!/^[0-9a-f-]{36}$/i.test(linkId)) throw notFound("Trace link");
      const result = await ctx.prisma.traceLink.deleteMany({ where: { id: linkId, requirementId: current.id } });
      if (result.count === 0) throw notFound("Trace link");
      await audit(ctx, req, {
        action: "requirement.link.remove",
        outcome: "SUCCESS",
        targetType: "requirement",
        targetId: current.id,
      });
      const requirement = await ctx.prisma.requirement.findUniqueOrThrow({ where: { id: current.id }, include });
      res.json({ requirement: requirementView(requirement) });
    } catch (error) {
      next(error);
    }
  });

  return router;
}
