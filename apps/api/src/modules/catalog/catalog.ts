import {
  CATALOG_METADATA_SCHEMA_VERSION,
  catalogQuerySchema,
  createCatalogItemSchema,
  updateCatalogItemSchema,
  type CatalogItemView,
} from "@asaa/contracts";
import type { CatalogItem, Prisma } from "@prisma/client";
import { Router } from "express";
import type { AppContext } from "../../context.js";
import { conflict, notFound, validationFailed } from "../../lib/errors.js";
import { audit } from "../audit/audit.service.js";
import { authorize } from "../auth/policy.js";

export function catalogView(item: CatalogItem): CatalogItemView {
  return {
    id: item.id,
    slug: item.slug,
    title: item.title,
    description: item.description,
    kind: item.kind,
    category: item.category,
    technologies: item.technologies,
    tags: item.tags,
    version: item.version,
    lifecycle: item.lifecycle,
    trustStatus: item.trustStatus,
    sourceType: item.sourceType,
    sourceReference: item.sourceReference,
    license: item.license,
    ownership: item.ownership,
    dependencies: Array.isArray(item.dependencies) ? (item.dependencies as { name: string; version: string }[]) : [],
    metadataSchemaVersion: item.metadataSchemaVersion,
    createdAt: item.createdAt.toISOString(),
    updatedAt: item.updatedAt.toISOString(),
    rowVersion: item.rowVersion,
  };
}

/**
 * Private template/asset catalog (US-D01, US-D02). Imported source is UNTRUSTED
 * on registration and cannot become ACTIVE until it is marked TRUSTED after review.
 */
export function catalogRouter(ctx: AppContext): Router {
  const router = Router();

  router.get("/", authorize(ctx, "catalog:read"), async (req, res, next) => {
    try {
      const query = catalogQuerySchema.parse(req.query);
      const where: Prisma.CatalogItemWhereInput = {
        ...(query.category ? { category: { equals: query.category, mode: "insensitive" } } : {}),
        ...(query.technology ? { technologies: { has: query.technology } } : {}),
        ...(query.tag ? { tags: { has: query.tag } } : {}),
        ...(query.lifecycle ? { lifecycle: query.lifecycle } : {}),
        ...(query.kind ? { kind: query.kind } : {}),
        ...(query.q
          ? {
              OR: [
                { title: { contains: query.q, mode: "insensitive" } },
                { description: { contains: query.q, mode: "insensitive" } },
                { slug: { contains: query.q.toLowerCase() } },
                { tags: { has: query.q.toLowerCase() } },
                { technologies: { has: query.q.toLowerCase() } },
              ],
            }
          : {}),
      };
      const [items, categories] = await Promise.all([
        ctx.prisma.catalogItem.findMany({ where, orderBy: [{ lifecycle: "asc" }, { title: "asc" }], take: 200 }),
        ctx.prisma.catalogItem.findMany({
          distinct: ["category"],
          select: { category: true },
          orderBy: { category: "asc" },
        }),
      ]);
      res.json({ items: items.map(catalogView), categories: categories.map((row) => row.category) });
    } catch (error) {
      next(error);
    }
  });

  router.post("/", authorize(ctx, "catalog:write"), async (req, res, next) => {
    try {
      const input = createCatalogItemSchema.parse(req.body);
      const item = await ctx.prisma.catalogItem.create({
        data: {
          ...input,
          sourceReference: input.sourceReference || null,
          trustStatus: input.sourceType === "IMPORTED" ? "UNTRUSTED" : "TRUSTED",
          metadataSchemaVersion: CATALOG_METADATA_SCHEMA_VERSION,
        },
      });
      await audit(ctx, req, {
        action: "catalog.create",
        outcome: "SUCCESS",
        targetType: "catalog_item",
        targetId: item.id,
        metadata: { slug: item.slug, sourceType: item.sourceType },
      });
      res.status(201).json({ item: catalogView(item) });
    } catch (error) {
      next(error);
    }
  });

  router.get("/:id", authorize(ctx, "catalog:read"), async (req, res, next) => {
    try {
      const id = String(req.params.id);
      if (!/^[0-9a-f-]{36}$/i.test(id)) throw notFound("Catalog item");
      const item = await ctx.prisma.catalogItem.findUnique({ where: { id } });
      if (!item) throw notFound("Catalog item");
      res.json({ item: catalogView(item) });
    } catch (error) {
      next(error);
    }
  });

  router.patch("/:id", authorize(ctx, "catalog:write"), async (req, res, next) => {
    try {
      const id = String(req.params.id);
      if (!/^[0-9a-f-]{36}$/i.test(id)) throw notFound("Catalog item");
      const { expectedVersion, ...changes } = updateCatalogItemSchema.parse(req.body);
      const current = await ctx.prisma.catalogItem.findUnique({ where: { id } });
      if (!current) throw notFound("Catalog item");
      const trust = changes.trustStatus ?? current.trustStatus;
      const lifecycle = changes.lifecycle ?? current.lifecycle;
      if (lifecycle === "ACTIVE" && trust !== "TRUSTED") {
        throw validationFailed({ lifecycle: "Only trusted items can be active. Review and trust the source first." });
      }
      const result = await ctx.prisma.catalogItem.updateMany({
        where: { id, rowVersion: expectedVersion },
        data: { ...changes, rowVersion: { increment: 1 } },
      });
      if (result.count === 0) throw conflict("This catalog item was changed elsewhere. Reload and try again.");
      const item = await ctx.prisma.catalogItem.findUniqueOrThrow({ where: { id } });
      await audit(ctx, req, {
        action:
          changes.trustStatus && changes.trustStatus !== current.trustStatus
            ? "catalog.trust_change"
            : "catalog.update",
        outcome: "SUCCESS",
        targetType: "catalog_item",
        targetId: id,
        metadata: { fields: Object.keys(changes), trustStatus: { from: current.trustStatus, to: item.trustStatus } },
      });
      res.json({ item: catalogView(item) });
    } catch (error) {
      next(error);
    }
  });

  return router;
}
