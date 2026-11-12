import { Router, type Response } from "express";
import { z } from "zod";
import type { AppContext } from "../../context.js";
import { authorize } from "../auth/policy.js";

const SEARCH_TYPES = ["PROJECT", "REQUIREMENT", "CATALOG"] as const;
const PROJECT_STATUSES = ["PLANNING", "ACTIVE", "ON_HOLD", "COMPLETED"] as const;
const REQUIREMENT_STATUSES = ["DRAFT", "READY", "IN_DEVELOPMENT", "DEVELOPED", "BUILT", "TESTED", "RELEASED"] as const;

const searchFiltersSchema = z
  .object({
    types: z.array(z.enum(SEARCH_TYPES)).min(1).max(3).default([...SEARCH_TYPES]),
    projectStatus: z.enum(PROJECT_STATUSES).optional(),
    requirementStatus: z.enum(REQUIREMENT_STATUSES).optional(),
    catalogCategory: z.string().trim().max(80).optional(),
    sortBy: z.enum(["updatedAt", "title"]).default("updatedAt"),
    sortOrder: z.enum(["asc", "desc"]).default("desc"),
    pageSize: z.coerce.number().int().min(1).max(50).default(10),
  })
  .strict();

const savedSearchInputSchema = z
  .object({
    name: z.string().trim().min(1).max(100),
    query: z.string().trim().min(2).max(80),
    filters: searchFiltersSchema.default({}),
  })
  .strict();

function queryString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function invalid(res: Response, message: string) {
  res.status(400).json({
    error: { code: "VALIDATION_FAILED", message, fields: {} },
  });
}

/** Permission-aware cross-module discovery and owner-scoped saved queries (US-O01, US-O02). */
export function searchRouter(ctx: AppContext): Router {
  const router = Router();

  router.get(
    "/",
    authorize(ctx, "project:read"),
    authorize(ctx, "requirement:read"),
    authorize(ctx, "catalog:read"),
    async (req, res, next) => {
      try {
        const query = queryString(req.query.q)?.trim() ?? "";
        if (query.length < 2 || query.length > 80) {
          invalid(res, "Search text must contain between 2 and 80 characters.");
          return;
        }

        const rawTypes = req.query.types;
        const types =
          rawTypes === undefined
            ? [...SEARCH_TYPES]
            : (Array.isArray(rawTypes) ? rawTypes : String(rawTypes).split(",")).map(String);
        const rawFilters = {
          types,
          projectStatus: queryString(req.query.projectStatus),
          requirementStatus: queryString(req.query.requirementStatus),
          catalogCategory: queryString(req.query.catalogCategory),
          sortBy: queryString(req.query.sortBy) ?? "updatedAt",
          sortOrder: queryString(req.query.sortOrder) ?? "desc",
          pageSize: queryString(req.query.pageSize) ?? "10",
        };
        const parsed = searchFiltersSchema.safeParse(rawFilters);
        if (!parsed.success) {
          invalid(res, "One or more search filters are invalid.");
          return;
        }

        const filters = parsed.data;
        const pageParsed = z.coerce.number().int().min(1).max(10000).safeParse(req.query.page ?? "1");
        if (!pageParsed.success) {
          invalid(res, "Page must be a positive integer.");
          return;
        }

        const page = pageParsed.data;
        const ownerId = req.owner!.id;
        const [projects, requirements, catalog] = await Promise.all([
          filters.types.includes("PROJECT")
            ? ctx.prisma.project.findMany({
                where: {
                  ownerId,
                  archivedAt: null,
                  ...(filters.projectStatus ? { status: filters.projectStatus } : {}),
                  OR: [
                    { name: { contains: query, mode: "insensitive" } },
                    { key: { contains: query, mode: "insensitive" } },
                    { purpose: { contains: query, mode: "insensitive" } },
                  ],
                },
                select: { id: true, key: true, name: true, status: true, updatedAt: true },
                orderBy: { updatedAt: "desc" },
                take: 201,
              })
            : [],
          filters.types.includes("REQUIREMENT")
            ? ctx.prisma.requirement.findMany({
                where: {
                  project: { ownerId, archivedAt: null },
                  ...(filters.requirementStatus ? { status: filters.requirementStatus } : {}),
                  OR: [
                    { title: { contains: query, mode: "insensitive" } },
                    { code: { contains: query, mode: "insensitive" } },
                    { description: { contains: query, mode: "insensitive" } },
                  ],
                },
                select: {
                  id: true,
                  code: true,
                  title: true,
                  status: true,
                  updatedAt: true,
                  projectId: true,
                  project: { select: { key: true } },
                },
                orderBy: { updatedAt: "desc" },
                take: 201,
              })
            : [],
          filters.types.includes("CATALOG")
            ? ctx.prisma.catalogItem.findMany({
                where: {
                  ...(filters.catalogCategory
                    ? { category: { equals: filters.catalogCategory, mode: "insensitive" as const } }
                    : {}),
                  OR: [
                    { title: { contains: query, mode: "insensitive" } },
                    { slug: { contains: query, mode: "insensitive" } },
                    { description: { contains: query, mode: "insensitive" } },
                  ],
                },
                select: { id: true, slug: true, title: true, category: true, lifecycle: true, updatedAt: true },
                orderBy: { updatedAt: "desc" },
                take: 201,
              })
            : [],
        ]);

        const matches = [
          ...projects.map((item) => ({
            id: item.id,
            type: "PROJECT" as const,
            title: item.name,
            subtitle: `${item.key} · ${item.status.toLowerCase().replace("_", " ")}`,
            href: `/projects/${item.id}`,
            status: item.status,
            category: null,
            updatedAt: item.updatedAt.toISOString(),
          })),
          ...requirements.map((item) => ({
            id: item.id,
            type: "REQUIREMENT" as const,
            title: item.title,
            subtitle: `${item.project.key} · ${item.code} · ${item.status.toLowerCase().replace("_", " ")}`,
            href: `/projects/${item.projectId}`,
            status: item.status,
            category: null,
            updatedAt: item.updatedAt.toISOString(),
          })),
          ...catalog.map((item) => ({
            id: item.id,
            type: "CATALOG" as const,
            title: item.title,
            subtitle: `${item.category} · ${item.lifecycle.toLowerCase()}`,
            href: "/catalog",
            status: item.lifecycle,
            category: item.category,
            updatedAt: item.updatedAt.toISOString(),
          })),
        ];

        matches.sort((a, b) => {
          const left = filters.sortBy === "title" ? a.title.toLocaleLowerCase() : a.updatedAt;
          const right = filters.sortBy === "title" ? b.title.toLocaleLowerCase() : b.updatedAt;
          const comparison = left.localeCompare(right);
          return filters.sortOrder === "asc" ? comparison : -comparison;
        });

        const facets = {
          types: SEARCH_TYPES.map((type) => ({
            value: type,
            count: matches.filter((item) => item.type === type).length,
          })),
          statuses: [...new Set(matches.map((item) => item.status))].sort(),
          categories: [...new Set(matches.flatMap((item) => (item.category ? [item.category] : [])))].sort(),
        };
        const start = (page - 1) * filters.pageSize;
        const results = matches.slice(start, start + filters.pageSize);
        const truncated = projects.length > 200 || requirements.length > 200 || catalog.length > 200;

        res.json({
          query,
          filters,
          page,
          pageSize: filters.pageSize,
          total: matches.length,
          hasMore: matches.length > start + filters.pageSize,
          truncated,
          facets,
          results: results.map(({ status: _status, category: _category, updatedAt: _updatedAt, ...item }) => item),
        });
      } catch (error) {
        next(error);
      }
    },
  );

  router.get("/saved", authorize(ctx, "project:read"), async (req, res, next) => {
    try {
      const searches = await ctx.prisma.savedSearch.findMany({
        where: { ownerId: req.owner!.id },
        orderBy: [{ updatedAt: "desc" }, { name: "asc" }],
        select: { id: true, name: true, query: true, filters: true, createdAt: true, updatedAt: true },
      });
      res.json({ searches });
    } catch (error) {
      next(error);
    }
  });

  router.post("/saved", authorize(ctx, "project:write"), async (req, res, next) => {
    try {
      const parsed = savedSearchInputSchema.safeParse(req.body);
      if (!parsed.success) {
        invalid(res, "Saved search name, query or filters are invalid.");
        return;
      }

      const search = await ctx.prisma.savedSearch.create({
        data: { ...parsed.data, ownerId: req.owner!.id },
        select: { id: true, name: true, query: true, filters: true, createdAt: true, updatedAt: true },
      });
      res.status(201).json({ search });
    } catch (error) {
      if (typeof error === "object" && error !== null && "code" in error && error.code === "P2002") {
        res.status(409).json({ error: { code: "CONFLICT", message: "A saved search with this name already exists." } });
        return;
      }
      next(error);
    }
  });

  router.patch("/saved/:id", authorize(ctx, "project:write"), async (req, res, next) => {
    try {
      const parsed = savedSearchInputSchema.safeParse(req.body);
      if (!parsed.success) {
        invalid(res, "Saved search name, query or filters are invalid.");
        return;
      }

      const existing = await ctx.prisma.savedSearch.findFirst({
        where: { id: req.params.id, ownerId: req.owner!.id },
        select: { id: true },
      });
      if (!existing) {
        res.status(404).json({ error: { code: "NOT_FOUND", message: "Saved search not found." } });
        return;
      }

      const search = await ctx.prisma.savedSearch.update({
        where: { id: existing.id },
        data: parsed.data,
        select: { id: true, name: true, query: true, filters: true, createdAt: true, updatedAt: true },
      });
      res.json({ search });
    } catch (error) {
      if (typeof error === "object" && error !== null && "code" in error && error.code === "P2002") {
        res.status(409).json({ error: { code: "CONFLICT", message: "A saved search with this name already exists." } });
        return;
      }
      next(error);
    }
  });

  router.delete("/saved/:id", authorize(ctx, "project:write"), async (req, res, next) => {
    try {
      const existing = await ctx.prisma.savedSearch.findFirst({
        where: { id: req.params.id, ownerId: req.owner!.id },
        select: { id: true },
      });
      if (!existing) {
        res.status(404).json({ error: { code: "NOT_FOUND", message: "Saved search not found." } });
        return;
      }

      await ctx.prisma.savedSearch.delete({ where: { id: existing.id } });
      res.status(204).end();
    } catch (error) {
      next(error);
    }
  });

  return router;
}
