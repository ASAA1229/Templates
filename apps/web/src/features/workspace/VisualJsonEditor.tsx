import { Field } from "@/components/common";
import { Input } from "@/components/ui";

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };

/** Parse JSON text, returning null when it is not a JSON object. */
export function parseJsonObject(text: string): { [key: string]: Json } | null {
  try {
    const value = JSON.parse(text) as Json;
    return value !== null && typeof value === "object" && !Array.isArray(value) ? value : null;
  } catch {
    return null;
  }
}

/** Set a value at a key path, returning a new object (immutable update). */
export function setAtPath(root: { [key: string]: Json }, path: string[], value: Json): { [key: string]: Json } {
  const [head, ...rest] = path;
  if (head === undefined) return root;
  if (rest.length === 0) return { ...root, [head]: value };
  const child = root[head];
  const next = child !== null && typeof child === "object" && !Array.isArray(child) ? child : {};
  return { ...root, [head]: setAtPath(next, rest, value) };
}

/** Flatten nested objects to editable primitive leaves (arrays stay in the source editor). */
export function leaves(obj: { [key: string]: Json }, prefix: string[] = []): { path: string[]; value: Json }[] {
  return Object.entries(obj).flatMap(([key, value]) =>
    value !== null && typeof value === "object" && !Array.isArray(value)
      ? leaves(value, [...prefix, key])
      : Array.isArray(value)
        ? []
        : [{ path: [...prefix, key], value }],
  );
}

/**
 * Visual editing for JSON configuration files: every string, number and boolean setting becomes a form
 * control. Edits rewrite the same JSON text (two-space indent), so the source editor and Save keep working.
 */
export function VisualJsonEditor({
  text,
  readOnly,
  onChange,
}: {
  text: string;
  readOnly: boolean;
  onChange: (text: string) => void;
}) {
  const parsed = parseJsonObject(text);
  if (!parsed) {
    return (
      <p role="alert" className="text-sm text-muted-foreground">
        This file is not a valid JSON object, so it can only be edited as source.
      </p>
    );
  }
  const update = (path: string[], value: Json) =>
    onChange(`${JSON.stringify(setAtPath(parsed, path, value), null, 2)}\n`);
  const items = leaves(parsed);
  if (items.length === 0) return <p className="text-sm text-muted-foreground">No simple settings to edit visually.</p>;
  return (
    <div className="grid gap-3 sm:grid-cols-2" role="group" aria-label="Visual settings">
      {items.map(({ path, value }) => {
        const label = path.join(".");
        if (typeof value === "boolean") {
          return (
            <label key={label} className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={value}
                disabled={readOnly}
                onChange={(event) => update(path, event.target.checked)}
              />
              {label}
            </label>
          );
        }
        return (
          <Field key={label} label={label}>
            <Input
              type={typeof value === "number" ? "number" : "text"}
              value={value === null ? "" : String(value)}
              readOnly={readOnly}
              onChange={(event) =>
                update(path, typeof value === "number" ? Number(event.target.value) : event.target.value)
              }
            />
          </Field>
        );
      })}
    </div>
  );
}
