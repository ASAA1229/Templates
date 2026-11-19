import {
  auditQuerySchema,
  PROJECT_STATUSES,
  REQUIREMENT_STATUSES,
  type AuditEventView,
  type DashboardView,
} from "@asaa/contracts";
import type { AuditEvent, Prisma } from "@prisma/client";
import { Router } from "express";
import type { AppContext } from "../../context.js";
import { authorize } from "../auth/policy.js";

export function auditView(event: AuditEvent): AuditEventView {
  return {
    id: event.id.toString(),
    at: event.at.toISOString(),
    actorType: event.actorType,
    action: event.action,
    targetType: event.targetType,
    targetId: event.targetId,
    outcome: event.outcome,
    metadata: (event.metadata ?? {}) as Record<string, unknown>,
  };
}

/** Owner dashboard (US-B01) and audit log reader (US-I02). */
export function dashboardRouter(ctx: AppContext): Router {
  const router = Router();

  router.get("/dashboard", authorize(ctx, "dashboard:read"), async (req, res, next) => {
    try {
      const ownerId = req.owner!.id;
      const projectScope = {
        project: { archivedAt: null, OR: [{ ownerId }, { members: { some: { memberId: ownerId } } }] },
      };
      const accessibleProjects = await ctx.prisma.project.findMany({
        where: { OR: [{ ownerId }, { members: { some: { memberId: ownerId } } }] },
        select: { id: true },
      });
      const accessibleProjectIds = accessibleProjects.map((project) => project.id);
      const [
        projectGroups,
        archived,
        requirementGroups,
        flagged,
        missing,
        catalogTotal,
        untrusted,
        recent,
        flaggedSample,
        missingSample,
      ] = await Promise.all([
        ctx.prisma.project.groupBy({
          by: ["status"],
          where: { archivedAt: null, OR: [{ ownerId }, { members: { some: { memberId: ownerId } } }] },
          _count: true,
        }),
        ctx.prisma.project.count({ where: { ownerId, archivedAt: { not: null } } }),
        ctx.prisma.requirement.groupBy({ by: ["status"], where: projectScope, _count: true }),
        ctx.prisma.requirement.count({ where: { ...projectScope, flaggedForReview: true } }),
        ctx.prisma.requirement.count({
          where: {
            ...projectScope,
            status: { in: ["DEVELOPED", "BUILT", "TESTED", "RELEASED"] },
            links: { none: { kind: "TEST", evidenceStatus: "PASSED" } },
          },
        }),
        ctx.prisma.catalogItem.count(),
        ctx.prisma.catalogItem.count({ where: { trustStatus: { not: "TRUSTED" } } }),
        ctx.prisma.auditEvent.findMany({
          where: { OR: [{ actorId: ownerId }, { targetType: "project", targetId: { in: accessibleProjectIds } }] },
          orderBy: { id: "desc" },
          take: 10,
        }),
        ctx.prisma.requirement.findMany({
          where: { ...projectScope, flaggedForReview: true },
          take: 5,
          select: { code: true, title: true, projectId: true },
        }),
        ctx.prisma.requirement.findMany({
          where: {
            ...projectScope,
            status: { in: ["DEVELOPED", "BUILT", "TESTED", "RELEASED"] },
            links: { none: { kind: "TEST", evidenceStatus: "PASSED" } },
          },
          take: 5,
          select: { code: true, title: true, projectId: true, status: true },
        }),
      ]);

      const byStatus = Object.fromEntries(
        PROJECT_STATUSES.map((status) => [status, 0]),
      ) as DashboardView["projects"]["byStatus"];
      for (const group of projectGroups) byStatus[group.status] = group._count;
      const requirementsByStatus = Object.fromEntries(
        REQUIREMENT_STATUSES.map((status) => [status, 0]),
      ) as DashboardView["requirements"]["byStatus"];
      for (const group of requirementGroups) requirementsByStatus[group.status] = group._count;

      const view: DashboardView = {
        projects: { total: projectGroups.reduce((sum, group) => sum + group._count, 0), byStatus, archived },
        requirements: {
          total: requirementGroups.reduce((sum, group) => sum + group._count, 0),
          flaggedForReview: flagged,
          missingVerification: missing,
          byStatus: requirementsByStatus,
        },
        catalog: { total: catalogTotal, untrusted },
        alerts: [
          ...flaggedSample.map((item) => ({
            kind: "FLAGGED" as const,
            message: `${item.code} “${item.title}” is flagged for review.`,
            href: `/projects/${item.projectId}`,
          })),
          ...missingSample.map((item) => ({
            kind: "MISSING_VERIFICATION" as const,
            message: `${item.code} is ${item.status.toLowerCase().replace("_", " ")} but has no passing test evidence.`,
            href: `/projects/${item.projectId}`,
          })),
          ...(untrusted
            ? [
                {
                  kind: "UNTRUSTED_IMPORT" as const,
                  message: `${untrusted} catalog item(s) await source review.`,
                  href: "/catalog",
                },
              ]
            : []),
        ],
        recentActivity: recent.map(auditView),
      };
      res.json(view);
    } catch (error) {
      next(error);
    }
  });

  router.get("/audit", authorize(ctx, "audit:read"), async (req, res, next) => {
    try {
      const query = auditQuerySchema.parse(req.query);
      const where: Prisma.AuditEventWhereInput = {
        ...(query.action ? { action: { startsWith: query.action } } : {}),
        ...(query.outcome ? { outcome: query.outcome } : {}),
        ...(query.before ? { id: { lt: BigInt(query.before) } } : {}),
      };
      const events = await ctx.prisma.auditEvent.findMany({ where, orderBy: { id: "desc" }, take: query.limit + 1 });
      const page = events.slice(0, query.limit);
      res.json({
        events: page.map(auditView),
        nextBefore: events.length > query.limit ? page[page.length - 1]!.id.toString() : null,
      });
    } catch (error) {
      next(error);
    }
  });

  return router;
}
