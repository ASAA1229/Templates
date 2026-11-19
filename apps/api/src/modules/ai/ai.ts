import { Router } from "express";
import { z } from "zod";
import type { AppContext } from "../../context.js";
import { notEligible, validationFailed } from "../../lib/errors.js";
import { audit } from "../audit/audit.service.js";
import { authorize } from "../auth/policy.js";

/** Optional local AI assistance. Output is advisory; nothing is changed without the user applying it. */
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

export type AiFetch = typeof fetch;

export function aiStatus(ctx: AppContext) {
  const { AI_ENABLED, AI_PROVIDER, OLLAMA_URL, OLLAMA_MODEL, JARVIS_AI_URL } = ctx.config;
  return {
    enabled: AI_ENABLED,
    provider: AI_PROVIDER === "jarvis" ? "jarvis-local" : "ollama-local",
    endpoint: AI_ENABLED ? (AI_PROVIDER === "jarvis" ? JARVIS_AI_URL : OLLAMA_URL) : null,
    model: AI_PROVIDER === "jarvis" ? "jarvis" : OLLAMA_MODEL,
  };
}

export function aiRouter(ctx: AppContext, doFetch: AiFetch = fetch) {
  const router = Router();

  router.get("/status", authorize(ctx, "workspace:read"), async (req, res, next) => {
    try {
      const status = aiStatus(ctx);
      let reachable: boolean | null = null;
      if (status.enabled) {
        try {
          if (ctx.config.AI_PROVIDER === "jarvis") {
            const response = await doFetch(new URL("/v1/health", ctx.config.JARVIS_AI_URL), {
              headers: { "x-request-id": req.requestId },
              signal: AbortSignal.timeout(2000),
            });
            const body = response.ok ? ((await response.json()) as { modelConfigured?: unknown }) : null;
            reachable = body?.modelConfigured === true;
          } else {
            const response = await doFetch(new URL("/api/tags", ctx.config.OLLAMA_URL), {
              signal: AbortSignal.timeout(2000),
            });
            reachable = response.ok;
          }
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
          "AI assistance is turned off. An administrator can enable the configured local AI provider (AI_ENABLED).",
        );
      }
      const parsed = suggestSchema.safeParse(req.body);
      if (!parsed.success) throw validationFailed({ content: "Provide a task and 1 to 12000 characters of content." });
      const { task, content, fileName } = parsed.data;
      let text: string;
      try {
        const prompt = `${INSTRUCTIONS[task]}\n\n${fileName ? `File: ${fileName}\n` : ""}---\n${content}\n---`;
        const jarvis = ctx.config.AI_PROVIDER === "jarvis";
        const response = await doFetch(
          new URL(
            jarvis ? "/v1/chat/completions" : "/api/generate",
            jarvis ? ctx.config.JARVIS_AI_URL : ctx.config.OLLAMA_URL,
          ),
          {
            method: "POST",
            headers: {
              "content-type": "application/json",
              // req.requestId is the valid incoming X-Request-ID, or a freshly generated one (see requestId()).
              ...(jarvis ? { authorization: `Bearer ${ctx.config.JARVIS_AI_KEY}`, "x-request-id": req.requestId } : {}),
            },
            body: JSON.stringify(
              jarvis
                ? {
                    model: "jarvis",
                    stream: false,
                    messages: [
                      {
                        role: "system",
                        content: "You assist with software templates. Follow the user's task and be concise.",
                      },
                      { role: "user", content: prompt },
                    ],
                  }
                : { model: ctx.config.OLLAMA_MODEL, stream: false, prompt },
            ),
            signal: AbortSignal.timeout(ctx.config.AI_TIMEOUT_MS),
          },
        );
        if (!response.ok) throw new Error(`status ${response.status}`);
        const body = (await response.json()) as {
          response?: unknown;
          choices?: Array<{ message?: { content?: unknown } }>;
        };
        const generated = jarvis ? body.choices?.[0]?.message?.content : body.response;
        if (typeof generated !== "string") throw new Error("unexpected response");
        text = generated.trim().slice(0, 8000);
      } catch {
        throw notEligible(
          ctx.config.AI_PROVIDER === "jarvis"
            ? "The local JARVIS gateway did not respond. Check that it is running and its model is available."
            : "The local AI model did not respond. Check that Ollama is running and the model is pulled.",
        );
      }
      await audit(ctx, req, {
        action: "ai.suggest",
        outcome: "SUCCESS",
        targetType: "ai",
        targetId: task,
        metadata: {
          provider: ctx.config.AI_PROVIDER,
          model: ctx.config.AI_PROVIDER === "jarvis" ? "jarvis" : ctx.config.OLLAMA_MODEL,
          inputChars: content.length,
        },
      });
      res.json({
        task,
        model: ctx.config.AI_PROVIDER === "jarvis" ? "jarvis" : ctx.config.OLLAMA_MODEL,
        suggestion: text,
      });
    } catch (error) {
      next(error);
    }
  });

  return router;
}
