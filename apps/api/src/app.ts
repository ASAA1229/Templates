import { existsSync } from "node:fs";
import path from "node:path";
import cookieParser from "cookie-parser";
import express, { type Express } from "express";
import helmet from "helmet";
import type { AppContext } from "./context.js";
import { errorHandler, notFoundHandler } from "./middleware/errors.js";
import { csrfProtection, requestId } from "./middleware/security.js";
import { authenticate, authRouter, requireOwner } from "./modules/auth/auth.js";
import { catalogRouter } from "./modules/catalog/catalog.js";
import { dashboardRouter } from "./modules/dashboard/dashboard.js";
import { createGenerationService, generationsRouter, templatesRouter } from "./modules/generation/generation.js";
import { projectsRouter } from "./modules/projects/projects.js";
import { requirementsRouter } from "./modules/requirements/requirements.js";
import { searchRouter } from "./modules/search/search.js";
import { workspaceRouter } from "./modules/workspace/workspace.js";

/**
 * Modular monolith composition root. Each domain module owns its router; this
 * file only wires cross-cutting middleware and mounts modules under /api.
 */
export function createApp(ctx: AppContext): Express {
  const app = express();
  app.disable("x-powered-by");
  // Loopback-only proxy trust; set explicitly when deployed behind a reverse proxy.
  app.set("trust proxy", "loopback");

  app.use(requestId());
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'"],
          styleSrc: ["'self'", "'unsafe-inline'"],
          imgSrc: ["'self'", "data:"],
          connectSrc: ["'self'"],
          frameAncestors: ["'none'"],
          objectSrc: ["'none'"],
          baseUri: ["'self'"],
          formAction: ["'self'"],
        },
      },
      crossOriginEmbedderPolicy: false,
    }),
  );
  app.use(express.json({ limit: "100kb" }));
  app.use(cookieParser());

  const api = express.Router();
  api.use((_req, res, next) => {
    res.setHeader("cache-control", "no-store");
    next();
  });
  api.get("/health", async (_req, res) => {
    try {
      await ctx.prisma.$queryRaw`SELECT 1`;
      res.json({ status: "ok", database: "ok" });
    } catch {
      res.status(503).json({ status: "degraded", database: "unavailable" });
    }
  });
  api.use(csrfProtection(ctx));
  api.use(authenticate(ctx));
  api.use("/auth", authRouter(ctx));
  api.use(requireOwner());
  api.use("/projects/:projectId/requirements", requirementsRouter(ctx));
  api.use("/projects/:projectId/workspace", workspaceRouter(ctx));
  api.use("/projects", projectsRouter(ctx));
  api.use("/catalog", catalogRouter(ctx));
  api.use("/search", searchRouter(ctx));
  const generation = createGenerationService(ctx);
  api.use("/templates", templatesRouter(ctx, generation));
  api.use("/generations", generationsRouter(ctx, generation));
  api.use("/", dashboardRouter(ctx));
  api.use(notFoundHandler());
  app.use("/api", api);

  // Optional single-process deployment: serve the built SPA with history fallback.
  const webDist = ctx.config.WEB_DIST_DIR ? path.resolve(ctx.config.WEB_DIST_DIR) : "";
  if (webDist && existsSync(path.join(webDist, "index.html"))) {
    app.use(express.static(webDist, { index: false, maxAge: "1h" }));
    app.get(/^(?!\/api\/).*/, (_req, res) => res.sendFile(path.join(webDist, "index.html")));
  }

  app.use(errorHandler(ctx));
  return app;
}
