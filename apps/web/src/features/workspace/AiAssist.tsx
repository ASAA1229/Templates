import { Sparkles } from "lucide-react";
import { useState } from "react";
import { Alert, Button } from "@/components/ui";
import { ApiError, api } from "@/lib/api";
import { useResource } from "@/lib/hooks";

interface AiStatus {
  enabled: boolean;
  model: string;
  reachable: boolean | null;
}

/**
 * Optional, local-only AI assistance (Ollama on this machine). Off by default; suggestions are shown as text and
 * are never applied to a file automatically.
 */
export function AiAssist({ fileName, content }: { fileName: string; content: string }) {
  const status = useResource<AiStatus>("/ai/status");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ tone: "info" | "danger"; text: string } | null>(null);

  if (status.state !== "ready") return null;
  if (!status.data.enabled) {
    return (
      <p className="text-xs text-muted-foreground">
        AI assistance is off (optional, local Ollama only; an administrator enables it with AI_ENABLED).
      </p>
    );
  }

  async function ask(task: "explain" | "improve") {
    setBusy(true);
    setResult(null);
    try {
      const response = await api<{ suggestion: string }>("/ai/suggest", {
        method: "POST",
        body: { task, fileName, content: content.slice(0, 12_000) },
      });
      setResult({ tone: "info", text: response.suggestion });
    } catch (error) {
      setResult({ tone: "danger", text: error instanceof ApiError ? error.message : "The AI request failed." });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="outline" size="sm" disabled={busy || !content} onClick={() => void ask("explain")}>
          <Sparkles aria-hidden="true" /> Explain with local AI
        </Button>
        <Button variant="outline" size="sm" disabled={busy || !content} onClick={() => void ask("improve")}>
          Suggest improvements
        </Button>
        <span className="text-xs text-muted-foreground">
          Runs on this machine ({status.data.model}); nothing is applied automatically.
          {status.data.reachable === false ? " The local model server is not reachable." : ""}
        </span>
      </div>
      {result && (
        <Alert tone={result.tone}>
          <span className="whitespace-pre-wrap">{result.text}</span>
        </Alert>
      )}
    </div>
  );
}
