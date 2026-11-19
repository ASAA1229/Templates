import type { TemplateReleaseView, TemplateSummaryView } from "@asaa/contracts";
import { useState, type FormEvent } from "react";
import { EmptyState, ErrorState, Field, LoadingState, PageHeader } from "@/components/common";
import {
  Alert,
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Input,
  Select,
} from "@/components/ui";
import { ApiError, api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useResource } from "@/lib/hooks";
import { formatDateTime } from "@/lib/utils";

const TONES = {
  DRAFT: "neutral",
  IN_REVIEW: "info",
  APPROVED: "info",
  RELEASED: "success",
  DEPRECATED: "warning",
} as const;

/**
 * Template release lifecycle (RG-06): draft, submit for review, approval by a second person, immutable
 * release, deprecation. Released versions can be pinned when starting a project.
 */
export function ReleasesPage() {
  const { owner } = useAuth();
  const canApprove = owner?.role === "OWNER" || owner?.role === "ADMIN";
  const releases = useResource<{ releases: TemplateReleaseView[] }>("/templates/releases");
  const library = useResource<{ templates: TemplateSummaryView[] }>("/templates/library");
  const [message, setMessage] = useState<{ tone: "success" | "danger"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [choice, setChoice] = useState("");
  const [notes, setNotes] = useState("");
  const [reason, setReason] = useState<Record<string, string>>({});

  async function act(label: string, task: () => Promise<unknown>) {
    setBusy(true);
    setMessage(null);
    try {
      await task();
      setMessage({ tone: "success", text: label });
      releases.reload();
    } catch (error) {
      setMessage({ tone: "danger", text: error instanceof ApiError ? error.message : "The action failed." });
    } finally {
      setBusy(false);
    }
  }

  const post = (path: string, body?: unknown) =>
    api(`/templates/releases${path}`, { method: "POST", body: body ?? {} });

  const createDraft = (event: FormEvent) => {
    event.preventDefault();
    const [templateId, version] = choice.split("@");
    if (!templateId || !version) return;
    void act(`Draft created for ${choice}.`, () => post("", { templateId, version, notes }));
  };

  const drafts =
    library.state === "ready"
      ? library.data.templates.filter((template) => template.valid && template.kind === "template")
      : [];
  const rows = releases.state === "ready" ? releases.data.releases : [];
  const released = rows.filter((row) => row.status === "RELEASED");

  return (
    <>
      <PageHeader
        title="Template releases"
        description="Move template versions from draft to an immutable release. Approval needs a second person unless the owner acts."
      />
      {message && (
        <Alert tone={message.tone} className="mb-4">
          {message.text}
        </Alert>
      )}
      <Card className="mb-6">
        <CardHeader>
          <CardTitle>Start a release draft</CardTitle>
          <CardDescription>The package must pass certification checks first.</CardDescription>
        </CardHeader>
        <CardContent>
          <form
            onSubmit={createDraft}
            aria-label="Create release draft"
            className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] sm:items-end"
          >
            <Field label="Template version">
              <Select value={choice} onChange={(event) => setChoice(event.target.value)} required>
                <option value="">Choose a template version</option>
                {drafts.map((template) => (
                  <option key={`${template.id}@${template.version}`} value={`${template.id}@${template.version}`}>
                    {template.title} {template.version}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Release notes">
              <Input value={notes} maxLength={500} onChange={(event) => setNotes(event.target.value)} />
            </Field>
            <Button type="submit" disabled={busy || !choice}>
              Create draft
            </Button>
          </form>
        </CardContent>
      </Card>

      {releases.state === "loading" && <LoadingState label="Loading releases…" />}
      {releases.state === "error" && <ErrorState error={releases.error} onRetry={releases.reload} />}
      {releases.state === "ready" && rows.length === 0 && (
        <EmptyState title="No releases yet" description="Create a draft from a library template version to begin." />
      )}
      {rows.length > 0 && (
        <ul aria-label="Releases" className="space-y-3">
          {rows.map((row) => {
            const name = `${row.templateId} ${row.version}`;
            const note = reason[row.id] ?? "";
            return (
              <li key={row.id}>
                <Card>
                  <CardContent className="space-y-3 pt-5">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <p className="font-medium">
                          {row.templateId} <span className="font-mono text-sm">{row.version}</span>
                        </p>
                        <p className="text-xs text-muted-foreground">
                          sha256 {row.contentDigest.slice(0, 12)} · created {formatDateTime(row.createdAt)}
                          {row.releasedAt ? ` · released ${formatDateTime(row.releasedAt)}` : ""}
                        </p>
                        {row.reviewNote && <p className="text-xs">Reviewer note: {row.reviewNote}</p>}
                        {row.deprecationReason && (
                          <p className="text-xs">
                            Deprecated: {row.deprecationReason}
                            {row.replacedByVersion ? ` (use ${row.replacedByVersion})` : ""}
                          </p>
                        )}
                      </div>
                      <Badge tone={TONES[row.status]}>{row.status.replace("_", " ").toLowerCase()}</Badge>
                    </div>
                    <div className="flex flex-wrap items-end gap-2">
                      {row.status === "DRAFT" && (
                        <Button
                          size="sm"
                          disabled={busy}
                          onClick={() => void act("Submitted for review.", () => post(`/${row.id}/submit`))}
                        >
                          Submit for review {name}
                        </Button>
                      )}
                      {row.status === "IN_REVIEW" && canApprove && (
                        <>
                          <Button
                            size="sm"
                            disabled={busy}
                            onClick={() => void act("Approved.", () => post(`/${row.id}/approve`, { note }))}
                          >
                            Approve {name}
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={busy || !note.trim()}
                            onClick={() => void act("Returned to draft.", () => post(`/${row.id}/reject`, { note }))}
                          >
                            Reject {name}
                          </Button>
                        </>
                      )}
                      {row.status === "APPROVED" && canApprove && (
                        <Button
                          size="sm"
                          disabled={busy}
                          onClick={() =>
                            void act("Released. This version is now immutable.", () => post(`/${row.id}/release`))
                          }
                        >
                          Release {name}
                        </Button>
                      )}
                      {row.status === "RELEASED" && canApprove && (
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={busy || !note.trim()}
                          onClick={() =>
                            void act("Deprecated.", () =>
                              post(`/${row.id}/deprecate`, {
                                reason: note,
                                replacedByVersion: released.find(
                                  (other) => other.templateId === row.templateId && other.id !== row.id,
                                )?.version,
                              }),
                            )
                          }
                        >
                          Deprecate {name}
                        </Button>
                      )}
                      {canApprove && (row.status === "IN_REVIEW" || row.status === "RELEASED") && (
                        <Field
                          label={
                            row.status === "RELEASED" ? `Deprecation reason for ${name}` : `Review note for ${name}`
                          }
                        >
                          <Input
                            value={note}
                            maxLength={500}
                            onChange={(event) => setReason({ ...reason, [row.id]: event.target.value })}
                          />
                        </Field>
                      )}
                    </div>
                  </CardContent>
                </Card>
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}
