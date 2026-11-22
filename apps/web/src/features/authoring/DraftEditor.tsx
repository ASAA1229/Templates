import type { DraftView, JarvisFeature, JarvisStatusView, TemplateInput } from "@asaa/contracts";
import { Bot, Plus, Save, Send, Trash2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router";
import { EmptyState, ErrorState, Field, LoadingState, PageHeader, StatusBadge } from "@/components/common";
import {
  Alert,
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Input,
  Select,
  Textarea,
} from "@/components/ui";
import { ApiError, api } from "@/lib/api";
import { useResource } from "@/lib/hooks";

type Manifest = {
  title?: string;
  description?: string;
  category?: string;
  version?: string;
  license?: { spdx?: string };
  technologies?: { name: string; version: string }[];
  inputs?: TemplateInput[];
};

const INPUT_TYPES = ["string", "text", "boolean", "select"] as const;

/** Draft editor: visual configuration, source files and the raw manifest all edit the same validated draft (D3.2, D3.3). */
export function DraftEditor() {
  const { draftId = "" } = useParams();
  const navigate = useNavigate();
  const loaded = useResource<{ draft: DraftView }>(`/templates/authoring/drafts/${draftId}`);
  const [draft, setDraft] = useState<DraftView | null>(null);
  const [error, setError] = useState("");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (loaded.state === "ready") setDraft(loaded.data.draft);
  }, [loaded.state, loaded.data]);

  const run = useCallback(async <T,>(action: () => Promise<T>, done?: string): Promise<T | undefined> => {
    setBusy(true);
    setError("");
    setFieldErrors({});
    setNotice("");
    try {
      const result = await action();
      if (done) setNotice(done);
      return result;
    } catch (cause) {
      if (cause instanceof ApiError) {
        setError(cause.message);
        setFieldErrors(cause.fields);
      } else setError("Action failed.");
      return undefined;
    } finally {
      setBusy(false);
    }
  }, []);

  if (loaded.state === "loading" || !draft) {
    return loaded.state === "error" ? (
      loaded.error.status === 404 ? (
        <EmptyState title="Draft not found" description="It may have been discarded or belongs to another author." />
      ) : (
        <ErrorState error={loaded.error} onRetry={loaded.reload} />
      )
    ) : (
      <LoadingState label="Loading draft" />
    );
  }

  const manifest = (draft.manifest ?? {}) as Manifest;
  const locked = draft.status === "SUBMITTED";
  const base = `/templates/authoring/drafts/${draft.id}`;
  const apply = (next: DraftView | undefined) => next && setDraft(next);

  return (
    <>
      <PageHeader
        title={draft.title}
        description={`${draft.templateId} · v${draft.version} · revision ${draft.revision}`}
        breadcrumbs={[
          { label: "Dashboard", to: "/" },
          { label: "Template authoring", to: "/template-authoring" },
          { label: draft.templateId },
        ]}
        actions={<StatusBadge value={locked ? "UNDER_REVIEW" : "DRAFT"} />}
      />
      {error && (
        <Alert tone="danger" className="mb-4">
          {error}
        </Alert>
      )}
      {notice && (
        <Alert tone="success" className="mb-4">
          {notice}
        </Alert>
      )}
      {draft.aiGenerated && (
        <Alert tone="warning" className="mb-4">
          <Bot aria-hidden="true" className="mr-1 inline size-4" /> This draft contains AI-generated content (
          {draft.aiFiles.length} file{draft.aiFiles.length === 1 ? "" : "s"}). A person must read every file before it
          can be submitted, and a reviewer will see this flag.
        </Alert>
      )}
      {locked && (
        <Alert tone="info" className="mb-4">
          Submitted for review{draft.submissionId ? ` (${draft.submissionId})` : ""}. It becomes a library template only
          after an authorized reviewer approves it.
        </Alert>
      )}

      <div className="grid gap-6 xl:grid-cols-[1fr_22rem]">
        <div className="min-w-0 space-y-6">
          <MetadataForm
            key={`${draft.id}-${draft.revision}`}
            manifest={manifest}
            disabled={locked || busy}
            errors={fieldErrors}
            onSave={async (changes) =>
              apply(
                (
                  await run(
                    () =>
                      api<{ draft: DraftView }>(`${base}/metadata`, {
                        method: "PATCH",
                        body: { ...changes, expectedRevision: draft.revision },
                      }),
                    "Configuration saved.",
                  )
                )?.draft,
              )
            }
          />
          <SourceEditor
            draft={draft}
            disabled={locked || busy}
            onSave={async (filePath, content) =>
              apply(
                (
                  await run(
                    () =>
                      api<{ draft: DraftView }>(`${base}/file`, {
                        method: "PUT",
                        body: { path: filePath, content, expectedRevision: draft.revision },
                      }),
                    `Saved ${filePath}.`,
                  )
                )?.draft,
              )
            }
            onDelete={async (filePath) =>
              apply(
                (
                  await run(
                    () =>
                      api<{ draft: DraftView }>(`${base}/file/delete`, {
                        method: "POST",
                        body: { path: filePath, expectedRevision: draft.revision },
                      }),
                    `Removed ${filePath}.`,
                  )
                )?.draft,
              )
            }
          />
          <ManifestEditor
            key={`m-${draft.id}-${draft.revision}`}
            manifest={draft.manifest}
            disabled={locked || busy}
            onSave={async (value) =>
              apply(
                (
                  await run(
                    () =>
                      api<{ draft: DraftView }>(`${base}/manifest`, {
                        method: "PUT",
                        body: { manifest: value, expectedRevision: draft.revision },
                      }),
                    "Manifest saved.",
                  )
                )?.draft,
              )
            }
            onInvalid={(message) => setError(message)}
          />
        </div>

        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Validation</CardTitle>
            </CardHeader>
            <CardContent>
              {draft.problems.length === 0 ? (
                <p className="text-sm text-success">No problems. This draft can be submitted.</p>
              ) : (
                <ul className="list-disc space-y-1 pl-5 text-sm text-destructive" aria-label="Validation problems">
                  {draft.problems.map((problem) => (
                    <li key={problem}>{problem}</li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
          <JarvisAssist manifest={draft.manifest} />
          {!locked && (
            <SubmitCard
              draft={draft}
              busy={busy}
              onSubmit={async (confirmations) => {
                const result = await run(
                  () =>
                    api<{ draft: DraftView }>(`${base}/submit`, {
                      method: "POST",
                      body: { ...confirmations, expectedRevision: draft.revision },
                    }),
                  "Submitted for review.",
                );
                apply(result?.draft);
              }}
              onDiscard={async () => {
                if (!window.confirm("Discard this draft? This cannot be undone.")) return;
                const done = await run(() => api(base, { method: "DELETE" }).then(() => true));
                if (done) void navigate("/template-authoring");
              }}
            />
          )}
        </div>
      </div>
    </>
  );
}

function MetadataForm({
  manifest,
  disabled,
  errors,
  onSave,
}: {
  manifest: Manifest;
  disabled: boolean;
  errors: Record<string, string>;
  onSave: (changes: Record<string, unknown>) => Promise<void>;
}) {
  const [title, setTitle] = useState(manifest.title ?? "");
  const [description, setDescription] = useState(manifest.description ?? "");
  const [category, setCategory] = useState(manifest.category ?? "");
  const [version, setVersion] = useState(manifest.version ?? "");
  const [license, setLicense] = useState(manifest.license?.spdx ?? "");
  const [technologies, setTechnologies] = useState(
    (manifest.technologies ?? []).map((tech) => `${tech.name} ${tech.version}`).join("\n"),
  );
  const [inputs, setInputs] = useState<TemplateInput[]>(manifest.inputs ?? []);

  const updateInput = (index: number, patch: Record<string, unknown>) =>
    setInputs((current) =>
      current.map((input, i) => (i === index ? ({ ...input, ...patch } as TemplateInput) : input)),
    );

  function save() {
    const techs = technologies
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        const at = line.lastIndexOf(" ");
        return at > 0
          ? { name: line.slice(0, at).trim(), version: line.slice(at + 1).trim() }
          : { name: line, version: "1" };
      });
    void onSave({ title, description, category, version, license, technologies: techs, inputs });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Configuration</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Title" error={errors.title}>
            <Input value={title} disabled={disabled} onChange={(event) => setTitle(event.target.value)} />
          </Field>
          <Field label="Category" error={errors.category}>
            <Input value={category} disabled={disabled} onChange={(event) => setCategory(event.target.value)} />
          </Field>
          <Field label="Version" error={errors.version}>
            <Input value={version} disabled={disabled} onChange={(event) => setVersion(event.target.value)} />
          </Field>
          <Field label="License (SPDX)" error={errors.license}>
            <Input value={license} disabled={disabled} onChange={(event) => setLicense(event.target.value)} />
          </Field>
        </div>
        <Field label="Description" error={errors.description}>
          <Textarea value={description} disabled={disabled} onChange={(event) => setDescription(event.target.value)} />
        </Field>
        <Field
          label="Technologies"
          error={errors.technologies}
          hint="One per line: name and version, for example “React 19”."
        >
          <Textarea
            value={technologies}
            disabled={disabled}
            onChange={(event) => setTechnologies(event.target.value)}
          />
        </Field>

        <fieldset className="space-y-3">
          <legend className="text-sm font-semibold">Inputs (asked when a project is generated)</legend>
          {errors.inputs && <p className="text-xs text-destructive">{errors.inputs}</p>}
          {inputs.map((input, index) => (
            <div key={index} className="grid gap-2 rounded-md border p-3 sm:grid-cols-[1fr_1fr_8rem_auto]">
              <Input
                aria-label={`Input ${index + 1} id`}
                placeholder="id (for example siteName)"
                value={input.id}
                disabled={disabled}
                onChange={(event) => updateInput(index, { id: event.target.value })}
              />
              <Input
                aria-label={`Input ${index + 1} label`}
                placeholder="Label"
                value={input.label}
                disabled={disabled}
                onChange={(event) => updateInput(index, { label: event.target.value })}
              />
              <Select
                aria-label={`Input ${index + 1} type`}
                value={input.type}
                disabled={disabled}
                onChange={(event) => {
                  const type = event.target.value as TemplateInput["type"];
                  const common = { id: input.id, label: input.label, required: input.required };
                  setInputs((current) =>
                    current.map((entry, i) =>
                      i !== index
                        ? entry
                        : type === "select"
                          ? ({ ...common, type, options: [{ value: "option1", label: "Option 1" }] } as TemplateInput)
                          : type === "boolean"
                            ? ({ ...common, type } as TemplateInput)
                            : type === "text"
                              ? ({ ...common, type, maxLength: 500 } as TemplateInput)
                              : ({ ...common, type, format: "text", maxLength: 80 } as TemplateInput),
                    ),
                  );
                }}
              >
                {INPUT_TYPES.map((type) => (
                  <option key={type} value={type}>
                    {type}
                  </option>
                ))}
              </Select>
              <Button
                variant="ghost"
                size="icon"
                aria-label={`Remove input ${index + 1}`}
                disabled={disabled}
                onClick={() => setInputs((current) => current.filter((_, i) => i !== index))}
              >
                <Trash2 aria-hidden="true" />
              </Button>
              <label className="flex items-center gap-2 text-xs sm:col-span-2">
                <input
                  type="checkbox"
                  checked={input.required}
                  disabled={disabled}
                  onChange={(event) => updateInput(index, { required: event.target.checked })}
                />
                Required
              </label>
              {input.type === "select" && (
                <Input
                  className="sm:col-span-2"
                  aria-label={`Input ${index + 1} options`}
                  placeholder="Options: value:Label, value:Label"
                  disabled={disabled}
                  defaultValue={input.options.map((option) => `${option.value}:${option.label}`).join(", ")}
                  onBlur={(event) =>
                    updateInput(index, {
                      options: event.target.value
                        .split(",")
                        .map((part) => part.trim())
                        .filter(Boolean)
                        .map((part) => {
                          const [value = "", ...label] = part.split(":");
                          return { value: value.trim(), label: label.join(":").trim() || value.trim() };
                        }),
                    })
                  }
                />
              )}
            </div>
          ))}
          <Button
            variant="outline"
            size="sm"
            disabled={disabled || inputs.length >= 30}
            onClick={() =>
              setInputs((current) => [
                ...current,
                { id: "", label: "", type: "string", required: false, format: "text", maxLength: 80 } as TemplateInput,
              ])
            }
          >
            <Plus aria-hidden="true" /> Add input
          </Button>
        </fieldset>
        <Button disabled={disabled} onClick={save}>
          <Save aria-hidden="true" /> Save configuration
        </Button>
      </CardContent>
    </Card>
  );
}

function SourceEditor({
  draft,
  disabled,
  onSave,
  onDelete,
}: {
  draft: DraftView;
  disabled: boolean;
  onSave: (path: string, content: string) => Promise<void>;
  onDelete: (path: string) => Promise<void>;
}) {
  const [selected, setSelected] = useState("");
  const [content, setContent] = useState("");
  const [newPath, setNewPath] = useState("");
  const [loadError, setLoadError] = useState("");
  const aiFiles = new Set(draft.aiFiles);

  async function open(filePath: string) {
    setSelected(filePath);
    setLoadError("");
    try {
      const { file } = await api<{ file: { content: string } }>(
        `/templates/authoring/drafts/${draft.id}/file?path=${encodeURIComponent(filePath)}`,
      );
      setContent(file.content);
    } catch (cause) {
      setContent("");
      setLoadError(cause instanceof ApiError ? cause.message : "Could not open the file.");
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Source files</CardTitle>
      </CardHeader>
      <CardContent className="grid gap-4 md:grid-cols-[14rem_1fr]">
        <div className="space-y-2">
          <ul className="max-h-72 space-y-1 overflow-auto text-sm" aria-label="Draft files">
            {draft.files.map((file) => (
              <li key={file.path}>
                <button
                  type="button"
                  className={`flex w-full items-center justify-between gap-2 rounded px-2 py-1 text-left hover:bg-accent ${selected === file.path ? "bg-accent" : ""}`}
                  onClick={() => void open(file.path)}
                >
                  <span className="truncate">{file.path}</span>
                  {aiFiles.has(file.path) && <Badge tone="warning">AI</Badge>}
                </button>
              </li>
            ))}
          </ul>
          <div className="flex gap-2">
            <Input
              aria-label="New file path"
              placeholder="src/new-file.txt"
              value={newPath}
              disabled={disabled}
              onChange={(event) => setNewPath(event.target.value)}
            />
            <Button
              variant="outline"
              size="icon"
              aria-label="Add file"
              disabled={disabled || !newPath.trim()}
              onClick={() => {
                const next = newPath.trim();
                setSelected(next);
                setContent("");
                setNewPath("");
              }}
            >
              <Plus aria-hidden="true" />
            </Button>
          </div>
        </div>
        <div className="min-w-0 space-y-2">
          {selected ? (
            <>
              <p className="truncate text-sm font-medium">{selected}</p>
              {loadError && <Alert tone="danger">{loadError}</Alert>}
              <Textarea
                aria-label={`Content of ${selected}`}
                className="min-h-64 font-mono text-xs"
                value={content}
                spellCheck={false}
                disabled={disabled}
                onChange={(event) => setContent(event.target.value)}
              />
              <div className="flex gap-2">
                <Button size="sm" disabled={disabled} onClick={() => void onSave(selected, content)}>
                  <Save aria-hidden="true" /> Save file
                </Button>
                {draft.files.some((file) => file.path === selected) && (
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={disabled}
                    onClick={() => void onDelete(selected).then(() => setSelected(""))}
                  >
                    <Trash2 aria-hidden="true" /> Remove
                  </Button>
                )}
              </div>
              <p className="text-xs text-muted-foreground">
                Use {"{{projectName}}"}, {"{{projectKey}}"}, {"{{projectSlug}}"}, {"{{projectPurpose}}"} or your own
                inputs as placeholders.
              </p>
            </>
          ) : (
            <p className="text-sm text-muted-foreground">Choose a file to edit, or add a new one.</p>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function ManifestEditor({
  manifest,
  disabled,
  onSave,
  onInvalid,
}: {
  manifest: unknown;
  disabled: boolean;
  onSave: (value: unknown) => Promise<void>;
  onInvalid: (message: string) => void;
}) {
  const [text, setText] = useState(JSON.stringify(manifest, null, 2));
  return (
    <Card>
      <CardHeader>
        <CardTitle>Advanced: manifest (JSON)</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        <Textarea
          aria-label="Manifest JSON"
          className="min-h-64 font-mono text-xs"
          value={text}
          spellCheck={false}
          disabled={disabled}
          onChange={(event) => setText(event.target.value)}
        />
        <Button
          size="sm"
          variant="outline"
          disabled={disabled}
          onClick={() => {
            try {
              void onSave(JSON.parse(text));
            } catch {
              onInvalid("The manifest is not valid JSON.");
            }
          }}
        >
          <Save aria-hidden="true" /> Save manifest
        </Button>
        <p className="text-xs text-muted-foreground">
          Visual and source edits use the same manifest, so changes here appear in the configuration form after saving.
        </p>
      </CardContent>
    </Card>
  );
}

const JARVIS_LABELS: Record<JarvisFeature, string> = {
  "summarize-template": "Summarize",
  "classify-template": "Suggest classification",
  "review-assist": "Review checklist",
};

/** Optional JARVIS mini-features; the card hides itself when JARVIS is disabled (D3.5). */
function JarvisAssist({ manifest }: { manifest: unknown }) {
  const status = useResource<{ status: JarvisStatusView }>("/jarvis/status");
  const [output, setOutput] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  if (status.state !== "ready" || !status.data.status.enabled) return null;

  async function invoke(feature: JarvisFeature) {
    setBusy(true);
    setError("");
    try {
      const result = await api<{ output: string }>("/jarvis/invoke", {
        method: "POST",
        body: { feature, content: JSON.stringify(manifest).slice(0, 12_000) },
      });
      setOutput(result.output);
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : "JARVIS did not answer.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>JARVIS assist</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        <div className="flex flex-wrap gap-2">
          {status.data.status.features.map((feature) => (
            <Button key={feature} size="sm" variant="outline" disabled={busy} onClick={() => void invoke(feature)}>
              {JARVIS_LABELS[feature]}
            </Button>
          ))}
        </div>
        {status.data.status.reachable === false && <Alert tone="warning">JARVIS is not reachable right now.</Alert>}
        {error && <Alert tone="danger">{error}</Alert>}
        {output && (
          <div>
            <Badge tone="warning">AI-generated, advisory</Badge>
            <p className="mt-2 whitespace-pre-wrap text-sm">{output}</p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function SubmitCard({
  draft,
  busy,
  onSubmit,
  onDiscard,
}: {
  draft: DraftView;
  busy: boolean;
  onSubmit: (confirmations: Record<string, boolean>) => Promise<void>;
  onDiscard: () => Promise<void>;
}) {
  const [customerPermission, setCustomerPermission] = useState(false);
  const [rightsConfirmed, setRightsConfirmed] = useState(false);
  const [secretsChecked, setSecretsChecked] = useState(false);
  const [aiReviewed, setAiReviewed] = useState(false);
  const ready =
    customerPermission &&
    rightsConfirmed &&
    secretsChecked &&
    (!draft.aiGenerated || aiReviewed) &&
    draft.problems.length === 0;
  const box = (label: string, checked: boolean, set: (value: boolean) => void) => (
    <label className="flex items-start gap-2 text-xs">
      <input type="checkbox" className="mt-0.5" checked={checked} onChange={(event) => set(event.target.checked)} />
      {label}
    </label>
  );
  return (
    <Card>
      <CardHeader>
        <CardTitle>Submit for review</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {box(
          "No customer-owned material is included, or I have the customer's permission.",
          customerPermission,
          setCustomerPermission,
        )}
        {box("I have the rights to contribute this work.", rightsConfirmed, setRightsConfirmed)}
        {box("I checked the files for secrets and private data.", secretsChecked, setSecretsChecked)}
        {draft.aiGenerated &&
          box(
            "A person (me) has read every AI-generated file and takes responsibility for it.",
            aiReviewed,
            setAiReviewed,
          )}
        <div className="flex flex-wrap gap-2 pt-1">
          <Button
            disabled={!ready || busy}
            onClick={() => void onSubmit({ customerPermission, rightsConfirmed, secretsChecked, aiReviewed })}
          >
            <Send aria-hidden="true" /> Submit
          </Button>
          <Button variant="outline" disabled={busy} onClick={() => void onDiscard()}>
            Discard draft
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          The template stays a draft until an authorized reviewer publishes it.
        </p>
      </CardContent>
    </Card>
  );
}
