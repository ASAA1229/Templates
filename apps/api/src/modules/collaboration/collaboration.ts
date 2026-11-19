import type { ProjectComment } from "@prisma/client";
import { Router, type NextFunction, type Request, type Response } from "express";
import { z } from "zod";
import type { AppContext } from "../../context.js";
import { conflict, forbidden, notFound, validationFailed } from "../../lib/errors.js";
import { audit } from "../audit/audit.service.js";
import { authorize } from "../auth/policy.js";
import { loadProjectAccess, requireProjectAccess } from "../projects/projects.js";

/**
 * Project collaboration: threaded comments on the project, a template version or a workspace file, and
 * heartbeat-based presence. Authorization follows project membership: the project owner and EDITORs can write,
 * VIEWERs can read and comment, and everyone else gets 404. Edit and delete are author-only; resolving a thread
 * needs write access or authorship. Mentions are limited to the project's own members.
 */
const PRESENCE_TTL_MS = 60_000;
const EMAIL_MENTION = /(?<![\w.@])@([A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,})/g;

const targetSchema = z
  .object({
    targetType: z.enum(["PROJECT", "TEMPLATE", "FILE"]),
    targetRef: z.string().trim().max(300).default(""),
  })
  .superRefine((value, ctx) => {
    if (value.targetType === "PROJECT" && value.targetRef !== "")
      ctx.addIssue({ code: "custom", path: ["targetRef"], message: "A project comment has no target reference." });
    if (value.targetType !== "PROJECT" && value.targetRef === "")
      ctx.addIssue({ code: "custom", path: ["targetRef"], message: "Choose what the comment is about." });
    if (value.targetType === "FILE" && /(^|\/)\.\.(\/|$)|^\/|\\|\0/.test(value.targetRef))
      ctx.addIssue({ code: "custom", path: ["targetRef"], message: "Use a path relative to the project folder." });
    if (value.targetType === "TEMPLATE" && !/^[a-z0-9][a-z0-9-]*@\d+\.\d+\.\d+[0-9A-Za-z.+-]*$/.test(value.targetRef))
      ctx.addIssue({ code: "custom", path: ["targetRef"], message: "Use the form template-id@1.0.0." });
  });

const bodySchema = z.string().trim().min(1, "Write a comment.").max(4000, "Keep comments under 4000 characters.");
const createSchema = z.object({
  targetType: z.enum(["PROJECT", "TEMPLATE", "FILE"]),
  targetRef: z.string().default(""),
  body: bodySchema,
  parentId: z.string().uuid().optional(),
});
const editSchema = z.object({ body: bodySchema });
const resolveSchema = z.object({ resolved: z.boolean() });
const presenceSchema = z.object({
  filePath: z.string().trim().max(400).default(""),
  mode: z.enum(["VIEWING", "EDITING"]).default("VIEWING"),
});

function parse<T>(schema: z.ZodType<T>, raw: unknown): T {
  const result = schema.safeParse(raw);
  if (!result.success) {
    const fields: Record<string, string> = {};
    for (const issue of result.error.issues) fields[String(issue.path[0] ?? "body")] ??= issue.message;
    throw validationFailed(fields);
  }
  return result.data;
}

export function collaborationRouter(ctx: AppContext): Router {
  const router = Router({ mergeParams: true });
  const projectId = (req: Request) => String(req.params.projectId);
  const read = [authorize(ctx, "project:read"), requireProjectAccess(ctx, "read")] as const;
  const wrap =
    (run: (req: Request, res: Response) => Promise<unknown>, status = 200) =>
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const body = await run(req, res);
        if (status === 204) res.status(204).end();
        else res.status(status).json(body);
      } catch (error) {
        next(error);
      }
    };

  function view(comment: ProjectComment, names: Map<string, string>) {
    return {
      id: comment.id,
      targetType: comment.targetType,
      targetRef: comment.targetRef,
      parentId: comment.parentId,
      authorId: comment.authorId,
      authorName: names.get(comment.authorId) ?? "Former member",
      body: comment.deletedAt ? "" : comment.body,
      deleted: Boolean(comment.deletedAt),
      mentions: comment.deletedAt ? [] : comment.mentions,
      createdAt: comment.createdAt.toISOString(),
      editedAt: comment.editedAt?.toISOString() ?? null,
      resolved: Boolean(comment.resolvedAt),
      resolvedAt: comment.resolvedAt?.toISOString() ?? null,
      resolvedById: comment.resolvedById,
    };
  }

  /** Display names for the project owner and members (nobody outside the project is ever resolved). */
  async function people(id: string) {
    const project = await ctx.prisma.project.findUniqueOrThrow({
      where: { id },
      select: {
        owner: { select: { id: true, email: true, displayName: true, isActive: true } },
        members: { select: { member: { select: { id: true, email: true, displayName: true, isActive: true } } } },
      },
    });
    const all = [project.owner, ...project.members.map((entry) => entry.member)];
    return {
      names: new Map(all.map((person) => [person.id, person.displayName])),
      byEmail: new Map(all.filter((p) => p.isActive).map((person) => [person.email.toLowerCase(), person.id])),
    };
  }

  function mentionsIn(body: string, byEmail: Map<string, string>): string[] {
    const found = new Set<string>();
    for (const match of body.matchAll(EMAIL_MENTION)) {
      const member = byEmail.get(match[1]!.toLowerCase());
      if (!member) throw validationFailed({ body: "You can only mention members of this project." });
      found.add(member);
    }
    return [...found];
  }

  /** Read access is already proven here, so a failed write check is a permission problem, not a hidden project. */
  async function requireWrite(req: Request) {
    try {
      await loadProjectAccess(ctx, req.owner!.id, projectId(req), "write");
    } catch {
      throw forbidden();
    }
  }

  async function loadComment(req: Request, id: string) {
    if (!/^[0-9a-f-]{36}$/i.test(id)) throw notFound("Comment");
    const comment = await ctx.prisma.projectComment.findFirst({ where: { id, projectId: projectId(req) } });
    if (!comment) throw notFound("Comment");
    return comment;
  }

  router.get(
    "/comments",
    ...read,
    wrap(async (req) => {
      const target = parse(targetSchema, {
        targetType: req.query.targetType ?? "PROJECT",
        targetRef: typeof req.query.targetRef === "string" ? req.query.targetRef : "",
      });
      const includeResolved = req.query.includeResolved === "true";
      const rows = await ctx.prisma.projectComment.findMany({
        where: { projectId: projectId(req), ...target },
        orderBy: { createdAt: "asc" },
        take: 500,
      });
      const { names } = await people(projectId(req));
      // A resolved thread (root resolved) is hidden unless asked for.
      const hidden = new Set(
        includeResolved ? [] : rows.filter((row) => !row.parentId && row.resolvedAt).map((row) => row.id),
      );
      const visible = rows.filter((row) => !hidden.has(row.id) && !(row.parentId && hidden.has(row.parentId)));
      return { comments: visible.map((row) => view(row, names)) };
    }),
  );

  router.post(
    "/comments",
    ...read,
    wrap(async (req) => {
      const input = parse(createSchema, req.body);
      const target = parse(targetSchema, { targetType: input.targetType, targetRef: input.targetRef });
      const project = await loadProjectAccess(ctx, req.owner!.id, projectId(req), "read");
      if (project.archivedAt) throw conflict("Restore the project before commenting.");
      let parent: ProjectComment | null = null;
      if (input.parentId) {
        parent = await loadComment(req, input.parentId);
        if (parent.parentId) throw validationFailed({ parentId: "Reply to the first comment of a thread." });
        if (parent.targetType !== target.targetType || parent.targetRef !== target.targetRef)
          throw validationFailed({ parentId: "A reply must be about the same thing as its thread." });
        if (parent.deletedAt) throw conflict("That comment was deleted.");
      }
      const { names, byEmail } = await people(project.id);
      const mentions = mentionsIn(input.body, byEmail);
      const created = await ctx.prisma.projectComment.create({
        data: {
          projectId: project.id,
          ...target,
          parentId: parent?.id ?? null,
          authorId: req.owner!.id,
          body: input.body,
          mentions,
        },
      });
      await audit(ctx, req, {
        action: "comment.create",
        outcome: "SUCCESS",
        targetType: "project",
        targetId: project.id,
        metadata: {
          commentId: created.id,
          target: target.targetType,
          reply: Boolean(parent),
          mentions: mentions.length,
        },
      });
      return { comment: view(created, names) };
    }, 201),
  );

  router.patch(
    "/comments/:commentId",
    ...read,
    wrap(async (req) => {
      const comment = await loadComment(req, String(req.params.commentId));
      if (comment.authorId !== req.owner!.id) throw forbidden();
      if (comment.deletedAt) throw conflict("That comment was deleted.");
      const { body } = parse(editSchema, req.body);
      const { names, byEmail } = await people(projectId(req));
      const updated = await ctx.prisma.projectComment.update({
        where: { id: comment.id },
        data: { body, mentions: mentionsIn(body, byEmail), editedAt: ctx.now() },
      });
      await audit(ctx, req, {
        action: "comment.edit",
        outcome: "SUCCESS",
        targetType: "project",
        targetId: projectId(req),
        metadata: { commentId: comment.id },
      });
      return { comment: view(updated, names) };
    }),
  );

  router.delete(
    "/comments/:commentId",
    ...read,
    wrap(async (req) => {
      const comment = await loadComment(req, String(req.params.commentId));
      if (comment.authorId !== req.owner!.id) throw forbidden();
      if (!comment.deletedAt) {
        await ctx.prisma.projectComment.update({ where: { id: comment.id }, data: { deletedAt: ctx.now() } });
        await audit(ctx, req, {
          action: "comment.delete",
          outcome: "SUCCESS",
          targetType: "project",
          targetId: projectId(req),
          metadata: { commentId: comment.id },
        });
      }
      return null;
    }, 204),
  );

  router.post(
    "/comments/:commentId/resolve",
    ...read,
    wrap(async (req) => {
      const comment = await loadComment(req, String(req.params.commentId));
      if (comment.parentId) throw validationFailed({ commentId: "Resolve the first comment of a thread." });
      const { resolved } = parse(resolveSchema, req.body);
      // Anyone but the author needs write access (project owner or EDITOR).
      if (comment.authorId !== req.owner!.id) await requireWrite(req);
      const updated = await ctx.prisma.projectComment.update({
        where: { id: comment.id },
        data: resolved
          ? { resolvedAt: ctx.now(), resolvedById: req.owner!.id }
          : { resolvedAt: null, resolvedById: null },
      });
      await audit(ctx, req, {
        action: resolved ? "comment.resolve" : "comment.reopen",
        outcome: "SUCCESS",
        targetType: "project",
        targetId: projectId(req),
        metadata: { commentId: comment.id },
      });
      const { names } = await people(projectId(req));
      return { comment: view(updated, names) };
    }),
  );

  router.post(
    "/presence",
    ...read,
    wrap(async (req) => {
      const input = parse(presenceSchema, req.body);
      if (input.filePath) parse(targetSchema, { targetType: "FILE", targetRef: input.filePath });
      // EDITING is only claimed by someone who could actually save the file.
      if (input.mode === "EDITING") await requireWrite(req);
      const now = ctx.now();
      await ctx.prisma.projectPresence.upsert({
        where: { projectId_memberId: { projectId: projectId(req), memberId: req.owner!.id } },
        create: {
          projectId: projectId(req),
          memberId: req.owner!.id,
          filePath: input.filePath,
          mode: input.mode,
          seenAt: now,
        },
        update: { filePath: input.filePath, mode: input.mode, seenAt: now },
      });
      await ctx.prisma.projectPresence.deleteMany({
        where: { projectId: projectId(req), seenAt: { lt: new Date(now.getTime() - 10 * PRESENCE_TTL_MS) } },
      });
      return { ok: true };
    }),
  );

  router.get(
    "/presence",
    ...read,
    wrap(async (req) => {
      const filePath = typeof req.query.filePath === "string" ? req.query.filePath : undefined;
      const since = new Date(ctx.now().getTime() - PRESENCE_TTL_MS);
      const rows = await ctx.prisma.projectPresence.findMany({
        where: { projectId: projectId(req), seenAt: { gte: since }, ...(filePath === undefined ? {} : { filePath }) },
        orderBy: { seenAt: "desc" },
        take: 50,
      });
      const { names } = await people(projectId(req));
      return {
        ttlSeconds: PRESENCE_TTL_MS / 1000,
        presence: rows.map((row) => ({
          memberId: row.memberId,
          name: names.get(row.memberId) ?? "Member",
          you: row.memberId === req.owner!.id,
          filePath: row.filePath,
          mode: row.mode,
          seenAt: row.seenAt.toISOString(),
        })),
      };
    }),
  );

  return router;
}
