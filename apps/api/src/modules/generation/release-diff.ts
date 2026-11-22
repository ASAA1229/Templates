import type { ReleaseComparisonView } from "@asaa/contracts";

interface ManifestLike {
  title?: unknown;
  description?: unknown;
  category?: unknown;
  license?: { spdx?: unknown };
  technologies?: { name: string; version: string }[];
  dependencies?: { name: string; version: string }[];
  inputs?: { id: string }[];
  files?: { source: string; target?: string }[];
  compatibility?: unknown;
}

const asManifest = (value: unknown): ManifestLike =>
  value && typeof value === "object" ? (value as ManifestLike) : {};
const key = (entry: { name: string; version: string }) => `${entry.name}@${entry.version}`;

function setDiff(before: string[], after: string[]) {
  const a = new Set(before);
  const b = new Set(after);
  return { added: after.filter((item) => !a.has(item)).sort(), removed: before.filter((item) => !b.has(item)).sort() };
}

/** Structured difference between two stored template manifests (D3.10 version comparison). Pure and side-effect free. */
export function diffManifests(fromRaw: unknown, toRaw: unknown): ReleaseComparisonView["changes"] {
  const from = asManifest(fromRaw);
  const to = asManifest(toRaw);
  const fields: ReleaseComparisonView["changes"]["fields"] = [];
  const scalar = (name: string, before: unknown, after: unknown) => {
    if (JSON.stringify(before ?? null) !== JSON.stringify(after ?? null)) {
      fields.push({ field: name, from: String(before ?? ""), to: String(after ?? "") });
    }
  };
  scalar("title", from.title, to.title);
  scalar("description", from.description, to.description);
  scalar("category", from.category, to.category);
  scalar("license", from.license?.spdx, to.license?.spdx);
  scalar("compatibility", JSON.stringify(from.compatibility ?? null), JSON.stringify(to.compatibility ?? null));
  return {
    fields,
    inputs: setDiff(
      (from.inputs ?? []).map((input) => input.id),
      (to.inputs ?? []).map((input) => input.id),
    ),
    files: setDiff(
      (from.files ?? []).map((file) => file.source),
      (to.files ?? []).map((file) => file.source),
    ),
    technologies: setDiff((from.technologies ?? []).map(key), (to.technologies ?? []).map(key)),
    dependencies: setDiff((from.dependencies ?? []).map(key), (to.dependencies ?? []).map(key)),
  };
}
