import type { CatalogItemView, TemplateSummaryView } from "@asaa/contracts";
import { CheckCircle2, ShieldCheck } from "lucide-react";
import { useState } from "react";
import { ErrorState, LoadingState } from "@/components/common";
import { Alert, Badge, Button, Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui";
import { ApiError, api } from "@/lib/api";
import { useResource } from "@/lib/hooks";

/**
 * Locally maintained template content (US-E01). Content becomes usable for
 * generation only after the owner approves it, which pins its digest in the catalog.
 */
export function TemplateLibraryPanel({ onApproved }: { onApproved: () => void }) {
  const library = useResource<{ templates: TemplateSummaryView[] }>("/templates/library");
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<{ tone: "success" | "danger"; text: string } | null>(null);

  async function approve(template: TemplateSummaryView) {
    setBusy(`${template.id}@${template.version}`);
    setMessage(null);
    try {
      const { item } = await api<{ item: CatalogItemView }>(
        `/templates/library/${template.id}/${template.version}/approve`,
        { method: "POST" },
      );
      setMessage({ tone: "success", text: `${item.title} v${item.version} is approved and active.` });
      library.reload();
      onApproved();
    } catch (error) {
      setMessage({ tone: "danger", text: error instanceof ApiError ? error.message : "Approval failed." });
    } finally {
      setBusy(null);
    }
  }

  const templates = library.data?.templates.filter((template) => template.kind !== "starter") ?? [];
  const starters = library.data?.templates.filter((template) => template.kind === "starter") ?? [];
  return (
    <Card className="mb-6">
      <CardHeader>
        <CardTitle>Local template library</CardTitle>
        <CardDescription>
          Template content maintained with the platform. Approve a version to add it to the catalog as an active,
          trusted template; any later change to its files requires approval again.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {library.state === "loading" && <LoadingState label="Loading template library" rows={1} />}
        {library.state === "error" && <ErrorState error={library.error} onRetry={library.reload} />}
        {message && <Alert tone={message.tone}>{message.text}</Alert>}
        {library.state === "ready" && templates.length === 0 && (
          <p className="text-sm text-muted-foreground">No templates are present in the local library.</p>
        )}
        {templates.length > 0 && (
          <ul className="divide-y rounded-lg border" aria-label="Library templates">
            {templates.map((template) => (
              <li
                key={`${template.id}@${template.version}`}
                className="flex flex-col gap-2 p-3 sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="min-w-0 space-y-1">
                  <p className="font-medium">
                    {template.title} <span className="text-sm text-muted-foreground">v{template.version}</span>
                  </p>
                  <div className="flex flex-wrap gap-1">
                    {template.valid ? (
                      <Badge tone={template.approved ? "success" : "neutral"}>
                        {template.approved ? "Approved" : "Not approved"}
                      </Badge>
                    ) : (
                      <Badge tone="danger">Invalid</Badge>
                    )}
                    <Badge>{template.license || "No license"}</Badge>
                    {template.technologies.map((tech) => (
                      <Badge key={tech.name} tone="info">
                        {tech.name} {tech.version}
                      </Badge>
                    ))}
                  </div>
                  {!template.valid && (
                    <ul className="list-disc pl-4 text-xs text-destructive">
                      {template.problems.slice(0, 5).map((problem) => (
                        <li key={problem}>{problem}</li>
                      ))}
                    </ul>
                  )}
                </div>
                {template.valid &&
                  (template.approved ? (
                    <span className="flex items-center gap-1 text-sm text-muted-foreground">
                      <CheckCircle2 aria-hidden="true" className="size-4" /> In catalog
                    </span>
                  ) : (
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={busy !== null}
                      aria-label={`${template.catalogItemId ? "Re-approve" : "Approve"} ${template.title} v${template.version} for project generation`}
                      onClick={() => void approve(template)}
                    >
                      <ShieldCheck aria-hidden="true" /> {template.catalogItemId ? "Re-approve" : "Approve"}
                    </Button>
                  ))}
              </li>
            ))}
          </ul>
        )}
        {starters.length > 0 && (
          <p className="text-xs text-muted-foreground">
            Platform starters for from-scratch projects: {starters.map((s) => `${s.title} v${s.version}`).join(", ")}.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
