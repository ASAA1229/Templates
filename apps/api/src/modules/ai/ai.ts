import { Router } from "express";
import { z } from "zod";
import type { AppContext } from "../../context.js";
import { notEligible, validationFailed } from "../../lib/errors.js";
import { audit } from "../audit/audit.service.js";
import { authorize } from "../auth/policy.js";

/**
 * Optional AI assistance (TMP-E07). Off by default. When AI_ENABLED=true it talks only to a local Ollama
 * server on a loopback address (enforced in config), so no prompt or project content leaves the machine and no
 * paid API is involved. Output is advisory text; nothing is written to a project without the user applying it.
 */
const suggestSchema = z
  .object({
    task: z.enum(["explain", "improve", "scaffold-notes", "commit-message"]),
    /** Optional file name for context; content is capped to keep local models responsive. */
    fileName: z.string().max(200).optional(),
    content: z.string().min(1).max(12_000),
  })
  .strict();

const INSTRUCTIONS: Record<z.infer<typeof suggestSchema>["task"], string> = {
  explain: "Explain briefly what the following file does and note anything risky.",
  improve: "Suggest concrete, minimal improvements to the following file as a short bullet list. Do not rewrite it.",
  "scaffold-notes": "Draft short implementation notes (bullets) for the following requirement text.",
  "commit-message": "Write one conventional-commit style subject line (max 72 chars) for the following diff.",
};

export type OllamaFetch = typeof fetch;

export function aiStatus(ctx: AppContext) {
  const { AI_ENABLED, OLLAMA_URL, OLLAMA_MODEL } = ctx.config;
  return {
    enabled: AI_ENABLED,
    provider: "ollama-local",
    endpoint: AI_ENABLED ? OLLAMA_URL : null,
    model: OLLAMA_MODEL,
  };
}

export function aiRouter(ctx: AppContext, doFetch: OllamaFetch = fetch) {
  const router = Router();

  router.get("/status", authorize(ctx, "workspace:read"), async (_req, res, next) => {
    try {
      const status = aiStatus(ctx);
      let reachable: boolean | null = null;
      if (status.enabled) {
        try {
          const response = await doFetch(new URL("/api/tags", ctx.config.OLLAMA_URL), {
            signal: AbortSignal.timeout(2000),
          });
          reachable = response.ok;
        } catch {
          reachable = false;
        }
      }
      res.json({ ...status, reachable });
    } catch (error) {
      next(error);
    }
  });

  router.post("/suggest", authorize(ctx, "workspace:write"), async (req, res, next) => {
    try {
      if (!ctx.config.AI_ENABLED) {
        throw notEligible(
          "AI assistance is turned off. An administrator can enable a local Ollama server (AI_ENABLED).",
        );
      }
      const parsed = suggestSchema.safeParse(req.body);
      if (!parsed.success) throw validationFailed({ content: "Provide a task and 1 to 12000 characters of content." });
      const { task, content, fileName } = parsed.data;
      let text: string;
      try {
        const response = await doFetch(new URL("/api/generate", ctx.config.OLLAMA_URL), {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            model: ctx.config.OLLAMA_MODEL,
            stream: false,
            prompt: `${INSTRUCTIONS[task]}\n\n${fileName ? `File: ${fileName}\n` : ""}---\n${content}\n---`,
          }),
          signal: AbortSignal.timeout(ctx.config.AI_TIMEOUT_MS),
        });
        if (!response.ok) throw new Error(`status ${response.status}`);
        const body = (await response.json()) as { response?: unknown };
        if (typeof body.response !== "string") throw new Error("unexpected response");
        text = body.response.trim().slice(0, 8000);
      } catch {
        throw notEligible("The local AI model did not respond. Check that Ollama is running and the model is pulled.");
      }
      await audit(ctx, req, {
        action: "ai.suggest",
        outcome: "SUCCESS",
        targetType: "ai",
        targetId: task,
        metadata: { model: ctx.config.OLLAMA_MODEL, inputChars: content.length },
      });
      res.json({ task, model: ctx.config.OLLAMA_MODEL, suggestion: text });
    } catch (error) {
      next(error);
    }
  });

  return router;
}
