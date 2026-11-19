import { branchNameProblem, type BranchKind, type BranchPolicy, type BranchView } from "@asaa/contracts";

export interface BranchPlan {
  name: string;
  from: string;
  warnings: string[];
}

export class BranchPlanError extends Error {
  constructor(
    message: string,
    readonly field: "topic" | "from" | "kind",
    readonly kind: "invalid" | "conflict",
  ) {
    super(message);
    this.name = "BranchPlanError";
  }
}

/**
 * Decide the branch name and start point for a request under the project policy
 * (US-F02). Mirrors the platform convention: main = production, dev =
 * integration, new/fix/test work branches started from dev. Nothing is merged;
 * protected-branch operations produce warnings that the UI shows and the audit
 * log records.
 */
export function planBranch(
  policy: BranchPolicy,
  branches: BranchView[],
  request: { kind: BranchKind; topic?: string; from?: string; switchTo?: boolean },
): BranchPlan {
  const existing = new Set(branches.map((branch) => branch.name));
  const warnings: string[] = [];
  const integrationExists = existing.has(policy.integrationBranch);
  let name: string;
  let from = request.from;

  if (request.kind === "integration") {
    if (request.topic) throw new BranchPlanError("The integration branch has a fixed name.", "topic", "invalid");
    name = policy.integrationBranch;
    from ??= policy.productionBranch;
    warnings.push(
      `${name} is the integration branch: work reaches it through reviewed pull requests and it is never merged automatically.`,
    );
  } else {
    const prefix =
      request.kind === "feature" ? policy.featurePrefix : request.kind === "fix" ? policy.fixPrefix : policy.testPrefix;
    name = request.topic ? `${prefix}/${request.topic}` : prefix;
    if (!from) {
      from = integrationExists ? policy.integrationBranch : policy.productionBranch;
      if (!integrationExists) {
        warnings.push(
          `Starting from ${policy.productionBranch} because ${policy.integrationBranch} does not exist yet; the branching strategy starts new work from ${policy.integrationBranch}.`,
        );
      }
    } else if (from === policy.productionBranch && integrationExists) {
      warnings.push(`New work should start from ${policy.integrationBranch}, not the production branch ${from}.`);
    }
  }

  const problem = branchNameProblem(name);
  if (problem) throw new BranchPlanError(problem, "topic", "invalid");
  if (existing.has(name)) throw new BranchPlanError(`Branch ${name} already exists.`, "topic", "conflict");
  if (!existing.has(from)) throw new BranchPlanError(`Start branch ${from} does not exist.`, "from", "invalid");
  // Git stores branches as paths: "new" and "new/topic" cannot both exist.
  const clash = [...existing].find((other) => name.startsWith(`${other}/`) || other.startsWith(`${name}/`));
  if (clash) {
    throw new BranchPlanError(
      `Branch ${name} cannot coexist with ${clash} (Git stores branch names as paths). Choose a different topic.`,
      "topic",
      "conflict",
    );
  }
  if (policy.protectedBranches.includes(name)) {
    warnings.push(
      `${name} is protected: changes must arrive by reviewed pull request; direct commits are not allowed.`,
    );
  }
  if (policy.requireReviewFor.includes(name)) {
    warnings.push(
      `Reviews are required before merging into ${name}. Local repositories cannot enforce this; a hosting provider can.`,
    );
  }
  if (request.switchTo && policy.protectedBranches.includes(name)) {
    warnings.push(`You will be working directly on the protected branch ${name}.`);
  }
  return { name, from, warnings };
}

/** Warnings about the current repository state relative to the policy. */
export function stateWarnings(policy: BranchPolicy, head: { branch: string | null; detached: boolean }): string[] {
  const warnings: string[] = [];
  if (head.detached)
    warnings.push("The repository is in a detached HEAD state; create or switch to a branch before making changes.");
  if (head.branch && policy.protectedBranches.includes(head.branch)) {
    warnings.push(
      `You are on the protected branch ${head.branch}. Create a work branch for changes; merges into protected branches happen by reviewed pull request, never automatically.`,
    );
  }
  return warnings;
}
