import {
  createRequirementSchema,
  fieldErrors,
  PRIORITIES,
  REQUIREMENT_KINDS,
  REQUIREMENT_STATUSES,
  type CreateRequirementInput,
  type RequirementView,
} from "@asaa/contracts";
import { useState, type FormEvent } from "react";
import { Field } from "@/components/common";
import { Alert, Button, Input, Select, Textarea } from "@/components/ui";
import { ApiError } from "@/lib/api";
import { humanize } from "@/lib/utils";

/**
 * Requirement / user-story editor (US-C02). Acceptance criteria are entered one per
 * line; dependencies are chosen from the same project's requirements only.
 */
export function RequirementForm({
  initial,
  others,
  submitLabel,
  onSubmit,
  onCancel,
}: {
  initial?: RequirementView;
  others: RequirementView[];
  submitLabel: string;
  onSubmit: (input: CreateRequirementInput & { changeNote?: string }) => Promise<void>;
  onCancel?: () => void;
}) {
  const [form, setForm] = useState({
    kind: initial?.kind ?? "USER_STORY",
    title: initial?.title ?? "",
    description: initial?.description ?? "",
    priority: initial?.priority ?? "P1",
    status: initial?.status ?? "DRAFT",
    criteria: (initial?.acceptanceCriteria ?? []).join("\n"),
    dependencyIds: initial?.dependencyIds ?? [],
    changeNote: "",
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [message, setMessage] = useState("");
  const [pending, setPending] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setMessage("");
    const candidate = {
      kind: form.kind,
      title: form.title,
      description: form.description,
      priority: form.priority,
      status: form.status,
      acceptanceCriteria: form.criteria
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean),
      dependencyIds: form.dependencyIds,
    };
    const parsed = createRequirementSchema.safeParse(candidate);
    if (!parsed.success) {
      setErrors(fieldErrors(parsed.error));
      return;
    }
    setErrors({});
    setPending(true);
    try {
      await onSubmit({ ...parsed.data, ...(form.changeNote.trim() ? { changeNote: form.changeNote.trim() } : {}) });
    } catch (error) {
      if (error instanceof ApiError) {
        setErrors(error.fields);
        setMessage(error.message);
      } else setMessage("Could not save the requirement.");
    } finally {
      setPending(false);
    }
  }

  const candidates = others.filter((item) => item.id !== initial?.id);

  return (
    <form noValidate onSubmit={submit} className="space-y-4" aria-label={submitLabel}>
      {message && <Alert tone="danger">{message}</Alert>}
      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="Type" error={errors.kind}>
          <Select
            value={form.kind}
            disabled={Boolean(initial)}
            onChange={(event) => setForm({ ...form, kind: event.target.value as typeof form.kind })}
          >
            {REQUIREMENT_KINDS.map((value) => (
              <option key={value} value={value}>
                {humanize(value)}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Priority" error={errors.priority}>
          <Select
            value={form.priority}
            onChange={(event) => setForm({ ...form, priority: event.target.value as typeof form.priority })}
          >
            {PRIORITIES.map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Status" error={errors.status}>
          <Select
            value={form.status}
            onChange={(event) => setForm({ ...form, status: event.target.value as typeof form.status })}
          >
            {REQUIREMENT_STATUSES.map((value) => (
              <option key={value} value={value}>
                {humanize(value)}
              </option>
            ))}
          </Select>
        </Field>
      </div>
      <Field label="Title" error={errors.title}>
        <Input
          value={form.title}
          maxLength={200}
          onChange={(event) => setForm({ ...form, title: event.target.value })}
        />
      </Field>
      <Field label="Description" error={errors.description}>
        <Textarea
          value={form.description}
          maxLength={5000}
          onChange={(event) => setForm({ ...form, description: event.target.value })}
        />
      </Field>
      <Field
        label="Acceptance criteria"
        hint="One criterion per line."
        error={
          errors.acceptanceCriteria ??
          Object.entries(errors).find(([key]) => key.startsWith("acceptanceCriteria."))?.[1]
        }
      >
        <Textarea value={form.criteria} onChange={(event) => setForm({ ...form, criteria: event.target.value })} />
      </Field>
      {candidates.length > 0 && (
        <fieldset className="space-y-2">
          <legend className="text-sm font-medium">Depends on</legend>
          {errors.dependencyIds && <p className="text-xs font-medium text-destructive">{errors.dependencyIds}</p>}
          <div className="flex max-h-40 flex-col gap-1 overflow-y-auto rounded-md border p-2">
            {candidates.map((item) => (
              <label key={item.id} className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  className="size-4 accent-[var(--primary)]"
                  checked={form.dependencyIds.includes(item.id)}
                  onChange={(event) =>
                    setForm({
                      ...form,
                      dependencyIds: event.target.checked
                        ? [...form.dependencyIds, item.id]
                        : form.dependencyIds.filter((id) => id !== item.id),
                    })
                  }
                />
                <span className="font-mono text-xs text-muted-foreground">{item.code}</span> {item.title}
              </label>
            ))}
          </div>
        </fieldset>
      )}
      {initial && (
        <Field label="Change note" hint="Recorded with this version." error={errors.changeNote}>
          <Input
            value={form.changeNote}
            maxLength={300}
            onChange={(event) => setForm({ ...form, changeNote: event.target.value })}
          />
        </Field>
      )}
      <div className="flex flex-wrap gap-2">
        <Button type="submit" disabled={pending} aria-busy={pending}>
          {pending ? "Saving…" : submitLabel}
        </Button>
        {onCancel && (
          <Button variant="outline" onClick={onCancel}>
            Cancel
          </Button>
        )}
      </div>
    </form>
  );
}
