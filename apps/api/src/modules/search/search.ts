import { Router } from "express";
import type { AppContext } from "../../context.js";
import { authorize } from "../auth/policy.js";

/** Permission-aware cross-module discovery (US-O01, US-O02). */
export function searchRouter(ctx: AppContext): Router {
  const router = Router();

  router.get(
    "/",
    authorize(ctx, "project:read"),
    authorize(ctx, "requirement:read"),
    authorize(ctx, "catalog:read"),
    async (req, res, next) => {
      try {
        const query = typeof req.query.q === "string" ? req.query.q.trim() : "";
        if (query.length < 2 || query.length > 80) {
          res.status(400).json({
            error: {
              code: "VALIDATION_FAILED",
              message: "Search text must contain between 2 and 80 characters.",
              fields: { q: "Enter between 2 and 80 characters." },
            },
          });
          return;
        }

        const [projects, requirements, catalog] = await Promise.all([
          ctx.prisma.project.findMany({
            where: {
              ownerId: req.owner!.id,
              archivedAt: null,
              OR: [
                { name: { contains: query, mode: "insensitive" } },
                { key: { contains: query, mode: "insensitive" } },
                { purpose: { contains: query, mode: "insensitive" } },
              ],
            },
            select: { id: true, key: true, name: true, status: true },
            orderBy: { updatedAt: "desc" },
            take: 5,
          }),
          ctx.prisma.requirement.findMany({
            where: {
              project: { ownerId: req.owner!.id, archivedAt: null },
              OR: [
                { title: { contains: query, mode: "insensitive" } },
                { code: { contains: query, mode: "insensitive" } },
                { description: { contains: query, mode: "insensitive" } },
              ],
            },
            select: { id: true, code: true, title: true, projectId: true, project: { select: { key: true } } },
            orderBy: { updatedAt: "desc" },
            take: 5,
          }),
          ctx.prisma.catalogItem.findMany({
            where: {
              OR: [
                { title: { contains: query, mode: "insensitive" } },
                { slug: { contains: query, mode: "insensitive" } },
                { description: { contains: query, mode: "insensitive" } },
              ],
            },
            select: { id: true, slug: true, title: true, category: true, lifecycle: true },
            orderBy: { updatedAt: "desc" },
            take: 5,
          }),
        ]);

        res.json({
          query,
          results: [
            ...projects.map((item) => ({
              id: item.id,
              type: "PROJECT" as const,
              title: item.name,
              subtitle: `${item.key} · ${item.status.toLowerCase().replace("_", " ")}`,
              href: `/projects/${item.id}`,
            })),
            ...requirements.map((item) => ({
              id: item.id,
              type: "REQUIREMENT" as const,
              title: item.title,
              subtitle: `${item.project.key} · ${item.code}`,
              href: `/projects/${item.projectId}`,
            })),
            ...catalog.map((item) => ({
              id: item.id,
              type: "CATALOG" as const,
              title: item.title,
              subtitle: `${item.category} · ${item.lifecycle.toLowerCase()}`,
              href: "/catalog",
            })),
          ],
        });
      } catch (error) {
        next(error);
      }
    },
  );

  return router;
}
