import {
  assignSectorSchema,
  createTaxonomyTermSchema,
  updateTaxonomyTermSchema,
  type TaxonomyKindName,
  type TaxonomyTermView,
} from "@asaa/contracts";
import type { TaxonomyTerm } from "@prisma/client";
import { Router } from "express";
import type { AppContext } from "../../context.js";
import { conflict, notFound, validationFailed } from "../../lib/errors.js";
import { audit } from "../audit/audit.service.js";
import { authorize } from "../auth/policy.js";

/** Throw a field error unless `key` is an active SECTOR term. Used wherever a catalog item names a sector. */
export async function requireActiveSector(ctx: AppContext, key: string | null | undefined): Promise<void> {
  if (!key) return;
  const term = await ctx.prisma.taxonomyTerm.findUnique({ where: { kind_key: { kind: "SECTOR", key } } });
  if (!term || !term.active) throw validationFailed({ sector: "Choose an active sector from the taxonomy." });
}

async function stewardOf(ctx: AppContext, stewardId: string | null | undefined): Promise<string | null> {
  if (!stewardId) return null;
  const owner = await ctx.prisma.owner.findUnique({ where: { id: stewardId }, select: { id: true, isActive: true } });
  if (!owner || !owner.isActive) throw validationFailed({ stewardId: "Choose an active team member as steward." });
  return owner.id;
}

async function assertParent(
  ctx: AppContext,
  kind: TaxonomyKindName,
  key: string,
  parentKey: string | null | undefined,
): Promise<void> {
  if (!parentKey) return;
  if (parentKey === key) throw validationFailed({ parentKey: "A term cannot be its own parent." });
  // Walk up the chain: the new parent must exist and must not lead back to this term.
  const seen = new Set<string>([key]);
  let cursor: string | null = parentKey;
  while (cursor) {
    if (seen.has(cursor)) throw validationFailed({ parentKey: "This parent would create a cycle." });
    seen.add(cursor);
    const parent: TaxonomyTerm | null = await ctx.prisma.taxonomyTerm.findUnique({
      where: { kind_key: { kind, key: cursor } },
    });
    if (!parent) throw validationFailed({ parentKey: "The parent term does not exist." });
    cursor = parent.parentKey;
  }
}

/**
 * Managed vocabulary for the catalogue (D3.6) and sector administration (D3.7): categories and business sectors
 * with optional parents, stewards and active flags. Reading is open to anyone who can read the catalogue;
 * changes need the taxonomy:manage permission (management roles).
 */
export function taxonomyRouter(ctx: AppContext): Router {
  const router = Router();

  router.get("/", authorize(ctx, "catalog:read"), async (_req, res, next) => {
    try {
      const [terms, items] = await Promise.all([
        ctx.prisma.taxonomyTerm.findMany({ orderBy: [{ kind: "asc" }, { label: "asc" }] }),
        ctx.prisma.catalogItem.findMany({ select: { category: true, sector: true, lifecycle: true }, take: 5000 }),
      ]);
      const stewardIds = [...new Set(terms.map((term) => term.stewardId).filter((id): id is string => Boolean(id)))];
      const stewards = stewardIds.length
        ? await ctx.prisma.owner.findMany({
            where: { id: { in: stewardIds } },
            select: { id: true, displayName: true },
          })
        : [];
      const names = new Map(stewards.map((owner) => [owner.id, owner.displayName]));
      const views: TaxonomyTermView[] = terms.map((term) => {
        const matching = items.filter((item) =>
          term.kind === "SECTOR"
            ? item.sector === term.key
            : [term.key, term.label.toLowerCase()].includes(item.category.toLowerCase()),
        );
        return {
          id: term.id,
          kind: term.kind,
          key: term.key,
          label: term.label,
          description: term.description,
          parentKey: term.parentKey,
          stewardId: term.stewardId,
          stewardName: term.stewardId ? (names.get(term.stewardId) ?? null) : null,
          active: term.active,
          rowVersion: term.rowVersion,
          itemCount: matching.length,
          activeItemCount: matching.filter((item) => item.lifecycle === "ACTIVE").length,
        };
      });
      const managed = new Set(
        terms.filter((term) => term.kind === "CATEGORY").flatMap((term) => [term.key, term.label.toLowerCase()]),
      );
      const unmanagedCategories = [
        ...new Set(items.map((item) => item.category).filter((category) => !managed.has(category.toLowerCase()))),
      ].sort();
      res.json({ terms: views, unmanagedCategories, unsectoredItems: items.filter((item) => !item.sector).length });
    } catch (error) {
      next(error);
    }
  });

  router.post("/", authorize(ctx, "taxonomy:manage"), async (req, res, next) => {
    try {
      const input = createTaxonomyTermSchema.parse(req.body);
      await assertParent(ctx, input.kind, input.key, input.parentKey);
      const stewardId = await stewardOf(ctx, input.stewardId);
      const existing = await ctx.prisma.taxonomyTerm.findUnique({
        where: { kind_key: { kind: input.kind, key: input.key } },
      });
      if (existing) throw conflict(`A ${input.kind.toLowerCase()} with this key already exists.`);
      const term = await ctx.prisma.taxonomyTerm.create({
        data: {
          kind: input.kind,
          key: input.key,
          label: input.label,
          description: input.description,
          parentKey: input.parentKey ?? null,
          stewardId,
        },
      });
      await audit(ctx, req, {
        action: "taxonomy.create",
        outcome: "SUCCESS",
        targetType: "taxonomy_term",
        targetId: term.id,
        metadata: { kind: term.kind, key: term.key },
      });
      res.status(201).json({ term });
    } catch (error) {
      next(error);
    }
  });

  /** Create CATEGORY terms for every category already used by catalogue items but not yet managed. */
  router.post("/adopt-categories", authorize(ctx, "taxonomy:manage"), async (req, res, next) => {
    try {
      const [terms, items] = await Promise.all([
        ctx.prisma.taxonomyTerm.findMany({ where: { kind: "CATEGORY" } }),
        ctx.prisma.catalogItem.findMany({ distinct: ["category"], select: { category: true } }),
      ]);
      const managed = new Set(terms.flatMap((term) => [term.key, term.label.toLowerCase()]));
      const created: string[] = [];
      for (const { category } of items) {
        if (managed.has(category.toLowerCase())) continue;
        const key = category
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, "-")
          .replace(/^-+|-+$/g, "")
          .slice(0, 80);
        if (!/^[a-z0-9][a-z0-9-]{1,79}$/.test(key) || managed.has(key)) continue;
        await ctx.prisma.taxonomyTerm.create({ data: { kind: "CATEGORY", key, label: category.slice(0, 120) } });
        managed.add(key);
        created.push(key);
      }
      await audit(ctx, req, {
        action: "taxonomy.adopt_categories",
        outcome: "SUCCESS",
        targetType: "taxonomy_term",
        metadata: { created },
      });
      res.json({ created });
    } catch (error) {
      next(error);
    }
  });

  router.post("/assign-sector", authorize(ctx, "taxonomy:manage"), async (req, res, next) => {
    try {
      const input = assignSectorSchema.parse(req.body);
      await requireActiveSector(ctx, input.sector);
      const result = await ctx.prisma.catalogItem.updateMany({
        where: { id: { in: input.itemIds } },
        data: { sector: input.sector, rowVersion: { increment: 1 } },
      });
      await audit(ctx, req, {
        action: "taxonomy.assign_sector",
        outcome: "SUCCESS",
        targetType: "taxonomy_term",
        metadata: { sector: input.sector, requested: input.itemIds.length, updated: result.count },
      });
      res.json({ updated: result.count });
    } catch (error) {
      next(error);
    }
  });

  router.patch("/:id", authorize(ctx, "taxonomy:manage"), async (req, res, next) => {
    try {
      const id = String(req.params.id);
      if (!/^[0-9a-f-]{36}$/i.test(id)) throw notFound("Taxonomy term");
      const { expectedVersion, ...changes } = updateTaxonomyTermSchema.parse(req.body);
      const current = await ctx.prisma.taxonomyTerm.findUnique({ where: { id } });
      if (!current) throw notFound("Taxonomy term");
      if (changes.parentKey !== undefined) await assertParent(ctx, current.kind, current.key, changes.parentKey);
      const stewardId = changes.stewardId === undefined ? undefined : await stewardOf(ctx, changes.stewardId);
      const result = await ctx.prisma.taxonomyTerm.updateMany({
        where: { id, rowVersion: expectedVersion },
        data: {
          ...(changes.label !== undefined ? { label: changes.label } : {}),
          ...(changes.description !== undefined ? { description: changes.description } : {}),
          ...(changes.parentKey !== undefined ? { parentKey: changes.parentKey } : {}),
          ...(changes.active !== undefined ? { active: changes.active } : {}),
          ...(stewardId !== undefined ? { stewardId } : {}),
          rowVersion: { increment: 1 },
        },
      });
      if (result.count === 0) throw conflict("This term was changed elsewhere. Reload and try again.");
      await audit(ctx, req, {
        action: "taxonomy.update",
        outcome: "SUCCESS",
        targetType: "taxonomy_term",
        targetId: id,
        metadata: { kind: current.kind, key: current.key, fields: Object.keys(changes) },
      });
      const term = await ctx.prisma.taxonomyTerm.findUniqueOrThrow({ where: { id } });
      res.json({ term });
    } catch (error) {
      next(error);
    }
  });

  router.delete("/:id", authorize(ctx, "taxonomy:manage"), async (req, res, next) => {
    try {
      const id = String(req.params.id);
      if (!/^[0-9a-f-]{36}$/i.test(id)) throw notFound("Taxonomy term");
      const term = await ctx.prisma.taxonomyTerm.findUnique({ where: { id } });
      if (!term) throw notFound("Taxonomy term");
      const [children, items] = await Promise.all([
        ctx.prisma.taxonomyTerm.count({ where: { kind: term.kind, parentKey: term.key } }),
        term.kind === "SECTOR"
          ? ctx.prisma.catalogItem.count({ where: { sector: term.key } })
          : ctx.prisma.catalogItem.count({
              where: {
                OR: [
                  { category: { equals: term.key, mode: "insensitive" } },
                  { category: { equals: term.label, mode: "insensitive" } },
                ],
              },
            }),
      ]);
      if (children > 0) throw conflict("Remove or re-parent the child terms first.");
      if (items > 0) throw conflict("Catalogue items still use this term. Deactivate it instead.");
      await ctx.prisma.taxonomyTerm.delete({ where: { id } });
      await audit(ctx, req, {
        action: "taxonomy.delete",
        outcome: "SUCCESS",
        targetType: "taxonomy_term",
        targetId: id,
        metadata: { kind: term.kind, key: term.key },
      });
      res.status(204).end();
    } catch (error) {
      next(error);
    }
  });

  return router;
}
