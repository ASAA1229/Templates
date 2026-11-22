import { jarvisInvokeSchema, type JarvisStatusView } from "@asaa/contracts";
import { Router } from "express";
import type { AppContext } from "../../context.js";
import { createJarvisClient, type JarvisClient } from "../../integrations/jarvis.js";
import { validationFailed } from "../../lib/errors.js";
import { audit } from "../audit/audit.service.js";
import { authorize } from "../auth/policy.js";

/** JARVIS mini-features (D3.5): optional, disabled by default, advisory output only. */
export function jarvisRouter(ctx: AppContext, client: JarvisClient = createJarvisClient(ctx.config)): Router {
  const router = Router();

  router.get("/status", authorize(ctx, "workspace:read"), async (req, res, next) => {
    try {
      const status: JarvisStatusView = {
        enabled: client.enabled,
        reachable: await client.reachable(req.requestId),
        features: client.features,
        note: client.enabled
          ? "Results are advisory and AI-generated; review them before use."
          : "JARVIS mini-features are off. Templates works fully without JARVIS.",
      };
      res.json({ status });
    } catch (error) {
      next(error);
    }
  });

  router.post("/invoke", authorize(ctx, "workspace:write"), async (req, res, next) => {
    try {
      const parsed = jarvisInvokeSchema.safeParse(req.body);
      if (!parsed.success) throw validationFailed({ content: "Choose a feature and provide 1 to 12000 characters." });
      const { feature, content } = parsed.data;
      const output = await client.invoke(feature, content, req.requestId);
      await audit(ctx, req, {
        action: "jarvis.invoke",
        outcome: "SUCCESS",
        targetType: "jarvis",
        targetId: feature,
        metadata: { feature, inputChars: content.length },
      });
      res.json({ feature, output, aiGenerated: true, reviewRequired: true });
    } catch (error) {
      next(error);
    }
  });

  return router;
}
