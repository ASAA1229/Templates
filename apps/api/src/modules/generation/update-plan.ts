/**
 * Impact analysis for updating a generated project to another template version (US-E05).
 * A three-way comparison of: base (what the recorded version generated), current (what is on disk now)
 * and target (what the new version would generate with the same inputs). Pure and deterministic.
 * Nothing is overwritten silently: only changes that cannot clobber local work are marked applicable.
 */
export type UpdateAction = "unchanged" | "update" | "add" | "remove" | "conflict";

export interface UpdateEntry {
  path: string;
  action: UpdateAction;
  reason: string;
}

export interface UpdatePlan {
  entries: UpdateEntry[];
  counts: Record<UpdateAction, number>;
  /** True when every change can be applied without touching a locally modified file. */
  clean: boolean;
}

const same = (a: Buffer | undefined, b: Buffer | undefined) => (a === undefined || b === undefined ? a === b : a.equals(b));

export function planUpdate(
  base: Map<string, Buffer>,
  current: Map<string, Buffer>,
  target: Map<string, Buffer>,
): UpdatePlan {
  const paths = [...new Set([...base.keys(), ...current.keys(), ...target.keys()])].sort();
  const entries: UpdateEntry[] = [];
  for (const path of paths) {
    const b = base.get(path);
    const c = current.get(path);
    const t = target.get(path);
    const entry = (action: UpdateAction, reason: string) => entries.push({ path, action, reason });
    if (b === undefined && t === undefined) {
      // Only present locally (added by the team): never touched.
      entry("unchanged", "Local file, not part of any template version.");
    } else if (b === undefined && t !== undefined) {
      if (c === undefined) entry("add", "New file in the target version.");
      else if (same(c, t)) entry("unchanged", "Already matches the target version.");
      else entry("conflict", "A local file with this name differs from the new template file.");
    } else if (b !== undefined && t === undefined) {
      if (c === undefined) entry("unchanged", "Already removed locally.");
      else if (same(c, b)) entry("remove", "Removed in the target version and not modified locally.");
      else entry("conflict", "Removed in the target version but modified locally.");
    } else if (same(b, t)) {
      entry("unchanged", "Identical in both template versions.");
    } else if (c === undefined) {
      entry("conflict", "Changed in the target version but deleted locally.");
    } else if (same(c, b)) {
      entry("update", "Changed in the target version and not modified locally.");
    } else if (same(c, t)) {
      entry("unchanged", "Local file already matches the target version.");
    } else {
      entry("conflict", "Changed both locally and in the target version.");
    }
  }
  const counts: Record<UpdateAction, number> = { unchanged: 0, update: 0, add: 0, remove: 0, conflict: 0 };
  for (const item of entries) counts[item.action] += 1;
  return { entries, counts, clean: counts.conflict === 0 };
}
