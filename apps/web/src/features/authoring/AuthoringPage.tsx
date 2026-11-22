import type { DraftSummaryView } from "@asaa/contracts";
import { Bot, FilePlus2, Copy, Sparkles } from "lucide-react";
import { useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router";
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
import { formatDateTime } from "@/lib/utils";

type Mode = "blank" | "clone" | "ai";

/** Template authoring entry point: drafts you own, and ways to start a new one (D3.1, D3.4). */
export function AuthoringPage() {
  const navigate = useNavigate();
  const drafts = useResource<{ drafts: DraftSummaryView[] }>("/templates/authoring/drafts");
  const library = useResource<{
    templates: { id: string; version: string; title: string; kind: string | null; valid: boolean }[];
  }>("/templates/library");
  const ai = useResource<{ enabled: boolean; reachable: boolean | null; provider: string }>("/ai/status");
  const [mode, setMode] = useState<Mode>("blank");
  const [form, setForm] = useState({
    slug: "",
    title: "",
    category: "",
    description: "",
    brief: "",
    source: "",
    version: "0.1.0",
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const set = (key: keyof typeof form) => (event: { target: { value: string } }) =>
    setForm((current) => ({ ...current, [key]: event.target.value }));

  const aiReady = ai.state === "ready" && ai.data.enabled;

  async function create(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setErrors({});
    setMessage("");
    const [sourceId = "", sourceVersion = ""] = form.source.split("@");
    const body =
      mode === "blank"
        ? { mode, slug: form.slug, title: form.title, category: form.category, description: form.description }
        : mode === "clone"
          ? {
              mode,
              slug: form.slug,
              sourceId,
              sourceVersion,
              version: form.version,
              ...(form.title ? { title: form.title } : {}),
            }
          : { mode, slug: form.slug, category: form.category, brief: form.brief };
    try {
      const { draft } = await api<{ draft: DraftSummaryView }>("/templates/authoring/drafts", { method: "POST", body });
      void navigate(`/template-authoring/${draft.id}`);
    } catch (cause) {
      if (cause instanceof ApiError) {
        setErrors(cause.fields);
        setMessage(cause.message);
      } else setMessage("Could not create the draft.");
    } finally {
      setBusy(false);
    }
  }

  const modes: { id: Mode; label: string; icon: typeof FilePlus2; hint: string }[] = [
    {
      id: "blank",
      label: "From scratch",
      icon: FilePlus2,
      hint: "Start with a README and build the template yourself.",
    },
    { id: "clone", label: "Copy a template", icon: Copy, hint: "Start from a library template and adapt it." },
    {
      id: "ai",
      label: "AI-assisted",
      icon: Sparkles,
      hint: "Describe the template; the configured local AI drafts it. You must review every file.",
    },
  ];

  return (
    <>
      <PageHeader
        title="Template authoring"
        description="Create templates visually or in source. Drafts stay private and Draft until an authorized reviewer publishes them."
        breadcrumbs={[{ label: "Dashboard", to: "/" }, { label: "Template authoring" }]}
      />
      <div className="grid gap-6 lg:grid-cols-[1fr_24rem]">
        <section aria-labelledby="drafts-heading" className="space-y-3">
          <h2 id="drafts-heading" className="text-lg font-semibold">
            Drafts
          </h2>
          {drafts.state === "loading" && <LoadingState label="Loading drafts" rows={2} />}
          {drafts.state === "error" && <ErrorState error={drafts.error} onRetry={drafts.reload} />}
          {drafts.state === "ready" &&
            (drafts.data.drafts.length === 0 ? (
              <EmptyState title="No drafts yet" description="Start a new template with the form." />
            ) : (
              <ul className="space-y-3" aria-label="Template drafts">
                {drafts.data.drafts.map((draft) => (
                  <li key={draft.id}>
                    <Card>
                      <CardHeader className="flex flex-row items-start justify-between gap-3">
                        <div className="min-w-0">
                          <CardTitle className="truncate">
                            <Link className="hover:underline" to={`/template-authoring/${draft.id}`}>
                              {draft.title}
                            </Link>
                          </CardTitle>
                          <p className="mt-1 text-sm text-muted-foreground">
                            {draft.templateId} · v{draft.version} · {draft.category || "no category"} · updated{" "}
                            {formatDateTime(draft.updatedAt)}
                          </p>
                        </div>
                        <div className="flex flex-wrap items-center gap-2">
                          {draft.aiGenerated && (
                            <Badge tone="warning">
                              <Bot aria-hidden="true" className="size-3" /> AI-generated, review required
                            </Badge>
                          )}
                          <StatusBadge value={draft.status === "SUBMITTED" ? "UNDER_REVIEW" : "DRAFT"} />
                        </div>
                      </CardHeader>
                    </Card>
                  </li>
                ))}
              </ul>
            ))}
        </section>

        <Card className="h-fit">
          <CardHeader>
            <CardTitle>New draft</CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={create} className="space-y-3" noValidate>
              <div role="radiogroup" aria-label="How to start" className="grid gap-2">
                {modes.map(({ id, label, icon: Icon, hint }) => (
                  <label
                    key={id}
                    className={`flex cursor-pointer items-start gap-2 rounded-md border p-2 text-sm ${mode === id ? "border-primary bg-primary/5" : ""} ${id === "ai" && ai.state === "ready" && !aiReady ? "opacity-60" : ""}`}
                  >
                    <input
                      type="radio"
                      name="mode"
                      className="mt-1"
                      checked={mode === id}
                      onChange={() => setMode(id)}
                    />
                    <span>
                      <span className="flex items-center gap-1 font-medium">
                        <Icon aria-hidden="true" className="size-4" /> {label}
                      </span>
                      <span className="block text-xs text-muted-foreground">{hint}</span>
                    </span>
                  </label>
                ))}
              </div>
              {mode === "ai" && ai.state === "ready" && !aiReady && (
                <Alert tone="warning">
                  AI assistance is turned off. An administrator can enable a local AI provider.
                </Alert>
              )}
              <Field label="Template id" error={errors.slug} hint="Lowercase letters, digits and hyphens.">
                <Input value={form.slug} onChange={set("slug")} placeholder="clinic-booking-lite" />
              </Field>
              {mode !== "ai" && (
                <Field label={mode === "clone" ? "Title (optional)" : "Title"} error={errors.title}>
                  <Input value={form.title} onChange={set("title")} />
                </Field>
              )}
              {mode !== "clone" && (
                <Field label="Category" error={errors.category}>
                  <Input value={form.category} onChange={set("category")} placeholder="Retail" />
                </Field>
              )}
              {mode === "blank" && (
                <Field label="Description" error={errors.description}>
                  <Textarea value={form.description} onChange={set("description")} />
                </Field>
              )}
              {mode === "clone" && (
                <>
                  <Field label="Copy from" error={errors.sourceId ?? errors.sourceVersion}>
                    <Select value={form.source} onChange={set("source")}>
                      <option value="">Choose a template</option>
                      {library.state === "ready" &&
                        library.data.templates
                          .filter((template) => template.valid && template.kind === "template")
                          .map((template) => (
                            <option
                              key={`${template.id}@${template.version}`}
                              value={`${template.id}@${template.version}`}
                            >
                              {template.title} ({template.id}@{template.version})
                            </option>
                          ))}
                    </Select>
                  </Field>
                  <Field label="New version" error={errors.version}>
                    <Input value={form.version} onChange={set("version")} />
                  </Field>
                </>
              )}
              {mode === "ai" && (
                <Field
                  label="Brief"
                  error={errors.brief}
                  hint="What should the template generate? Do not include secrets."
                >
                  <Textarea value={form.brief} onChange={set("brief")} />
                </Field>
              )}
              {message && <Alert tone="danger">{message}</Alert>}
              <Button type="submit" disabled={busy || (mode === "ai" && !aiReady)}>
                {busy ? "Creating…" : "Create draft"}
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>
    </>
  );
}
