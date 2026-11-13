/**
 * Reusable-asset dependency, license and version resolution (RG-13). Pure and deterministic: the caller
 * supplies an index of available versions, so the same logic serves catalog items and template releases.
 */

// ───── Semantic versions and ranges ─────

export interface Semver {
  major: number;
  minor: number;
  patch: number;
  pre: string | null;
}

const VERSION = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/;

export function parseVersion(text: string): Semver | null {
  const match = VERSION.exec(text.trim());
  if (!match) return null;
  return { major: Number(match[1]), minor: Number(match[2]), patch: Number(match[3]), pre: match[4] ?? null };
}

export function compareVersions(a: Semver, b: Semver): number {
  for (const key of ["major", "minor", "patch"] as const) {
    if (a[key] !== b[key]) return a[key] - b[key];
  }
  if (a.pre === b.pre) return 0;
  if (a.pre === null) return 1;
  if (b.pre === null) return -1;
  return a.pre < b.pre ? -1 : 1;
}

type Comparator = { op: ">=" | ">" | "<=" | "<" | "="; version: Semver };

/** Parse a range such as "^1.2.0", "~1.2.3", ">=1.0.0 <2.0.0", "1.x", "*" or an exact version. Null when invalid. */
export function parseRange(text: string): Comparator[] | null {
  const input = text.trim();
  if (input === "" || input === "*" || input === "x")
    return [{ op: ">=", version: { major: 0, minor: 0, patch: 0, pre: null } }];
  const comparators: Comparator[] = [];
  for (const token of input.split(/\s+/)) {
    const partial = /^(\^|~)?(\d+)(?:\.(\d+|x|\*))?(?:\.(\d+|x|\*))?(?:-([0-9A-Za-z.-]+))?$/.exec(token);
    if (partial) {
      const [, prefix, majorText, minorText, patchText, pre] = partial;
      const major = Number(majorText);
      const minorOpen = minorText === undefined || minorText === "x" || minorText === "*";
      const patchOpen = patchText === undefined || patchText === "x" || patchText === "*";
      const minor = minorOpen ? 0 : Number(minorText);
      const patch = patchOpen ? 0 : Number(patchText);
      const low: Semver = { major, minor, patch, pre: pre ?? null };
      if (prefix === "^") {
        const high: Semver =
          major > 0 || minorOpen
            ? { major: major + 1, minor: 0, patch: 0, pre: null }
            : minor > 0 || patchOpen
              ? { major: 0, minor: minor + 1, patch: 0, pre: null }
              : { major: 0, minor: 0, patch: patch + 1, pre: null };
        comparators.push({ op: ">=", version: low }, { op: "<", version: high });
      } else if (prefix === "~") {
        const high: Semver = minorOpen
          ? { major: major + 1, minor: 0, patch: 0, pre: null }
          : { major, minor: minor + 1, patch: 0, pre: null };
        comparators.push({ op: ">=", version: low }, { op: "<", version: high });
      } else if (minorOpen || patchOpen) {
        const high: Semver = minorOpen
          ? { major: major + 1, minor: 0, patch: 0, pre: null }
          : { major, minor: minor + 1, patch: 0, pre: null };
        comparators.push({ op: ">=", version: low }, { op: "<", version: high });
      } else comparators.push({ op: "=", version: low });
      continue;
    }
    const operator = /^(>=|<=|>|<|=)(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)$/.exec(token);
    const version = operator ? parseVersion(operator[2]!) : null;
    if (!operator || !version) return null;
    comparators.push({ op: operator[1] as Comparator["op"], version });
  }
  return comparators;
}

export function satisfies(version: string, range: string): boolean {
  const parsed = parseVersion(version);
  const comparators = parseRange(range);
  if (!parsed || !comparators) return false;
  // Pre-releases only match ranges that explicitly mention a pre-release.
  if (parsed.pre && !comparators.some((c) => c.version.pre)) return false;
  return comparators.every(({ op, version: bound }) => {
    const diff = compareVersions(parsed, bound);
    return op === ">="
      ? diff >= 0
      : op === ">"
        ? diff > 0
        : op === "<="
          ? diff <= 0
          : op === "<"
            ? diff < 0
            : diff === 0;
  });
}

// ───── Licenses ─────

const PERMISSIVE = new Set([
  "MIT",
  "Apache-2.0",
  "BSD-2-Clause",
  "BSD-3-Clause",
  "ISC",
  "0BSD",
  "CC0-1.0",
  "Unlicense",
]);
const COPYLEFT = /^(?:A?GPL|LGPL|MPL|EPL|CDDL|SSPL|EUPL)/i;
export const DEFAULT_ALLOWED_LICENSES = [...PERMISSIVE, "Proprietary"] as const;

export function licenseProblem(license: string, allowed: readonly string[]): string | null {
  if (allowed.includes(license)) return null;
  if (COPYLEFT.test(license)) return `${license} is a copyleft license and needs legal review before reuse.`;
  if (!license || /^(NOASSERTION|UNKNOWN|NONE)$/i.test(license)) return "The license is unknown.";
  return `${license} is not on the approved license list.`;
}

// ───── Resolution ─────

export interface AssetVersion {
  name: string;
  version: string;
  license: string;
  lifecycle: "DRAFT" | "ACTIVE" | "DEPRECATED" | "RETIRED";
  trusted: boolean;
  dependencies: { name: string; range: string }[];
}
export interface AssetIndex {
  versionsOf(name: string): AssetVersion[];
}
export type ProblemCode =
  "MISSING" | "NO_MATCH" | "CONFLICT" | "CYCLE" | "LICENSE" | "UNTRUSTED" | "RETIRED" | "DEPRECATED" | "INVALID_RANGE";
export interface ResolutionProblem {
  code: ProblemCode;
  name: string;
  message: string;
  severity: "error" | "warning";
}
export interface ResolvedAsset {
  name: string;
  version: string;
  license: string;
  requiredBy: string[];
  dependencies: string[];
}
export interface Resolution {
  ok: boolean;
  resolved: ResolvedAsset[];
  /** Dependencies before dependents. */
  installOrder: string[];
  problems: ResolutionProblem[];
}

export interface ResolveOptions {
  allowedLicenses?: readonly string[];
  /** Cap on distinct assets, to keep hostile graphs bounded. */
  maxAssets?: number;
}

/**
 * Pick, for every reachable asset, the highest usable version satisfying all collected ranges.
 * Usable means ACTIVE and trusted; deprecated versions are used only when nothing else matches (warning),
 * retired, draft and untrusted versions are never selected.
 */
export function resolveAssets(
  roots: { name: string; range: string }[],
  index: AssetIndex,
  options: ResolveOptions = {},
): Resolution {
  const allowed = options.allowedLicenses ?? DEFAULT_ALLOWED_LICENSES;
  const maxAssets = options.maxAssets ?? 200;
  const problems: ResolutionProblem[] = [];
  const problem = (code: ProblemCode, name: string, message: string, severity: "error" | "warning" = "error") => {
    if (!problems.some((p) => p.code === code && p.name === name && p.message === message)) {
      problems.push({ code, name, message, severity });
    }
  };

  const constraints = new Map<string, Map<string, string>>(); // name -> requester -> range
  const chosen = new Map<string, AssetVersion>();
  const failed = new Set<string>();
  const addConstraint = (name: string, requester: string, range: string) => {
    if (!parseRange(range)) {
      problem("INVALID_RANGE", name, `${requester} requires ${name} with an invalid version range "${range}".`);
      return false;
    }
    const existing = constraints.get(name) ?? new Map<string, string>();
    existing.set(requester, range);
    constraints.set(name, existing);
    return true;
  };
  for (const root of roots) addConstraint(root.name, "(request)", root.range);

  const pick = (name: string): AssetVersion | null => {
    const ranges = [...(constraints.get(name)?.values() ?? [])];
    const candidates = index
      .versionsOf(name)
      .filter(
        (candidate) => parseVersion(candidate.version) && ranges.every((range) => satisfies(candidate.version, range)),
      )
      .sort((a, b) => compareVersions(parseVersion(b.version)!, parseVersion(a.version)!));
    const usable = candidates.find((candidate) => candidate.lifecycle === "ACTIVE" && candidate.trusted);
    return usable ?? candidates.find((candidate) => candidate.lifecycle === "DEPRECATED" && candidate.trusted) ?? null;
  };

  // Iterate to a fixed point: choosing a version can add constraints that change earlier choices.
  for (let round = 0; round < maxAssets * 2; round++) {
    let changed = false;
    for (const name of [...constraints.keys()].sort()) {
      if (failed.has(name)) continue;
      const next = pick(name);
      const current = chosen.get(name);
      if (!next) {
        failed.add(name);
        chosen.delete(name);
        continue;
      }
      if (current?.version !== next.version) {
        chosen.set(name, next);
        changed = true;
      }
    }
    // Rebuild dependency constraints from the current choices.
    for (const [name, requesters] of constraints) {
      for (const requester of [...requesters.keys()]) {
        if (requester !== "(request)" && !chosen.has(requester)) requesters.delete(requester);
      }
      if (requesters.size === 0 && !roots.some((root) => root.name === name)) constraints.delete(name);
    }
    for (const asset of chosen.values()) {
      for (const dependency of asset.dependencies) {
        const before = constraints.get(dependency.name)?.get(asset.name);
        if (before !== dependency.range && addConstraint(dependency.name, asset.name, dependency.range)) changed = true;
      }
    }
    if (constraints.size > maxAssets) {
      problem("CONFLICT", "(graph)", `The dependency graph exceeds ${maxAssets} assets.`);
      break;
    }
    if (!changed) break;
  }

  for (const name of failed) {
    const ranges = constraints.get(name);
    const known = index.versionsOf(name);
    const summary = [...(ranges?.entries() ?? [])].map(([by, range]) => `${by} needs ${range}`).join("; ");
    if (known.length === 0) problem("MISSING", name, `${name} is not in the catalog.`);
    else if (known.every((v) => v.lifecycle === "RETIRED")) problem("RETIRED", name, `${name} is retired.`);
    else if (known.every((v) => !v.trusted)) problem("UNTRUSTED", name, `${name} has not been reviewed and trusted.`);
    else if ((ranges?.size ?? 0) > 1)
      problem("CONFLICT", name, `No version of ${name} satisfies every requirement (${summary}).`);
    else problem("NO_MATCH", name, `No usable version of ${name} satisfies ${summary || "the request"}.`);
  }

  const resolved: ResolvedAsset[] = [];
  for (const asset of [...chosen.values()].sort((a, b) => a.name.localeCompare(b.name))) {
    if (asset.lifecycle === "DEPRECATED")
      problem("DEPRECATED", asset.name, `${asset.name}@${asset.version} is deprecated.`, "warning");
    const reason = licenseProblem(asset.license, allowed);
    if (reason) problem("LICENSE", asset.name, `${asset.name}@${asset.version}: ${reason}`);
    resolved.push({
      name: asset.name,
      version: asset.version,
      license: asset.license,
      requiredBy: [...(constraints.get(asset.name)?.keys() ?? [])].sort(),
      dependencies: asset.dependencies.map((dependency) => dependency.name).sort(),
    });
  }

  // Dependency order with cycle detection (depth-first, dependencies first).
  const installOrder: string[] = [];
  const state = new Map<string, "visiting" | "done">();
  const byName = new Map(resolved.map((asset) => [asset.name, asset]));
  const visit = (name: string, trail: string[]) => {
    const mark = state.get(name);
    if (mark === "done") return;
    if (mark === "visiting") {
      problem("CYCLE", name, `Circular dependency: ${[...trail.slice(trail.indexOf(name)), name].join(" -> ")}.`);
      return;
    }
    state.set(name, "visiting");
    for (const dependency of byName.get(name)?.dependencies ?? [])
      if (byName.has(dependency)) visit(dependency, [...trail, name]);
    state.set(name, "done");
    installOrder.push(name);
  };
  for (const asset of resolved) visit(asset.name, []);

  return { ok: !problems.some((p) => p.severity === "error"), resolved, installOrder, problems };
}
