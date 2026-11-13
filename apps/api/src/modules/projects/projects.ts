import {
  createProjectSchema,
  projectListQuerySchema,
  updateProjectSchema,
  type ProjectBlueprint,
  type ProjectView,
} from "@asaa/contracts";
import type { Prisma, Project } from "@prisma/client";
import { Router } from "express";
import { z } from "zod";
import type { AppContext } from "../../context.js";
import { conflict, notFound } from "../../lib/errors.js";
import { audit } from "../audit/audit.service.js";
import { authorize } from "../auth/policy.js";

export function projectView(project: Project & { _count?: { requirements: number } }): ProjectView {
  return {
    id: project.id,
    key: project.key,
    blueprint: project.blueprint ? (project.blueprint as ProjectBlueprint) : null,
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


/** Resolve project membership with an explicit read/write boundary. */
export async function loadProjectAccess(
  ctx: AppContext,
  actorId: string,
  id: string,
  access: "read" | "write" = "read",
): Promise<Project> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw notFound("Project");
  const project = await ctx.prisma.project.findFirst({
    where: {
      id,
      OR: [
        { ownerId: actorId },
        { members: { some: { memberId: actorId, ...(access === "write" ? { role: "EDITOR" } : {}) } } },
      ],
    },
  });
  if (!project) throw notFound("Project");
  return project;
}

export function projectsRouter(ctx: AppContext): Router {
  const router = Router();

  router.get("/", authorize(ctx, "project:read"), async (req, res, next) => {
    try {
      const query = projectListQuerySchema.parse(req.query);
      const where: Prisma.ProjectWhereInput = {
        AND: [
          { OR: [{ ownerId: req.owner!.id }, { members: { some: { memberId: req.owner!.id } } }] },
          ...(query.q ? [{ OR: [
            { name: { contains: query.q, mode: "insensitive" as const } },
            { key: { contains: query.q, mode: "insensitive" as const } },
            { purpose: { contains: query.q, mode: "insensitive" as const } },
          ] }] : []),
        ],
        ...(query.status ? { status: query.status } : {}),
        ...(query.archived === "exclude"
          ? { archivedAt: null }
          : query.archived === "only"
            ? { archivedAt: { not: null } }
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
      const project = await loadProjectAccess(ctx, req.owner!.id, String(req.params.id), "read");
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
      const project = await loadProjectAccess(ctx, req.owner!.id, String(req.params.id), "write");
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
        const project = await loadProjectAccess(ctx, req.owner!.id, String(req.params.id), "write");
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


  // Project sharing is controlled only by the project owner; shared members cannot re-share.
  router.get("/:id/members", authorize(ctx, "project:write"), async (req, res, next) => {
    try {
      const project = await loadOwnedProject(ctx, req.owner!.id, String(req.params.id));
      const members = await ctx.prisma.projectMember.findMany({
        where: { projectId: project.id },
        include: { member: { select: { id: true, email: true, displayName: true, role: true, isActive: true } } },
        orderBy: { createdAt: "asc" },
      });
      res.json({ members: members.map(({ id, role, createdAt, member }) => ({ id, role, createdAt: createdAt.toISOString(), member })) });
    } catch (error) { next(error); }
  });

  router.post("/:id/members", authorize(ctx, "project:write"), async (req, res, next) => {
    try {
      const project = await loadOwnedProject(ctx, req.owner!.id, String(req.params.id));
      const input = z.object({
        email: z.string().trim().toLowerCase().email().max(254),
        role: z.enum(["VIEWER", "EDITOR"]).default("VIEWER"),
      }).parse(req.body);
      const member = await ctx.prisma.owner.findUnique({ where: { email: input.email }, select: { id: true, email: true, displayName: true, role: true, isActive: true } });
      if (!member || !member.isActive) throw notFound("Active team member");
      if (member.id === project.ownerId) throw conflict("The project owner already has full access.");
      const sharing = await ctx.prisma.projectMember.upsert({
        where: { projectId_memberId: { projectId: project.id, memberId: member.id } },
        create: { projectId: project.id, memberId: member.id, role: input.role },
        update: { role: input.role },
      });
      await audit(ctx, req, { action: "project.member.upsert", outcome: "SUCCESS", targetType: "project", targetId: project.id, metadata: { memberId: member.id, role: input.role } });
      res.status(200).json({ membership: { id: sharing.id, role: sharing.role, member } });
    } catch (error) { next(error); }
  });

  router.delete("/:id/members/:memberId", authorize(ctx, "project:write"), async (req, res, next) => {
    try {
      const project = await loadOwnedProject(ctx, req.owner!.id, String(req.params.id));
      const memberId = String(req.params.memberId);
      const removed = await ctx.prisma.projectMember.deleteMany({ where: { projectId: project.id, memberId } });
      if (!removed.count) throw notFound("Project member");
      await audit(ctx, req, { action: "project.member.remove", outcome: "SUCCESS", targetType: "project", targetId: project.id, metadata: { memberId } });
      res.status(204).end();
    } catch (error) { next(error); }
  });

  return router;
}
