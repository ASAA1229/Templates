import {
  createTraceLinkSchema,
  EVIDENCE_STATUSES,
  fieldErrors,
  TRACE_KINDS,
  type RequirementVersionView,
  type RequirementView,
} from "@asaa/contracts";
import { ChevronDown, Flag, History, Link2, Pencil, Trash2 } from "lucide-react";
import { useState, type FormEvent } from "react";
import { Field, StatusBadge } from "@/components/common";
import { Alert, Badge, Button, Input, Select } from "@/components/ui";
import { ApiError, api } from "@/lib/api";
import { formatDateTime, humanize } from "@/lib/utils";
import { RequirementForm } from "./RequirementForm";

/** One requirement with editing, review flag, trace links and version history (US-C02/C04). */
export function RequirementCard({
  projectId,
  requirement,
  all,
  readOnly,
  onChange,
}: {
  projectId: string;
  requirement: RequirementView;
  all: RequirementView[];
  readOnly: boolean;
  onChange: (next: RequirementView) => void;
}) {
  const [mode, setMode] = useState<"view" | "edit" | "flag" | "link" | "history">("view");
  const [expanded, setExpanded] = useState(false);
  const [versions, setVersions] = useState<RequirementVersionView[] | null>(null);
  const [error, setError] = useState("");
  const base = `/projects/${projectId}/requirements/${requirement.id}`;
  const codeOf = (id: string) => all.find((item) => item.id === id)?.code ?? "unknown";

  async function run(action: () => Promise<{ requirement: RequirementView }>) {
    setError("");
    try {
      const result = await action();
      onChange(result.requirement);
      setMode("view");
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "Action failed.");
    }
  }

  async function showHistory() {
    setMode("history");
    try {
      const result = await api<{ versions: RequirementVersionView[] }>(base);
      setVersions(result.versions);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "Could not load history.");
    }
  }

  return (
    <li className="rounded-xl border bg-card">
      <div className="flex flex-wrap items-start gap-3 p-4">
        <button
          type="button"
          className="flex min-w-0 flex-1 items-start gap-2 text-left"
          aria-expanded={expanded}
          onClick={() => setExpanded(!expanded)}
        >
          <ChevronDown
            aria-hidden="true"
            className={`mt-1 size-4 shrink-0 transition-transform ${expanded ? "" : "-rotate-90"}`}
          />
          <span className="min-w-0">
            <span className="font-mono text-xs text-muted-foreground">{requirement.code}</span>
            <span className="block font-medium">{requirement.title}</span>
          </span>
        </button>
        <div className="flex flex-wrap items-center gap-1">
          <Badge>{requirement.priority}</Badge>
          <StatusBadge value={requirement.status} />
          {requirement.flaggedForReview && <Badge tone="warning">Needs review</Badge>}
          {requirement.missingVerification && <Badge tone="danger">No test evidence</Badge>}
        </div>
      </div>

      {expanded && (
        <div className="space-y-4 border-t p-4">
          {error && <Alert tone="danger">{error}</Alert>}
          {mode === "edit" ? (
            <RequirementForm
              initial={requirement}
              others={all}
              submitLabel="Save changes"
              onCancel={() => setMode("view")}
              onSubmit={async (input) => {
                const { kind: _kind, ...changes } = input;
                const result = await api<{ requirement: RequirementView }>(base, {
                  method: "PATCH",
                  body: { ...changes, expectedVersion: requirement.version },
                });
                onChange(result.requirement);
                setMode("view");
              }}
            />
          ) : (
            <>
              <p className="text-sm text-muted-foreground">{humanize(requirement.kind)}</p>
              {requirement.description && <p className="whitespace-pre-wrap text-sm">{requirement.description}</p>}
              {requirement.flaggedForReview && <Alert tone="warning">Flagged: {requirement.flagReason}</Alert>}
              <div>
                <h3 className="text-sm font-semibold">Acceptance criteria</h3>
                {requirement.acceptanceCriteria.length ? (
                  <ul className="mt-1 list-disc space-y-1 pl-5 text-sm">
                    {requirement.acceptanceCriteria.map((criterion, index) => (
                      <li key={index}>{criterion}</li>
                    ))}
                  </ul>
                ) : (
                  <p className="mt-1 text-sm text-muted-foreground">None recorded yet.</p>
                )}
              </div>
              {requirement.dependencyIds.length > 0 && (
                <p className="text-sm">
                  <span className="font-semibold">Depends on:</span> {requirement.dependencyIds.map(codeOf).join(", ")}
                </p>
              )}
              <div>
                <h3 className="text-sm font-semibold">Traceability</h3>
                {requirement.links.length === 0 ? (
                  <p className="mt-1 text-sm text-muted-foreground">No tasks, code, tests or releases linked.</p>
                ) : (
                  <ul className="mt-1 space-y-1">
                    {requirement.links.map((link) => (
                      <li key={link.id} className="flex flex-wrap items-center gap-2 text-sm">
                        <Badge tone="info">{humanize(link.kind)}</Badge>
                        <span className="break-all">{link.title || link.reference}</span>
                        <StatusBadge value={link.evidenceStatus} />
                        {!readOnly && (
                          <Button
                            variant="ghost"
                            size="sm"
                            aria-label={`Remove link ${link.reference}`}
                            onClick={() => void run(() => api(`${base}/links/${link.id}`, { method: "DELETE" }))}
                          >
                            <Trash2 aria-hidden="true" />
                          </Button>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              {mode === "flag" && (
                <FlagForm
                  onCancel={() => setMode("view")}
                  onSubmit={(reason) =>
                    run(() => api(`${base}/flag`, { method: "POST", body: { flagged: true, reason } }))
                  }
                />
              )}
              {mode === "link" && (
                <LinkForm
                  onCancel={() => setMode("view")}
                  onSubmit={(body) => run(() => api(`${base}/links`, { method: "POST", body }))}
                />
              )}
              {mode === "history" && (
                <div>
                  <h3 className="text-sm font-semibold">Version history</h3>
                  {!versions ? (
                    <p className="text-sm text-muted-foreground">Loading…</p>
                  ) : (
                    <ol className="mt-1 space-y-1 text-sm">
                      {versions.map((version) => (
                        <li key={version.version}>
                          v{version.version} · {formatDateTime(version.changedAt)}
                          {version.changeNote ? ` — ${version.changeNote}` : ""} · status{" "}
                          {humanize(String(version.snapshot.status ?? ""))}
                        </li>
                      ))}
                    </ol>
                  )}
                </div>
              )}

              <div className="flex flex-wrap gap-2">
                {!readOnly && (
                  <>
                    <Button variant="outline" size="sm" onClick={() => setMode("edit")}>
                      <Pencil aria-hidden="true" /> Edit
                    </Button>
                    {requirement.flaggedForReview ? (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() =>
                          void run(() => api(`${base}/flag`, { method: "POST", body: { flagged: false } }))
                        }
                      >
                        <Flag aria-hidden="true" /> Clear flag
                      </Button>
                    ) : (
                      <Button variant="outline" size="sm" onClick={() => setMode("flag")}>
                        <Flag aria-hidden="true" /> Flag for review
                      </Button>
                    )}
                    <Button variant="outline" size="sm" onClick={() => setMode("link")}>
                      <Link2 aria-hidden="true" /> Add trace link
                    </Button>
                  </>
                )}
                <Button variant="ghost" size="sm" onClick={() => void showHistory()}>
                  <History aria-hidden="true" /> History (v{requirement.version})
                </Button>
              </div>
            </>
          )}
        </div>
      )}
    </li>
  );
}

function FlagForm({ onSubmit, onCancel }: { onSubmit: (reason: string) => Promise<void>; onCancel: () => void }) {
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");
  return (
    <form
      noValidate
      className="space-y-2"
      onSubmit={(event: FormEvent) => {
        event.preventDefault();
        if (!reason.trim()) return setError("Explain what needs review.");
        void onSubmit(reason.trim());
      }}
    >
      <Field label="What is ambiguous or conflicting?" error={error}>
        <Input value={reason} maxLength={500} onChange={(event) => setReason(event.target.value)} />
      </Field>
      <div className="flex gap-2">
        <Button type="submit" size="sm">
          Flag
        </Button>
        <Button variant="outline" size="sm" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

function LinkForm({ onSubmit, onCancel }: { onSubmit: (body: unknown) => Promise<void>; onCancel: () => void }) {
  const [form, setForm] = useState({ kind: "TEST", reference: "", title: "", evidenceStatus: "PLANNED" });
  const [errors, setErrors] = useState<Record<string, string>>({});
  return (
    <form
      noValidate
      className="space-y-3"
      onSubmit={(event: FormEvent) => {
        event.preventDefault();
        const parsed = createTraceLinkSchema.safeParse({ ...form, title: form.title || undefined });
        if (!parsed.success) return setErrors(fieldErrors(parsed.error));
        setErrors({});
        void onSubmit(parsed.data);
      }}
    >
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Kind">
          <Select value={form.kind} onChange={(event) => setForm({ ...form, kind: event.target.value })}>
            {TRACE_KINDS.map((kind) => (
              <option key={kind} value={kind}>
                {humanize(kind)}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Reference" error={errors.reference} hint="Path, commit, URL or ticket id">
          <Input
            value={form.reference}
            maxLength={300}
            onChange={(event) => setForm({ ...form, reference: event.target.value })}
          />
        </Field>
        <Field label="Evidence">
          <Select
            value={form.evidenceStatus}
            onChange={(event) => setForm({ ...form, evidenceStatus: event.target.value })}
          >
            {EVIDENCE_STATUSES.map((status) => (
              <option key={status} value={status}>
                {humanize(status)}
              </option>
            ))}
          </Select>
        </Field>
      </div>
      <Field label="Title (optional)" error={errors.title}>
        <Input
          value={form.title}
          maxLength={200}
          onChange={(event) => setForm({ ...form, title: event.target.value })}
        />
      </Field>
      <div className="flex gap-2">
        <Button type="submit" size="sm">
          Add link
        </Button>
        <Button variant="outline" size="sm" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
