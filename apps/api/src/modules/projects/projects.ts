import { createProjectSchema, projectListQuerySchema, updateProjectSchema, type ProjectView } from "@asaa/contracts";
import type { Prisma, Project } from "@prisma/client";
import { Router } from "express";
import type { AppContext } from "../../context.js";
import { conflict, notFound } from "../../lib/errors.js";
import { audit } from "../audit/audit.service.js";
import { authorize } from "../auth/policy.js";

export function projectView(project: Project & { _count?: { requirements: number } }): ProjectView {
  return {
    id: project.id,
    key: project.key,
    name: project.name,
    purpose: project.purpose,
    status: project.status,
    ownerId: project.ownerId,
    archivedAt: project.archivedAt?.toISOString() ?? null,
    createdAt: project.createdAt.toISOString(),
    updatedAt: project.updatedAt.toISOString(),
    version: project.version,
    ...(project._count ? { requirementCount: project._count.requirements } : {}),
  };
}

/** Load a project the current owner may access (project boundary, US-I03). */
export async function loadOwnedProject(ctx: AppContext, ownerId: string, id: string): Promise<Project> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw notFound("Project");
  const project = await ctx.prisma.project.findFirst({ where: { id, ownerId } });
  if (!project) throw notFound("Project");
  return project;
}

export function projectsRouter(ctx: AppContext): Router {
  const router = Router();

  router.get("/", authorize(ctx, "project:read"), async (req, res, next) => {
    try {
      const query = projectListQuerySchema.parse(req.query);
      const where: Prisma.ProjectWhereInput = {
        ownerId: req.owner!.id,
        ...(query.status ? { status: query.status } : {}),
        ...(query.archived === "exclude"
          ? { archivedAt: null }
          : query.archived === "only"
            ? { archivedAt: { not: null } }
            : {}),
        ...(query.q
          ? {
              OR: [
                { name: { contains: query.q, mode: "insensitive" } },
                { key: { contains: query.q, mode: "insensitive" } },
                { purpose: { contains: query.q, mode: "insensitive" } },
              ],
            }
          : {}),
      };
      const projects = await ctx.prisma.project.findMany({
        where,
        orderBy: { updatedAt: "desc" },
        take: 200,
        include: { _count: { select: { requirements: true } } },
      });
      res.json({ projects: projects.map(projectView) });
    } catch (error) {
      next(error);
    }
  });

  router.post("/", authorize(ctx, "project:write"), async (req, res, next) => {
    try {
      const input = createProjectSchema.parse(req.body);
      const project = await ctx.prisma.project.create({ data: { ...input, ownerId: req.owner!.id } });
      await audit(ctx, req, {
        action: "project.create",
        outcome: "SUCCESS",
        targetType: "project",
        targetId: project.id,
        metadata: { key: project.key },
      });
      res.status(201).json({ project: projectView(project) });
    } catch (error) {
      next(error);
    }
  });

  router.get("/:id", authorize(ctx, "project:read"), async (req, res, next) => {
    try {
      const project = await loadOwnedProject(ctx, req.owner!.id, String(req.params.id));
      const history = await ctx.prisma.auditEvent.findMany({
        where: { targetType: "project", targetId: project.id },
        orderBy: { id: "desc" },
        take: 50,
      });
      res.json({
        project: projectView(project),
        history: history.map((event) => ({
          id: event.id.toString(),
          at: event.at.toISOString(),
          action: event.action,
          outcome: event.outcome,
          metadata: event.metadata,
        })),
      });
    } catch (error) {
      next(error);
    }
  });

  router.patch("/:id", authorize(ctx, "project:write"), async (req, res, next) => {
    try {
      const { expectedVersion, ...changes } = updateProjectSchema.parse(req.body);
      const project = await loadOwnedProject(ctx, req.owner!.id, String(req.params.id));
      if (project.archivedAt) throw conflict("Restore the project before editing it.");
      const result = await ctx.prisma.project.updateMany({
        where: { id: project.id, version: expectedVersion },
        data: { ...changes, version: { increment: 1 } },
      });
      if (result.count === 0) throw conflict("This project was changed elsewhere. Reload and try again.");
      const updated = await ctx.prisma.project.findUniqueOrThrow({ where: { id: project.id } });
      const changed = Object.fromEntries(
        Object.entries(changes).filter(
          ([key, value]) => value !== undefined && project[key as keyof Project] !== value,
        ),
      );
      await audit(ctx, req, {
        action: "project.update",
        outcome: "SUCCESS",
        targetType: "project",
        targetId: project.id,
        metadata: {
          changed: Object.keys(changed),
          before: Object.fromEntries(Object.keys(changed).map((key) => [key, project[key as keyof Project]])),
          after: changed,
        },
      });
      res.json({ project: projectView(updated) });
    } catch (error) {
      next(error);
    }
  });

  for (const action of ["archive", "restore"] as const) {
    router.post(`/:id/${action}`, authorize(ctx, "project:write"), async (req, res, next) => {
      try {
        const project = await loadOwnedProject(ctx, req.owner!.id, String(req.params.id));
        if ((action === "archive") === Boolean(project.archivedAt)) {
          throw conflict(action === "archive" ? "Project is already archived." : "Project is not archived.");
        }
        const updated = await ctx.prisma.project.update({
          where: { id: project.id },
          data: { archivedAt: action === "archive" ? ctx.now() : null, version: { increment: 1 } },
        });
        await audit(ctx, req, {
          action: `project.${action}`,
          outcome: "SUCCESS",
          targetType: "project",
          targetId: project.id,
        });
        res.json({ project: projectView(updated) });
      } catch (error) {
        next(error);
      }
    });
  }

  return router;
}
