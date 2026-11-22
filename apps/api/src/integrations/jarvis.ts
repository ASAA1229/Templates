import { JARVIS_FEATURES, type JarvisFeature } from "@asaa/contracts";
import type { AppConfig } from "../config/env.js";
import { notEligible } from "../lib/errors.js";

/**
 * Optional JARVIS mini-feature integration (D3.5). JARVIS runs as a separate local service; Templates only talks to
 * it through this interface. The integration is disabled unless JARVIS_FEATURES_ENABLED=true, only ever contacts the
 * configured local gateway origin, and every result is advisory text that a person must review.
 */
export interface JarvisClient {
  readonly enabled: boolean;
  readonly features: readonly JarvisFeature[];
  /** null when disabled; otherwise whether the gateway answers its health check with a configured model. */
  reachable(requestId: string): Promise<boolean | null>;
  invoke(feature: JarvisFeature, content: string, requestId: string): Promise<string>;
}

const FEATURE_PROMPTS: Record<JarvisFeature, string> = {
  "summarize-template":
    "Summarize the following software template in at most five bullet points for a catalogue entry. State what it generates and its main inputs. Do not invent facts that are not in the text.",
  "classify-template":
    "Suggest a catalogue category, a business sector and up to six lowercase tags for the following software template. Reply as three lines: 'category: ...', 'sector: ...', 'tags: a, b, c'. Use only what the text supports.",
  "review-assist":
    "List up to eight concrete review checks (security, licensing, secrets, compatibility, quality) a human reviewer should perform on the following template. Flag anything in the text that already looks risky. This is advisory only.",
};

export class DisabledJarvisClient implements JarvisClient {
  readonly enabled = false;
  readonly features = JARVIS_FEATURES;
  async reachable(): Promise<null> {
    return null;
  }
  async invoke(): Promise<string> {
    throw notEligible("JARVIS mini-features are turned off. An administrator can enable JARVIS_FEATURES_ENABLED.");
  }
}

export class HttpJarvisClient implements JarvisClient {
  readonly enabled = true;
  readonly features = JARVIS_FEATURES;
  constructor(
    private readonly baseUrl: string,
    private readonly siteKey: string,
    private readonly timeoutMs: number,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async reachable(requestId: string): Promise<boolean> {
    try {
      const response = await this.fetchImpl(new URL("/v1/health", this.baseUrl), {
        headers: { "x-request-id": requestId },
        signal: AbortSignal.timeout(2000),
      });
      const body = response.ok ? ((await response.json()) as { modelConfigured?: unknown }) : null;
      return body?.modelConfigured === true;
    } catch {
      return false;
    }
  }

  async invoke(feature: JarvisFeature, content: string, requestId: string): Promise<string> {
    try {
      const response = await this.fetchImpl(new URL("/v1/chat/completions", this.baseUrl), {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${this.siteKey}`,
          "x-request-id": requestId,
        },
        body: JSON.stringify({
          model: "jarvis",
          stream: false,
          messages: [
            { role: "system", content: "You assist with software templates. Be concise and factual." },
            { role: "user", content: `${FEATURE_PROMPTS[feature]}\n\n---\n${content.slice(0, 12_000)}\n---` },
          ],
        }),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
      if (!response.ok) throw new Error(`status ${response.status}`);
      const body = (await response.json()) as { choices?: Array<{ message?: { content?: unknown } }> };
      const text = body.choices?.[0]?.message?.content;
      if (typeof text !== "string" || !text.trim()) throw new Error("unexpected response");
      return text.trim().slice(0, 6000);
    } catch {
      throw notEligible("The local JARVIS gateway did not respond. Check that JARVIS is running.");
    }
  }
}

export function createJarvisClient(
  config: Pick<AppConfig, "JARVIS_FEATURES_ENABLED" | "JARVIS_AI_URL" | "JARVIS_AI_KEY" | "AI_TIMEOUT_MS">,
  fetchImpl?: typeof fetch,
): JarvisClient {
  if (!config.JARVIS_FEATURES_ENABLED) return new DisabledJarvisClient();
  return new HttpJarvisClient(config.JARVIS_AI_URL, config.JARVIS_AI_KEY ?? "", config.AI_TIMEOUT_MS, fetchImpl);
}
