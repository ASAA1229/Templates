import type { ReleaseComparisonView, TemplateReleaseView } from "@asaa/contracts";
import { useState, type FormEvent } from "react";
import { Field } from "@/components/common";
import { Alert, Button, Card, CardContent, CardDescription, CardHeader, CardTitle, Select } from "@/components/ui";
import { ApiError, api } from "@/lib/api";

function Changes({ label, values }: { label: string; values: { added: string[]; removed: string[] } }) {
  if (!values.added.length && !values.removed.length) return null;
  return (
    <li>
      <span className="font-medium">{label}:</span>{" "}
      {values.added.map((item) => (
        <span key={`+${item}`} className="mr-2 text-success">
          + {item}
        </span>
      ))}
      {values.removed.map((item) => (
        <span key={`-${item}`} className="mr-2 text-destructive">
          − {item}
        </span>
      ))}
    </li>
  );
}

/** Compare two recorded versions of one template from the release ledger (D3.10). */
export function ReleaseCompare({ releases }: { releases: TemplateReleaseView[] }) {
  const [templateId, setTemplateId] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [result, setResult] = useState<ReleaseComparisonView | null>(null);
  const [error, setError] = useState("");

  const comparable = [...new Set(releases.map((row) => row.templateId))].filter(
    (id) => releases.filter((row) => row.templateId === id).length > 1,
  );
  const versions = releases.filter((row) => row.templateId === templateId).map((row) => row.version);

  async function compare(event: FormEvent) {
    event.preventDefault();
    setError("");
    setResult(null);
    try {
      const query = new URLSearchParams({ templateId, from, to });
      setResult((await api<{ comparison: ReleaseComparisonView }>(`/templates/releases/compare?${query}`)).comparison);
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : "Could not compare these versions.");
    }
  }

  if (comparable.length === 0) return null;
  const changes = result?.changes;
  const nothing =
    changes &&
    !changes.fields.length &&
    ![changes.inputs, changes.files, changes.technologies, changes.dependencies].some(
      (entry) => entry.added.length || entry.removed.length,
    );

  return (
    <Card className="mb-6">
      <CardHeader>
        <CardTitle>Compare versions</CardTitle>
        <CardDescription>See what changed between two recorded versions of a template.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <form
          onSubmit={compare}
          aria-label="Compare versions"
          className="grid gap-3 sm:grid-cols-[repeat(3,minmax(0,1fr))_auto] sm:items-end"
        >
          <Field label="Template">
            <Select
              value={templateId}
              onChange={(event) => {
                setTemplateId(event.target.value);
                setFrom("");
                setTo("");
              }}
            >
              <option value="">Choose a template</option>
              {comparable.map((id) => (
                <option key={id} value={id}>
                  {id}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="From version">
            <Select value={from} onChange={(event) => setFrom(event.target.value)}>
              <option value="">Choose</option>
              {versions.map((version) => (
                <option key={version} value={version}>
                  {version}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="To version">
            <Select value={to} onChange={(event) => setTo(event.target.value)}>
              <option value="">Choose</option>
              {versions.map((version) => (
                <option key={version} value={version}>
                  {version}
                </option>
              ))}
            </Select>
          </Field>
          <Button type="submit" variant="outline" disabled={!templateId || !from || !to || from === to}>
            Compare
          </Button>
        </form>
        {error && <Alert tone="danger">{error}</Alert>}
        {result && changes && (
          <div aria-label="Comparison result" className="text-sm">
            <p className="mb-2 text-xs text-muted-foreground">
              {result.from.version} ({result.from.status.toLowerCase()}) to {result.to.version} (
              {result.to.status.toLowerCase()})
            </p>
            {nothing ? (
              <p>The manifests are identical.</p>
            ) : (
              <ul className="space-y-1">
                {changes.fields.map((field) => (
                  <li key={field.field}>
                    <span className="font-medium">{field.field}:</span> “{field.from}” → “{field.to}”
                  </li>
                ))}
                <Changes label="Inputs" values={changes.inputs} />
                <Changes label="Files" values={changes.files} />
                <Changes label="Technologies" values={changes.technologies} />
                <Changes label="Dependencies" values={changes.dependencies} />
              </ul>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
