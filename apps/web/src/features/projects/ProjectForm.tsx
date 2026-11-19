import {
  createProjectSchema,
  fieldErrors,
  PROJECT_STATUSES,
  type CreateProjectInput,
  type ProjectView,
} from "@asaa/contracts";
import { useState, type FormEvent } from "react";
import { Field } from "@/components/common";
import { Alert, Button, Input, Select, Textarea } from "@/components/ui";
import { ApiError } from "@/lib/api";
import { humanize } from "@/lib/utils";

/**
 * Create or edit project metadata (US-C01). The same contract the API enforces is
 * checked before submit; server field errors are shown inline.
 */
export function ProjectForm({
  initial,
  submitLabel,
  onSubmit,
  onCancel,
}: {
  initial?: ProjectView;
  submitLabel: string;
  onSubmit: (input: CreateProjectInput) => Promise<void>;
  onCancel?: () => void;
}) {
  const [form, setForm] = useState({
    key: initial?.key ?? "",
    name: initial?.name ?? "",
    purpose: initial?.purpose ?? "",
    status: initial?.status ?? "PLANNING",
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [message, setMessage] = useState("");
  const [pending, setPending] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setMessage("");
    const parsed = createProjectSchema.safeParse(form);
    if (!parsed.success) {
      setErrors(fieldErrors(parsed.error));
      return;
    }
    setErrors({});
    setPending(true);
    try {
      await onSubmit(parsed.data);
    } catch (error) {
      if (error instanceof ApiError) {
        setErrors(error.fields);
        setMessage(error.message);
      } else {
        setMessage("Could not save the project.");
      }
    } finally {
      setPending(false);
    }
  }

  return (
    <form noValidate onSubmit={submit} className="space-y-4" aria-label={submitLabel}>
      {message && <Alert tone="danger">{message}</Alert>}
      <div className="grid gap-4 sm:grid-cols-[12rem_1fr]">
        <Field label="Key" error={errors.key} hint="Unique, e.g. WEB-APP">
          <Input
            value={form.key}
            disabled={Boolean(initial)}
            maxLength={20}
            onChange={(event) => setForm({ ...form, key: event.target.value.toUpperCase() })}
          />
        </Field>
        <Field label="Name" error={errors.name}>
          <Input
            value={form.name}
            maxLength={120}
            onChange={(event) => setForm({ ...form, name: event.target.value })}
          />
        </Field>
      </div>
      <Field label="Purpose" error={errors.purpose}>
        <Textarea
          value={form.purpose}
          maxLength={2000}
          onChange={(event) => setForm({ ...form, purpose: event.target.value })}
        />
      </Field>
      <Field label="Status" error={errors.status}>
        <Select
          value={form.status}
          onChange={(event) => setForm({ ...form, status: event.target.value as typeof form.status })}
        >
          {PROJECT_STATUSES.map((status) => (
            <option key={status} value={status}>
              {humanize(status)}
            </option>
          ))}
        </Select>
      </Field>
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
