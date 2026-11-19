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
import { resolveAssets, type AssetIndex, type AssetVersion } from "./resolver.js";
import { z } from "zod";

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
    contentRef: item.contentRef,
    contentDigest: item.contentDigest,
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

  /**
   * Dependency, license and version resolution for reusable assets (RG-13). Read-only; resolves against the
   * catalog and the immutable template release ledger without mutating anything.
   */
  router.post("/resolve", authorize(ctx, "catalog:read"), async (req, res, next) => {
    try {
      const input = z
        .object({
          roots: z
            .array(z.object({ name: z.string().trim().min(1).max(120), range: z.string().trim().max(60).default("*") }))
            .min(1)
            .max(20),
          allowedLicenses: z.array(z.string().trim().min(1).max(80)).max(50).optional(),
        })
        .parse(req.body);
      const [items, releases] = await Promise.all([
        ctx.prisma.catalogItem.findMany({ where: { kind: { not: "IMPORTED_PROJECT" } }, take: 2000 }),
        ctx.prisma.templateRelease.findMany({ where: { status: { in: ["RELEASED", "DEPRECATED"] } }, take: 2000 }),
      ]);
      const versions = new Map<string, AssetVersion[]>();
      const add = (asset: AssetVersion, override: boolean) => {
        const list = versions.get(asset.name) ?? [];
        const existing = list.findIndex((candidate) => candidate.version === asset.version);
        if (existing >= 0) {
          if (override) list[existing] = asset;
        } else list.push(asset);
        versions.set(asset.name, list);
      };
      const dependencyList = (value: unknown) =>
        (Array.isArray(value) ? (value as { name: string; version: string }[]) : []).map((dependency) => ({
          name: dependency.name,
          range: dependency.version,
        }));
      for (const release of releases) {
        const manifest = release.manifest as { license?: { spdx?: string }; dependencies?: unknown };
        add(
          {
            name: release.templateId,
            version: release.version,
            license: manifest.license?.spdx ?? "UNKNOWN",
            lifecycle: release.status === "RELEASED" ? "ACTIVE" : "DEPRECATED",
            trusted: true,
            dependencies: dependencyList(manifest.dependencies),
          },
          false,
        );
      }
      for (const item of items) {
        add(
          {
            name: item.slug,
            version: item.version,
            license: item.license,
            lifecycle: item.lifecycle,
            trusted: item.trustStatus === "TRUSTED",
            dependencies: dependencyList(item.dependencies),
          },
          true,
        );
      }
      const index: AssetIndex = { versionsOf: (name) => versions.get(name) ?? [] };
      res.json({ resolution: resolveAssets(input.roots, index, { allowedLicenses: input.allowedLicenses }) });
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
      if (current.contentDigest) {
        // Released template metadata is immutable (RG-06); publish a new version instead.
        const locked: Record<string, string> = {};
        if (changes.version !== undefined && changes.version !== current.version)
          locked.version = "Released versions cannot be renumbered.";
        if (changes.license !== undefined && changes.license !== current.license)
          locked.license = "The license of a released version is immutable.";
        if (
          changes.dependencies !== undefined &&
          JSON.stringify(changes.dependencies) !== JSON.stringify(current.dependencies)
        ) {
          locked.dependencies = "Dependencies of a released version are immutable.";
        }
        if (Object.keys(locked).length > 0) throw validationFailed(locked, "Released template versions are immutable.");
      }
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
