import {
  createReleaseSchema,
  deprecateReleaseSchema,
  releaseListQuerySchema,
  releaseNoteSchema,
  type TemplateReleaseView,
} from "@asaa/contracts";
import { Prisma, type TemplateRelease } from "@prisma/client";
import { Router, type Request } from "express";
import type { AppContext } from "../../context.js";
import { certifyTemplate } from "../../certification/certify.js";
import { conflict, forbidden, notEligible, notFound, validationFailed } from "../../lib/errors.js";
import { audit } from "../audit/audit.service.js";
import { authorize } from "../auth/policy.js";
import type { GenerationService } from "./generation.service.js";
import { isUsable } from "./library.js";

/**
 * Template release lifecycle (RG-06): DRAFT -> IN_REVIEW -> APPROVED -> RELEASED (immutable) -> DEPRECATED.
 * Approval needs a different person than the author unless the platform OWNER acts.
 * Released rows are additionally protected by a database trigger.
 */
export function releaseView(row: TemplateRelease): TemplateReleaseView {
  const iso = (value: Date | null) => value?.toISOString() ?? null;
  return {
    id: row.id,
    templateId: row.templateId,
    version: row.version,
    status: row.status,
    contentDigest: row.contentDigest,
    notes: row.notes,
    reviewNote: row.reviewNote,
    createdById: row.createdById,
    submittedById: row.submittedById,
    approvedById: row.approvedById,
    releasedById: row.releasedById,
    createdAt: row.createdAt.toISOString(),
    submittedAt: iso(row.submittedAt),
    approvedAt: iso(row.approvedAt),
    releasedAt: iso(row.releasedAt),
    deprecatedAt: iso(row.deprecatedAt),
    deprecationReason: row.deprecationReason,
    replacedByVersion: row.replacedByVersion,
    rowVersion: row.rowVersion,
  };
}

const UUID = /^[0-9a-f-]{36}$/i;

export function releasesRouter(ctx: AppContext, service: GenerationService): Router {
  const router = Router();
  const prisma = ctx.prisma;

  async function load(id: string): Promise<TemplateRelease> {
    if (!UUID.test(id)) throw notFound("Release");
    const row = await prisma.templateRelease.findUnique({ where: { id } });
    if (!row) throw notFound("Release");
    return row;
  }

  async function transition(
    req: Request,
    id: string,
    from: TemplateRelease["status"],
    data: Prisma.TemplateReleaseUncheckedUpdateManyInput,
    action: string,
    metadata: Record<string, unknown> = {},
  ) {
    const current = await load(id);
    const result = await prisma.templateRelease.updateMany({
      where: { id, status: from },
      data: { ...data, rowVersion: { increment: 1 } },
    });
    if (result.count !== 1) {
      throw conflict(`This release is ${current.status}; it must be ${from} for this step.`);
    }
    const row = await load(id);
    await audit(ctx, req, {
      action: `template.release.${action}`,
      outcome: "SUCCESS",
      targetType: "template_release",
      targetId: id,
      metadata: { templateId: row.templateId, version: row.version, ...metadata },
    });
    return row;
  }

  /** Author and approver must differ unless the platform OWNER acts (single-owner installations). */
  function requireSecondPerson(req: Request, row: TemplateRelease) {
    const actor = req.owner!;
    if (actor.role !== "OWNER" && (row.createdById === actor.id || row.submittedById === actor.id)) {
      throw forbidden();
    }
  }

  async function currentContent(row: TemplateRelease) {
    const template = await service.library.get(row.templateId, row.version);
    if (!template || !isUsable(template)) throw notEligible("The template content is missing or invalid.");
    if (template.digest !== row.contentDigest) {
      throw conflict("The template content changed since this draft was created. Create a new version.");
    }
    return template;
  }

  router.get("/", authorize(ctx, "template:read"), async (req, res, next) => {
    try {
      const query = releaseListQuerySchema.parse(req.query);
      const rows = await prisma.templateRelease.findMany({
        where: {
          ...(query.templateId ? { templateId: query.templateId } : {}),
          ...(query.status ? { status: query.status } : {}),
        },
        orderBy: [{ templateId: "asc" }, { createdAt: "desc" }],
        take: 200,
      });
      res.json({ releases: rows.map(releaseView) });
    } catch (error) {
      next(error);
    }
  });

  router.post("/", authorize(ctx, "template:submit"), async (req, res, next) => {
    try {
      const input = createReleaseSchema.parse(req.body);
      const template = await service.library.get(input.templateId, input.version);
      if (!template) throw notFound("Template version");
      if (!isUsable(template)) {
        throw notEligible(`This template content is invalid: ${template.problems.slice(0, 3).join(" ")}`);
      }
      if (template.manifest.kind !== "template") throw notEligible("Only templates (not starters) are released.");
      const report = certifyTemplate(template, null);
      const failing = report.checks.filter((check) => check.status === "fail" && check.id !== "integrity");
      if (failing.length > 0) {
        throw validationFailed(
          {
            version: failing
              .map((check) => `${check.id}: ${check.detail}`)
              .join(" | ")
              .slice(0, 500),
          },
          "The package failed certification checks.",
        );
      }
      const row = await prisma.templateRelease
        .create({
          data: {
            templateId: input.templateId,
            version: input.version,
            contentDigest: template.digest,
            manifest: template.rawManifest as Prisma.InputJsonValue,
            notes: input.notes,
            createdById: req.owner!.id,
            createdAt: ctx.now(),
          },
        })
        .catch((error: unknown) => {
          if (error && typeof error === "object" && "code" in error && error.code === "P2002") {
            throw conflict(`${input.templateId}@${input.version} already has a release record.`);
          }
          throw error;
        });
      await audit(ctx, req, {
        action: "template.release.draft",
        outcome: "SUCCESS",
        targetType: "template_release",
        targetId: row.id,
        metadata: { templateId: row.templateId, version: row.version, digest: row.contentDigest },
      });
      res.status(201).json({ release: releaseView(row) });
    } catch (error) {
      next(error);
    }
  });

  router.get("/:id", authorize(ctx, "template:read"), async (req, res, next) => {
    try {
      res.json({ release: releaseView(await load(String(req.params.id))) });
    } catch (error) {
      next(error);
    }
  });

  router.post("/:id/submit", authorize(ctx, "template:submit"), async (req, res, next) => {
    try {
      const row = await load(String(req.params.id));
      await currentContent(row);
      const updated = await transition(
        req,
        row.id,
        "DRAFT",
        { status: "IN_REVIEW", submittedAt: ctx.now(), submittedById: req.owner!.id },
        "submit",
      );
      res.json({ release: releaseView(updated) });
    } catch (error) {
      next(error);
    }
  });

  router.post("/:id/reject", authorize(ctx, "template:approve"), async (req, res, next) => {
    try {
      const { note } = releaseNoteSchema.parse(req.body);
      if (!note) throw validationFailed({ note: "Explain what must change." });
      const row = await load(String(req.params.id));
      const updated = await transition(
        req,
        row.id,
        "IN_REVIEW",
        { status: "DRAFT", reviewNote: note, submittedAt: null, submittedById: null },
        "reject",
      );
      res.json({ release: releaseView(updated) });
    } catch (error) {
      next(error);
    }
  });

  router.post("/:id/approve", authorize(ctx, "template:approve"), async (req, res, next) => {
    try {
      const { note } = releaseNoteSchema.parse(req.body);
      const row = await load(String(req.params.id));
      requireSecondPerson(req, row);
      await currentContent(row);
      const updated = await transition(
        req,
        row.id,
        "IN_REVIEW",
        { status: "APPROVED", approvedAt: ctx.now(), approvedById: req.owner!.id, reviewNote: note },
        "approve",
      );
      res.json({ release: releaseView(updated) });
    } catch (error) {
      next(error);
    }
  });

  router.post("/:id/release", authorize(ctx, "template:approve"), async (req, res, next) => {
    try {
      const row = await load(String(req.params.id));
      if (row.status !== "APPROVED") throw conflict(`This release is ${row.status}; it must be APPROVED to release.`);
      const template = await currentContent(row);
      const manifest = template.manifest;
      const { item } = await service.publish(
        req,
        template,
        {
          title: manifest.title,
          description: manifest.description,
          kind: "TEMPLATE",
          category: manifest.category,
          technologies: manifest.technologies.map((tech) => tech.name.toLowerCase()).slice(0, 20),
          version: manifest.version,
          license: manifest.license.spdx,
          ownership: manifest.provenance.maintainer,
          dependencies: manifest.dependencies,
          sourceType: "AUTHORED",
          sourceReference: manifest.provenance.repository ?? `template-library/${row.templateId}/${row.version}`,
          contentRef: row.templateId,
          contentDigest: template.digest,
          trustStatus: "TRUSTED",
          lifecycle: "ACTIVE",
        },
        row.id,
      );
      res.json({ release: releaseView(await load(row.id)), item: { id: item.id, version: item.version } });
    } catch (error) {
      next(error);
    }
  });

  router.post("/:id/deprecate", authorize(ctx, "template:approve"), async (req, res, next) => {
    try {
      const input = deprecateReleaseSchema.parse(req.body);
      const row = await load(String(req.params.id));
      if (input.replacedByVersion) {
        const replacement = await prisma.templateRelease.findUnique({
          where: { templateId_version: { templateId: row.templateId, version: input.replacedByVersion } },
        });
        if (!replacement || replacement.status !== "RELEASED") {
          throw validationFailed({ replacedByVersion: "The replacement must be a released version of this template." });
        }
      }
      const updated = await transition(
        req,
        row.id,
        "RELEASED",
        {
          status: "DEPRECATED",
          deprecatedAt: ctx.now(),
          deprecationReason: input.reason,
          replacedByVersion: input.replacedByVersion ?? null,
        },
        "deprecate",
        { reason: input.reason },
      );
      await prisma.catalogItem.updateMany({
        where: { slug: row.templateId, version: row.version, sourceType: "AUTHORED" },
        data: { lifecycle: "DEPRECATED", rowVersion: { increment: 1 } },
      });
      res.json({ release: releaseView(updated) });
    } catch (error) {
      next(error);
    }
  });

  return router;
}
