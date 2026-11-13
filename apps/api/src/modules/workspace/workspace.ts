import { lstat, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  branchPolicySchema,
  createBranchSchema,
  DEFAULT_BRANCH_POLICY,
  environmentSpecSchema,
  initRepositorySchema,
  PROVENANCE_DIR,
  updateEnvironmentSchema,
  updateIdentitySchema,
  updatePolicySchema,
  updateRemoteSchema,
  type AuditEventView,
  type BranchPolicy,
  type EnvironmentView,
  type RepositoryRecordView,
  type RepositoryStateView,
  type WorkspaceView,
} from "@asaa/contracts";
import type { Prisma, Project, ProjectRepository } from "@prisma/client";
import { Router, type Request } from "express";
import type { AppContext } from "../../context.js";
import { AppError, conflict, validationFailed } from "../../lib/errors.js";
import { ProcessOutputLimitError, ProcessTimeoutError, ProcessUnavailableError } from "../../lib/process.js";
import { audit } from "../audit/audit.service.js";
import { authorize } from "../auth/policy.js";
import { resolveOutputDir } from "../generation/writer.js";
import { loadProjectAccess } from "../projects/projects.js";
import { BranchPlanError, planBranch, stateWarnings } from "./branch-policy.js";
import { checkEnvironment, inferEnvironment } from "./environment.js";
import {
  detectGitDir,
  FUTURE_PROVIDERS,
  GitClient,
  GitCommandError,
  LocalGitProvider,
  type RepositoryProvider,
} from "./git.js";

const HISTORY_LIMIT = 30;

function repositoryView(record: ProjectRepository): RepositoryRecordView {
  return {
    id: record.id,
    provider: record.provider,
    defaultBranch: record.defaultBranch,
    policy: branchPolicySchema.parse(record.policy),
    identity: { name: record.identityName, email: record.identityEmail },
    remote: record.remoteUrl ? { name: record.remoteName ?? "origin", url: record.remoteUrl } : null,
    adoptedExisting: record.adoptedExisting,
    initializedAt: record.initializedAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
    version: record.version,
  };
}

/** Translate process and Git failures into safe API errors. */
function gitFailure(error: unknown): never {
  if (error instanceof ProcessUnavailableError) {
    throw new AppError(
      503,
      "UNAVAILABLE",
      "Git is not installed or not on PATH on the server. Install Git, then try again.",
    );
  }
  if (error instanceof ProcessTimeoutError || error instanceof ProcessOutputLimitError) {
    throw new AppError(503, "UNAVAILABLE", `Git did not complete: ${error.message}`);
  }
  if (error instanceof GitCommandError) {
    const detail =
      error.stderr
        .split("\n")
        .find((line) => line.trim())
        ?.replace(/^(fatal|error):\s*/, "") ?? "";
    throw conflict(`Git could not complete the operation${detail ? `: ${detail.slice(0, 200)}` : "."}`);
  }
  throw error;
}

/**
 * Engineering workspace (US-F01, US-F02, US-F03): source control for a
 * generated project's own folder, branching policy, and a reproducible
 * environment specification. Every operation is scoped to one owned project
 * and its canonical output folder inside the generation root.
 */
export class WorkspaceService {
  private readonly queues = new Map<string, Promise<unknown>>();
  readonly git: GitClient;
  readonly provider: RepositoryProvider;

  constructor(
    private readonly ctx: AppContext,
    options: { git?: GitClient; provider?: RepositoryProvider } = {},
  ) {
    this.git =
      options.git ??
      new GitClient(ctx.config.GIT_EXECUTABLE, ctx.config.GIT_TIMEOUT_MS, ctx.config.GENERATION_OUTPUT_DIR);
    this.provider = options.provider ?? new LocalGitProvider(this.git);
  }

  /** Serialise repository operations per project folder (Git's own locks would otherwise surface as errors). */
  private serialize<T>(key: string, task: () => Promise<T>): Promise<T> {
    const previous = this.queues.get(key) ?? Promise.resolve();
    const next = previous.catch(() => undefined).then(task);
    this.queues.set(key, next);
    next
      .finally(() => {
        if (this.queues.get(key) === next) this.queues.delete(key);
      })
      .catch(() => undefined);
    return next;
  }

  private async resolve(req: Request, projectId: string) {
    const project = await loadProjectAccess(this.ctx, req.owner!.id, projectId, "read");
    const membership =
      project.ownerId === req.owner!.id
        ? null
        : await this.ctx.prisma.projectMember.findUnique({
            where: { projectId_memberId: { projectId: project.id, memberId: req.owner!.id } },
            select: { role: true },
          });
    const access = project.ownerId === req.owner!.id ? "OWNER" : (membership?.role ?? "VIEWER");
    const generation = await this.ctx.prisma.projectGeneration.findUnique({ where: { projectId: project.id } });
    let dir: string | null = null;
    let reason: string | null = null;
    if (!generation) reason = "This project was created without generation, so it has no project folder yet.";
    else if (generation.status !== "SUCCEEDED")
      reason = "Generation has not succeeded yet; retry it from the project page.";
    else {
      dir = await resolveOutputDir(this.ctx.config.GENERATION_OUTPUT_DIR, generation.outputDir);
      // The root may not exist yet in a fresh environment; ensure the Git ceiling folder exists.
      if (!dir) reason = "The project folder is missing or is not a real folder.";
    }
    const record = await this.ctx.prisma.projectRepository.findUnique({ where: { projectId: project.id } });
    return { project, access, generation, dir, reason, record };
  }

  private async requireWritable(req: Request, project: Project) {
    await loadProjectAccess(this.ctx, req.owner!.id, project.id, "write");
    if (project.archivedAt) throw conflict("Restore the project before changing its repository.");
  }

  private requireDir(dir: string | null, reason: string | null): string {
    if (!dir) throw conflict(reason ?? "The project folder is not available.");
    return dir;
  }

  async gitInfo(): Promise<WorkspaceView["git"]> {
    try {
      await mkdir(this.ctx.config.GENERATION_OUTPUT_DIR, { recursive: true });
      return { available: true, version: await this.git.version(), message: null };
    } catch (error) {
      return {
        available: false,
        version: null,
        message:
          error instanceof ProcessUnavailableError
            ? "Git is not installed or not on PATH on the server."
            : "Git could not be started on the server.",
      };
    }
  }

  async overview(req: Request, projectId: string): Promise<WorkspaceView> {
    const { project, access, generation, dir, reason, record } = await this.resolve(req, projectId);
    const git = await this.gitInfo();
    const warnings: string[] = [];
    const gitDir = dir ? await detectGitDir(dir) : "none";
    const detection: WorkspaceView["detection"] =
      gitDir === "unsafe"
        ? "unsafe"
        : record
          ? gitDir === "directory"
            ? "registered"
            : "missing"
          : gitDir === "directory"
            ? "existing"
            : "none";
    const policy = record ? branchPolicySchema.parse(record.policy) : DEFAULT_BRANCH_POLICY;
    let state: RepositoryStateView | null = null;
    if (dir && git.available && (detection === "registered" || detection === "existing")) {
      try {
        state = await this.serialize(dir, () => this.provider.inspect(dir, policy, HISTORY_LIMIT));
        warnings.push(...stateWarnings(policy, state.head));
      } catch (error) {
        warnings.push(
          error instanceof GitCommandError ||
            error instanceof ProcessTimeoutError ||
            error instanceof ProcessOutputLimitError
            ? `The repository could not be read: ${error.message}`
            : "The repository could not be read.",
        );
      }
    }
    if (detection === "unsafe") {
      warnings.push(
        "The project folder contains a .git file or link instead of a folder; repository actions are disabled.",
      );
    }
    if (detection === "missing") warnings.push("The registered repository's .git folder is missing.");
    if (project.archivedAt) warnings.push("Archived projects are read-only.");
    const events = await this.ctx.prisma.auditEvent.findMany({
      where: {
        targetType: "project",
        targetId: project.id,
        OR: [{ action: { startsWith: "repository." } }, { action: { startsWith: "environment." } }],
      },
      orderBy: { id: "desc" },
      take: 20,
    });
    const activity: AuditEventView[] = events.map((event) => ({
      id: event.id.toString(),
      at: event.at.toISOString(),
      actorType: event.actorType,
      action: event.action,
      targetType: event.targetType,
      targetId: event.targetId,
      outcome: event.outcome,
      metadata: event.metadata as Record<string, unknown>,
    }));
    return {
      project: { id: project.id, key: project.key, name: project.name, archived: Boolean(project.archivedAt), access },
      output: { available: Boolean(dir), outputDir: generation?.outputDir ?? null, reason },
      git,
      providers: [this.provider.capabilities(), ...FUTURE_PROVIDERS],
      detection,
      repository: record ? repositoryView(record) : null,
      state,
      warnings,
      activity,
    };
  }

  async initialize(req: Request, projectId: string, raw: unknown) {
    const input = initRepositorySchema.parse(raw);
    const { project, generation, dir: maybeDir, reason, record } = await this.resolve(req, projectId);
    await this.requireWritable(req, project);
    const dir = this.requireDir(maybeDir, reason);
    if (record) throw conflict("This project's repository is already registered.");
    return this.serialize(dir, async () => {
      const gitDir = await detectGitDir(dir);
      if (gitDir === "unsafe") throw conflict("The project folder has a .git file or link; it cannot be used safely.");
      const adopted = gitDir === "directory";
      try {
        if (adopted) {
          await this.provider.setIdentity(dir, input.identity);
        } else {
          await this.provider.initialize(dir, {
            defaultBranch: input.policy.productionBranch,
            identity: input.identity,
            initialCommitMessage: input.initialCommit
              ? `Initial commit: ${project.key} generated from ${generation!.templateId}@${generation!.templateVersion}`
              : null,
          });
        }
      } catch (error) {
        gitFailure(error);
      }
      const state = await this.provider.inspect(dir, input.policy, 1).catch(gitFailure);
      const created = await this.ctx.prisma.projectRepository.create({
        data: {
          projectId: project.id,
          provider: "LOCAL_GIT",
          defaultBranch: adopted ? (state.head.branch ?? input.policy.productionBranch) : input.policy.productionBranch,
          policy: input.policy as Prisma.InputJsonValue,
          identityName: input.identity.name,
          identityEmail: input.identity.email,
          adoptedExisting: adopted,
          initializedAt: this.ctx.now(),
        },
      });
      await audit(this.ctx, req, {
        action: "repository.init",
        outcome: "SUCCESS",
        targetType: "project",
        targetId: project.id,
        metadata: {
          provider: "LOCAL_GIT",
          adoptedExisting: adopted,
          defaultBranch: created.defaultBranch,
          initialCommit: !adopted && input.initialCommit,
          head: state.head.sha,
        },
      });
      return repositoryView(created);
    });
  }

  private async requireRepository(req: Request, projectId: string) {
    const resolved = await this.resolve(req, projectId);
    await this.requireWritable(req, resolved.project);
    const dir = this.requireDir(resolved.dir, resolved.reason);
    if (!resolved.record) throw conflict("Initialize the repository first.");
    if ((await detectGitDir(dir)) !== "directory") throw conflict("The registered repository is missing or unsafe.");
    return { ...resolved, dir, record: resolved.record, policy: branchPolicySchema.parse(resolved.record.policy) };
  }

  async createBranch(req: Request, projectId: string, raw: unknown) {
    const input = createBranchSchema.parse(raw);
    const { project, dir, policy } = await this.requireRepository(req, projectId);
    return this.serialize(dir, async () => {
      const state = await this.provider.inspect(dir, policy, 1).catch(gitFailure);
      if (!state.head.sha) throw conflict("Create a first commit before adding branches.");
      let plan;
      try {
        plan = planBranch(policy, state.branches, input);
      } catch (error) {
        if (error instanceof BranchPlanError) {
          if (error.kind === "conflict") throw conflict(error.message);
          throw validationFailed({ [error.field]: error.message }, error.message);
        }
        throw error;
      }
      await this.provider.createBranch(dir, plan.name, plan.from, input.switchTo).catch(gitFailure);
      const after = await this.provider.inspect(dir, policy, 1).catch(gitFailure);
      const branch = after.branches.find((candidate) => candidate.name === plan.name);
      if (!branch) throw new Error("Branch was not created.");
      await audit(this.ctx, req, {
        action: "repository.branch_create",
        outcome: "SUCCESS",
        targetType: "project",
        targetId: project.id,
        metadata: {
          branch: plan.name,
          from: plan.from,
          kind: input.kind,
          switched: input.switchTo,
          warnings: plan.warnings,
        },
      });
      return { branch, warnings: plan.warnings };
    });
  }

  private async updateRecord(
    req: Request,
    projectId: string,
    expectedVersion: number,
    apply: (ctx: {
      dir: string;
      record: ProjectRepository;
      policy: BranchPolicy;
    }) => Promise<Prisma.ProjectRepositoryUpdateManyMutationInput>,
    action: string,
    metadata: Record<string, unknown>,
  ) {
    const resolved = await this.requireRepository(req, projectId);
    if (resolved.record.version !== expectedVersion) {
      throw conflict("The repository settings were changed elsewhere. Reload and try again.");
    }
    return this.serialize(resolved.dir, async () => {
      const data = await apply(resolved);
      const result = await this.ctx.prisma.projectRepository.updateMany({
        where: { id: resolved.record.id, version: expectedVersion },
        data: { ...data, version: { increment: 1 } },
      });
      if (result.count === 0) throw conflict("The repository settings were changed elsewhere. Reload and try again.");
      const updated = await this.ctx.prisma.projectRepository.findUniqueOrThrow({ where: { id: resolved.record.id } });
      await audit(this.ctx, req, {
        action,
        outcome: "SUCCESS",
        targetType: "project",
        targetId: resolved.project.id,
        metadata,
      });
      return repositoryView(updated);
    });
  }

  updateIdentity(req: Request, projectId: string, raw: unknown) {
    const { identity, expectedVersion } = updateIdentitySchema.parse(raw);
    return this.updateRecord(
      req,
      projectId,
      expectedVersion,
      async ({ dir }) => {
        await this.provider.setIdentity(dir, identity).catch(gitFailure);
        return { identityName: identity.name, identityEmail: identity.email };
      },
      "repository.identity_update",
      { name: identity.name },
    );
  }

  updatePolicy(req: Request, projectId: string, raw: unknown) {
    const { policy, expectedVersion } = updatePolicySchema.parse(raw);
    return this.updateRecord(
      req,
      projectId,
      expectedVersion,
      async ({ record }) => {
        if (policy.productionBranch !== record.defaultBranch) {
          throw validationFailed({ "policy.productionBranch": `The production branch is ${record.defaultBranch}.` });
        }
        return { policy: policy as Prisma.InputJsonValue };
      },
      "repository.policy_update",
      { protectedBranches: policy.protectedBranches, requireReviewFor: policy.requireReviewFor },
    );
  }

  updateRemote(req: Request, projectId: string, raw: unknown) {
    const { url, expectedVersion } = updateRemoteSchema.parse(raw);
    return this.updateRecord(
      req,
      projectId,
      expectedVersion,
      async ({ dir }) => {
        // Recorded in .git/config only: nothing is pushed, fetched or authenticated.
        await this.provider.setRemote(dir, "origin", url).catch(gitFailure);
        return { remoteName: url ? "origin" : null, remoteUrl: url };
      },
      "repository.remote_update",
      { remote: url ? (url.startsWith("git@") ? url.split(":")[0] : new URL(url).host) : null },
    );
  }

  // ───── Environment specification (US-F03) ─────

  async environment(req: Request, projectId: string): Promise<EnvironmentView> {
    const { project, dir } = await this.resolve(req, projectId);
    const saved = await this.ctx.prisma.projectEnvironment.findUnique({ where: { projectId: project.id } });
    if (saved) {
      return {
        spec: environmentSpecSchema.parse(saved.spec),
        version: saved.version,
        source: "saved",
        updatedAt: saved.updatedAt.toISOString(),
      };
    }
    return { spec: await inferEnvironment(dir), version: 0, source: "inferred", updatedAt: null };
  }

  async saveEnvironment(req: Request, projectId: string, raw: unknown): Promise<EnvironmentView> {
    const { spec, expectedVersion } = updateEnvironmentSchema.parse(raw);
    const { project, dir } = await this.resolve(req, projectId);
    await this.requireWritable(req, project);
    let saved;
    if (expectedVersion === 0) {
      saved = await this.ctx.prisma.projectEnvironment
        .create({ data: { projectId: project.id, spec: spec as Prisma.InputJsonValue } })
        .catch((error: unknown) => {
          if ((error as { code?: string }).code === "P2002") {
            throw conflict("The environment was saved elsewhere. Reload and try again.");
          }
          throw error;
        });
    } else {
      const result = await this.ctx.prisma.projectEnvironment.updateMany({
        where: { projectId: project.id, version: expectedVersion },
        data: { spec: spec as Prisma.InputJsonValue, version: { increment: 1 } },
      });
      if (result.count === 0) throw conflict("The environment was changed elsewhere. Reload and try again.");
      saved = await this.ctx.prisma.projectEnvironment.findUniqueOrThrow({ where: { projectId: project.id } });
    }
    // Keep a copy with the project so setup can be reproduced from the folder alone.
    if (dir) {
      const provenance = path.join(dir, PROVENANCE_DIR);
      const stats = await lstat(provenance).catch(() => null);
      if (stats?.isDirectory() && !stats.isSymbolicLink()) {
        await writeFile(path.join(provenance, "environment.json"), `${JSON.stringify(spec, null, 2)}\n`, {
          mode: 0o644,
        });
      }
    }
    await audit(this.ctx, req, {
      action: "environment.update",
      outcome: "SUCCESS",
      targetType: "project",
      targetId: project.id,
      metadata: { tools: spec.tools.map((tool) => `${tool.name}@${tool.version}`), variables: spec.variables.length },
    });
    return { spec, version: saved.version, source: "saved", updatedAt: saved.updatedAt.toISOString() };
  }

  async checkEnvironment(req: Request, projectId: string) {
    const project = await loadProjectAccess(this.ctx, req.owner!.id, projectId, "read");
    const view = await this.environment(req, projectId);
    const result = await checkEnvironment(view.spec, this.git);
    await audit(this.ctx, req, {
      action: "environment.check",
      outcome: result.ok ? "SUCCESS" : "FAILURE",
      targetType: "project",
      targetId: project.id,
      metadata: { missing: result.results.filter((item) => !item.ok).map((item) => item.name) },
    });
    return result;
  }
}

export function workspaceRouter(ctx: AppContext, service = new WorkspaceService(ctx)): Router {
  const router = Router({ mergeParams: true });
  const projectId = (req: Request) => String(req.params.projectId);
  const handle = (
    permission: "workspace:read" | "workspace:write",
    run: (req: Request) => Promise<unknown>,
    status = 200,
  ) =>
    [
      authorize(ctx, permission),
      async (req: Request, res: import("express").Response, next: import("express").NextFunction) => {
        try {
          res.status(status).json(await run(req));
        } catch (error) {
          next(error);
        }
      },
    ] as const;

  router.get(
    "/",
    ...handle("workspace:read", async (req) => ({ workspace: await service.overview(req, projectId(req)) })),
  );
  router.post(
    "/repository",
    ...handle(
      "workspace:write",
      async (req) => ({ repository: await service.initialize(req, projectId(req), req.body) }),
      201,
    ),
  );
  router.put(
    "/repository/identity",
    ...handle("workspace:write", async (req) => ({
      repository: await service.updateIdentity(req, projectId(req), req.body),
    })),
  );
  router.put(
    "/repository/policy",
    ...handle("workspace:write", async (req) => ({
      repository: await service.updatePolicy(req, projectId(req), req.body),
    })),
  );
  router.put(
    "/repository/remote",
    ...handle("workspace:write", async (req) => ({
      repository: await service.updateRemote(req, projectId(req), req.body),
    })),
  );
  router.post(
    "/branches",
    ...handle("workspace:write", async (req) => service.createBranch(req, projectId(req), req.body), 201),
  );
  router.get(
    "/environment",
    ...handle("workspace:read", async (req) => ({ environment: await service.environment(req, projectId(req)) })),
  );
  router.put(
    "/environment",
    ...handle("workspace:write", async (req) => ({
      environment: await service.saveEnvironment(req, projectId(req), req.body),
    })),
  );
  router.post(
    "/environment/check",
    ...handle("workspace:read", async (req) => ({ check: await service.checkEnvironment(req, projectId(req)) })),
  );
  return router;
}
