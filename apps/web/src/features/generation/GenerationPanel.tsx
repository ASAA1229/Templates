import type { GenerationVerificationView, GenerationView } from "@asaa/contracts";
import { RefreshCw, ShieldCheck } from "lucide-react";
import { useState } from "react";
import { StatusBadge } from "@/components/common";
import { Alert, Button, Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui";
import { ApiError, api } from "@/lib/api";
import { formatDateTime } from "@/lib/utils";

const short = (digest: string | null) => (digest ? `${digest.slice(0, 12)}…` : "—");

/** Generation provenance for a project: source, version, inputs, output and recovery actions. */
export function GenerationDetails({
  generation,
  onChanged,
}: {
  generation: GenerationView;
  onChanged: (generation: GenerationView) => void;
}) {
  const [busy, setBusy] = useState<"verify" | "retry" | null>(null);
  const [error, setError] = useState("");
  const [verification, setVerification] = useState<GenerationVerificationView | null>(null);

  async function run(action: "verify" | "retry") {
    setBusy(action);
    setError("");
    try {
      if (action === "verify") {
        const result = await api<{ verification: GenerationVerificationView }>(`/generations/${generation.id}/verify`, {
          method: "POST",
        });
        setVerification(result.verification);
      } else {
        const result = await api<{ generation: GenerationView }>(`/generations/${generation.id}/retry`, {
          method: "POST",
          body: { expectedVersion: generation.version },
        });
        onChanged(result.generation);
      }
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "The request failed.");
    } finally {
      setBusy(null);
    }
  }

  const inputs = Object.entries(generation.inputs);
  return (
    <div className="space-y-4">
      {generation.status === "FAILED" && (
        <Alert tone="danger">
          <strong className="block">Generation failed.</strong>
          {generation.error ?? "The output was not created."}
        </Alert>
      )}
      <dl className="grid grid-cols-[minmax(7rem,auto)_1fr] gap-x-4 gap-y-2 text-sm">
        <dt className="text-muted-foreground">Status</dt>
        <dd>
          <StatusBadge value={generation.status} />
        </dd>
        <dt className="text-muted-foreground">Started from</dt>
        <dd>{generation.mode === "TEMPLATE" ? "Template" : "Scratch (approved starter)"}</dd>
        <dt className="text-muted-foreground">Source</dt>
        <dd className="break-all">
          {generation.templateId}@{generation.templateVersion}
        </dd>
        <dt className="text-muted-foreground">Content digest</dt>
        <dd className="font-mono text-xs break-all" title={generation.templateDigest}>
          {short(generation.templateDigest)}
        </dd>
        <dt className="text-muted-foreground">Output folder</dt>
        <dd className="font-mono text-xs break-all">{generation.outputDir}</dd>
        <dt className="text-muted-foreground">Output digest</dt>
        <dd className="font-mono text-xs break-all" title={generation.outputDigest ?? undefined}>
          {short(generation.outputDigest)}
        </dd>
        <dt className="text-muted-foreground">Generator</dt>
        <dd>v{generation.generatorVersion}</dd>
        <dt className="text-muted-foreground">Started</dt>
        <dd>{formatDateTime(generation.startedAt)}</dd>
        <dt className="text-muted-foreground">Completed</dt>
        <dd>{generation.completedAt ? formatDateTime(generation.completedAt) : "—"}</dd>
        <dt className="text-muted-foreground">Attempts</dt>
        <dd>{generation.attempts}</dd>
      </dl>
      {inputs.length > 0 && (
        <details className="rounded-lg border p-3 text-sm">
          <summary className="cursor-pointer font-medium">Configuration ({inputs.length})</summary>
          <dl className="mt-2 grid grid-cols-[minmax(7rem,auto)_1fr] gap-x-4 gap-y-1">
            {inputs.map(([key, value]) => (
              <div key={key} className="contents">
                <dt className="text-muted-foreground">{key}</dt>
                <dd className="break-all">{String(value) || "—"}</dd>
              </div>
            ))}
          </dl>
        </details>
      )}
      {generation.files.length > 0 && (
        <details className="rounded-lg border p-3 text-sm">
          <summary className="cursor-pointer font-medium">Generated files ({generation.files.length})</summary>
          <ul className="mt-2 space-y-0.5 font-mono text-xs">
            {generation.files.map((file) => (
              <li key={file} className="break-all">
                {file}
              </li>
            ))}
          </ul>
        </details>
      )}
      {verification && (
        <Alert tone={verification.problems.length === 0 ? "success" : "warning"}>
          {verification.problems.length === 0 ? (
            "Verified: the recorded inputs reproduce the same files, and the output folder is unchanged."
          ) : (
            <ul className="list-disc space-y-1 pl-4">
              {verification.problems.map((problem) => (
                <li key={problem}>{problem}</li>
              ))}
            </ul>
          )}
        </Alert>
      )}
      {error && <Alert tone="danger">{error}</Alert>}
      <div className="flex flex-wrap gap-2">
        {generation.status === "SUCCEEDED" && (
          <Button variant="outline" size="sm" disabled={busy !== null} onClick={() => void run("verify")}>
            <ShieldCheck aria-hidden="true" /> {busy === "verify" ? "Verifying…" : "Verify reproducibility"}
          </Button>
        )}
        {generation.status === "FAILED" && (
          <Button size="sm" disabled={busy !== null} onClick={() => void run("retry")}>
            <RefreshCw aria-hidden="true" /> {busy === "retry" ? "Retrying…" : "Retry generation"}
          </Button>
        )}
      </div>
    </div>
  );
}

/** Card shown on the project page when the project was initialized by generation. */
export function GenerationCard({ generation, onChanged }: { generation: GenerationView; onChanged: () => void }) {
  const [current, setCurrent] = useState(generation);
  return (
    <Card>
      <CardHeader>
        <CardTitle>Generation provenance</CardTitle>
        <CardDescription>How this project&apos;s files were generated.</CardDescription>
      </CardHeader>
      <CardContent>
        <GenerationDetails
          generation={current.id === generation.id && current.version >= generation.version ? current : generation}
          onChanged={(next) => {
            setCurrent(next);
            onChanged();
          }}
        />
      </CardContent>
    </Card>
  );
}
