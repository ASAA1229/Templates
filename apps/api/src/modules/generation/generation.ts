import { generationActionSchema, generationListQuerySchema } from "@asaa/contracts";
import { z } from "zod";
import { Router } from "express";
import type { AppContext } from "../../context.js";
import { authorize } from "../auth/policy.js";
import { catalogView } from "../catalog/catalog.js";
import { GenerationService, generationView } from "./generation.service.js";
import { TemplateLibrary } from "./library.js";

const updateQuerySchema = z.object({ toVersion: z.string().regex(/^[0-9]+[.][0-9]+[.][0-9]+(?:-[0-9A-Za-z.-]+)?$/) });

export function createGenerationService(ctx: AppContext): GenerationService {
  return new GenerationService(ctx, {
    library: new TemplateLibrary(ctx.config.TEMPLATE_LIBRARY_DIR),
    outputRoot: ctx.config.GENERATION_OUTPUT_DIR,
  });
}

/** Template library: list content, see options for the wizard, approve content for use. */
export function templatesRouter(ctx: AppContext, service = createGenerationService(ctx)): Router {
  const router = Router();

  router.get("/library", authorize(ctx, "template:read"), async (_req, res, next) => {
    try {
      res.json({ templates: await service.librarySummaries() });
    } catch (error) {
      next(error);
    }
  });

  router.get("/options", authorize(ctx, "template:read"), async (_req, res, next) => {
    try {
      const [templates, starters] = await Promise.all([service.templateOptions(), service.starterOptions()]);
      res.json({ templates, starters });
    } catch (error) {
      next(error);
    }
  });

  router.post("/library/:id/:version/approve", authorize(ctx, "template:approve"), async (req, res, next) => {
    try {
      const { item, created } = await service.approve(req, String(req.params.id), String(req.params.version));
      res.status(created ? 201 : 200).json({ item: catalogView(item) });
    } catch (error) {
      next(error);
    }
  });

  return router;
}

/** Generation lifecycle: preview, generate, inspect, retry and verify reproducibility. */
export function generationsRouter(ctx: AppContext, service = createGenerationService(ctx)): Router {
  const router = Router();

  router.get("/", authorize(ctx, "generation:read"), async (req, res, next) => {
    try {
      const query = generationListQuerySchema.parse(req.query);
      res.json({ generations: (await service.list(req, query)).map(generationView) });
    } catch (error) {
      next(error);
    }
  });

  router.post("/preview", authorize(ctx, "generation:write"), async (req, res, next) => {
    try {
      res.json({ preview: await service.preview(req.body) });
    } catch (error) {
      next(error);
    }
  });

  router.post("/", authorize(ctx, "generation:write"), async (req, res, next) => {
    try {
      const generation = await service.generate(req, req.body);
      res.status(201).json({ generation: generationView(generation) });
    } catch (error) {
      next(error);
    }
  });

  router.get("/:id", authorize(ctx, "generation:read"), async (req, res, next) => {
    try {
      res.json({ generation: generationView(await service.load(req, String(req.params.id))) });
    } catch (error) {
      next(error);
    }
  });

  router.post("/:id/retry", authorize(ctx, "generation:write"), async (req, res, next) => {
    try {
      await service.load(req, String(req.params.id), "write");
      const { expectedVersion } = generationActionSchema.parse(req.body);
      const generation = await service.retry(req, String(req.params.id), expectedVersion);
      res.json({ generation: generationView(generation) });
    } catch (error) {
      next(error);
    }
  });

  router.get("/:id/export", authorize(ctx, "generation:read"), async (req, res, next) => {
    try {
      const { filename, archive } = await service.exportArchive(req, String(req.params.id));
      res.setHeader("content-type", "application/zip");
      res.setHeader("content-disposition", `attachment; filename="${filename}"`);
      res.setHeader("content-length", String(archive.length));
      res.setHeader("x-content-type-options", "nosniff");
      res.end(archive);
    } catch (error) {
      next(error);
    }
  });

  router.get("/:id/update-preview", authorize(ctx, "generation:read"), async (req, res, next) => {
    try {
      const { toVersion } = updateQuerySchema.parse(req.query);
      res.json(await service.updatePreview(req, String(req.params.id), toVersion));
    } catch (error) {
      next(error);
    }
  });

  router.post("/:id/update", authorize(ctx, "generation:write"), async (req, res, next) => {
    try {
      await service.load(req, String(req.params.id), "write");
      const { toVersion } = updateQuerySchema.parse(req.body);
      res.json(await service.applyUpdate(req, String(req.params.id), toVersion));
    } catch (error) {
      next(error);
    }
  });

  router.post("/:id/verify", authorize(ctx, "generation:read"), async (req, res, next) => {
    try {
      res.json({ verification: await service.verify(req, String(req.params.id)) });
    } catch (error) {
      next(error);
    }
  });

  return router;
}
