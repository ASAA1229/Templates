import type { TemplateInput, TemplateInputValues } from "@asaa/contracts";
import { useId } from "react";
import { Field } from "@/components/common";
import { Input, Label, Select, Textarea } from "@/components/ui";

/** Initial form values from manifest defaults. */
export function defaultInputValues(inputs: TemplateInput[]): TemplateInputValues {
  const values: TemplateInputValues = {};
  for (const input of inputs) {
    if (input.type === "boolean") values[input.id] = input.default ?? false;
    else values[input.id] = input.default ?? "";
  }
  return values;
}

/** Drop empty optional selects so the server applies its own defaults/omissions. */
export function cleanInputValues(inputs: TemplateInput[], values: TemplateInputValues): TemplateInputValues {
  const cleaned: TemplateInputValues = {};
  for (const input of inputs) {
    const value = values[input.id];
    if (value === undefined || (input.type === "select" && value === "")) continue;
    cleaned[input.id] = value;
  }
  return cleaned;
}

function BooleanField({
  input,
  value,
  onChange,
  error,
}: {
  input: Extract<TemplateInput, { type: "boolean" }>;
  value: boolean;
  onChange: (value: boolean) => void;
  error?: string;
}) {
  const id = useId();
  return (
    <div className="space-y-1">
      <div className="flex items-start gap-2">
        <input
          id={id}
          type="checkbox"
          className="mt-1 size-4 accent-[var(--color-primary)]"
          checked={value}
          aria-describedby={input.description ? `${id}-hint` : undefined}
          onChange={(event) => onChange(event.target.checked)}
        />
        <div>
          <Label htmlFor={id}>{input.label}</Label>
          {input.description && (
            <p id={`${id}-hint`} className="text-xs text-muted-foreground">
              {input.description}
            </p>
          )}
        </div>
      </div>
      {error && <p className="text-xs font-medium text-destructive">{error}</p>}
    </div>
  );
}

/**
 * Configuration form generated from a template manifest's declared inputs.
 * Errors are keyed by input id (matching the shared values schema).
 */
export function TemplateInputsForm({
  inputs,
  values,
  errors,
  onChange,
}: {
  inputs: TemplateInput[];
  values: TemplateInputValues;
  errors: Record<string, string>;
  onChange: (values: TemplateInputValues) => void;
}) {
  if (inputs.length === 0) {
    return <p className="text-sm text-muted-foreground">This starter needs no extra configuration.</p>;
  }
  const set = (id: string, value: string | boolean) => onChange({ ...values, [id]: value });
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      {inputs.map((input) => {
        const label = input.required ? `${input.label} (required)` : input.label;
        const error = errors[input.id];
        if (input.type === "boolean") {
          return (
            <BooleanField
              key={input.id}
              input={input}
              value={values[input.id] === true}
              error={error}
              onChange={(value) => set(input.id, value)}
            />
          );
        }
        if (input.type === "select") {
          return (
            <Field key={input.id} label={label} hint={input.description} error={error}>
              <Select value={String(values[input.id] ?? "")} onChange={(event) => set(input.id, event.target.value)}>
                {!input.required && input.default === undefined && <option value="">Not set</option>}
                {input.options.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </Select>
            </Field>
          );
        }
        if (input.type === "text") {
          return (
            <div key={input.id} className="sm:col-span-2">
              <Field label={label} hint={input.description} error={error}>
                <Textarea
                  rows={3}
                  maxLength={input.maxLength}
                  value={String(values[input.id] ?? "")}
                  onChange={(event) => set(input.id, event.target.value)}
                />
              </Field>
            </div>
          );
        }
        return (
          <Field key={input.id} label={label} hint={input.description} error={error}>
            <Input
              type={input.format === "email" ? "email" : "text"}
              maxLength={input.maxLength}
              autoComplete="off"
              spellCheck={input.format === "text"}
              value={String(values[input.id] ?? "")}
              onChange={(event) => set(input.id, event.target.value)}
            />
          </Field>
        );
      })}
    </div>
  );
}
