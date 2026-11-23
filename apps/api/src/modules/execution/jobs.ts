import { lstat, readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { unsafePathReason } from "@asaa/contracts";
import type { ExecutionJob, Project } from "@prisma/client";
import { Router, type NextFunction, type Request, type Response } from "express";
import { z } from "zod";
import type { AppContext } from "../../context.js";
import {
  DEFAULT_LIMITS,
  executionConfig,
  processConfinementBlocksNetwork,
  runIsolated,
  type RunLimits,
  type RunResult,
} from "../../execution/worker.js";
import { AppError, conflict, notEligible, notFound, validationFailed } from "../../lib/errors.js";
import { audit } from "../audit/audit.service.js";
import { authorize } from "../auth/policy.js";
import { isSecretFileName } from "../export/file-policy.js";
import { resolveOutputDir } from "../generation/writer.js";
import { loadProjectAccess, requireProjectAccess } from "../projects/projects.js";
import {
  chooseIsolation,
  containerIsolationDescription,
  createLimiter,
  processIsolationDescription,
  runInContainer,
  type DockerDeps,
  type IsolationMode,
} from "./container.js";

export const JOB_TASKS = ["node-script", "node-test"] as const;
export type JobTask = (typeof JOB_TASKS)[number];

/** Job defaults: stricter output and disk caps than the raw worker defaults. */
export const JOB_LIMITS: Required<RunLimits> = {
  ...DEFAULT_LIMITS,
  timeoutMs: 60_000,
  maxOutputBytes: 256 * 1024,
  maxMemoryMb: 256,
  maxFiles: 2000,
  maxDiskBytes: 32 * 1024 * 1024,
};
/** What may be copied from the project into the disposable run folder. */
export const COPY_LIMITS = { files: 1500, fileBytes: 8 * 1024 * 1024, totalBytes: 16 * 1024 * 1024 } as const;
const EXCLUDED = new Set([".git", "node_modules", ".asaa"]);
const LOG_CAP = 256 * 1024;
const CANCEL_WAIT_MS = 8000;

export interface JobsDeps {
  /** Limit overrides (tests use short timeouts). */
  limits?: Partial<RunLimits>;
  docker?: DockerDeps;
}

/** Mutable runtime overrides; the production router is mounted without deps, tests adjust this instead. */
export const jobsRuntime: JobsDeps = {};

const submitSchema = z.object({
  task: z.enum(JOB_TASKS),
  target: z.string().max(240).optional(),
});

export function isolationDescription(mode: string, image: string): string {
  return mode === "container" ? containerIsolationDescription(image) : processIsolationDescription(processConfinementBlocksNetwork());
}

export function jobView(job: ExecutionJob, image: string) {
  return {
    id: job.id,
    projectId: job.projectId,
    task: job.task,
    target: job.target,
    isolation: job.isolation,
    isolationDescription: isolationDescription(job.isolation, image),
    status: job.status,
    exitCode: job.exitCode,
    reason: job.reason,
    truncated: job.truncated,
    createdAt: job.createdAt.toISOString(),
    startedAt: job.startedAt?.toISOString() ?? null,
    finishedAt: job.finishedAt?.toISOString() ?? null,
  };
}

/** Mark jobs that were in flight when the previous server process stopped. Call once at server start. */
export async function recoverInterruptedJobs(ctx: AppContext): Promise<number> {
  const result = await ctx.prisma.executionJob.updateMany({
    where: { status: { in: ["QUEUED", "RUNNING"] } },
    data: { status: "FAILED", reason: "server restarted", finishedAt: ctx.now() },
  });
  return result.count;
}

/** Syntactic checks for a target path; throws a 400 on anything unsafe. */
export function validateTarget(raw: string | undefined): string {
  const value = (raw ?? "").trim();
  const bad = (message: string) => validationFailed({ target: message });
  if (!value) throw bad("A target script is required.");
  if (value.startsWith("/") || value.includes("\\") || /^[a-zA-Z]:/.test(value) || value.includes("\0")) {
    throw bad("Use a relative path inside the project.");
  }
  if (value.split("/").some((part) => part === "." || part === "..")) throw bad("Paths may not contain . or ..");
  const reason = unsafePathReason(value);
  if (reason) throw bad(reason);
  if (value.split("/").some((part) => EXCLUDED.has(part))) throw bad("That location cannot be run.");
  return value;
}

/** The target must be an existing regular file reached without symlinks. */
async function requireTargetFile(root: string, rel: string): Promise<void> {
  let current = root;
  const parts = rel.split("/");
  for (const [index, part] of parts.entries()) {
    current = path.join(current, part);
    const stats = await lstat(current).catch(() => null);
    if (!stats) throw validationFailed({ target: "That file does not exist in the project." });
    if (stats.isSymbolicLink()) throw notEligible(`"${parts.slice(0, index + 1).join("/")}" is a symbolic link.`);
    const last = index === parts.length - 1;
    if (last ? !stats.isFile() : !stats.isDirectory()) {
      throw validationFailed({ target: "The target must be a regular file." });
    }
  }
}

class CopyError extends Error {}

/** Read the project's regular files (excluding VCS, dependencies and provenance) within the copy limits. */
export async function collectProjectFiles(root: string): Promise<Record<string, Buffer>> {
  const files: Record<string, Buffer> = {};
  let count = 0;
  let total = 0;
  const walk = async (dir: string, prefix: string): Promise<void> => {
    for (const entry of (await readdir(dir, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
      if (EXCLUDED.has(entry.name) || (entry.isFile() && isSecretFileName(entry.name))) continue;
      const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
      const full = path.join(dir, entry.name);
      const stats = await lstat(full);
      if (stats.isSymbolicLink()) throw new CopyError(`"${rel}" is a symbolic link`);
      if (stats.isDirectory()) await walk(full, rel);
      else if (stats.isFile()) {
        count += 1;
        total += stats.size;
        if (stats.size > COPY_LIMITS.fileBytes) throw new CopyError(`"${rel}" is too large`);
        if (count > COPY_LIMITS.files || total > COPY_LIMITS.totalBytes) {
          throw new CopyError("the project is larger than the job limits");
        }
        files[rel] = await readFile(full);
      } else throw new CopyError(`"${rel}" is not a regular file`);
    }
  };
  await walk(root, "");
  return files;
}

const clip = (text: string) => {
  const clean = text.replaceAll("\u0000", "");
  return Buffer.byteLength(clean) > LOG_CAP ? Buffer.from(clean).subarray(0, LOG_CAP).toString("utf8") : clean;
};

interface Running {
  controller: AbortController;
  done: Promise<void>;
}

export function jobsRouter(ctx: AppContext, deps: JobsDeps = {}): Router {
  const router = Router({ mergeParams: true });
  const running = new Map<string, Running>();
  const containerLimiter = createLimiter(() => executionConfig.maxConcurrent);
  const projectId = (req: Request) => String(req.params.projectId);
  const jobId = (req: Request) => String(req.params.jobId);
  const image = ctx.config.JOB_CONTAINER_IMAGE;
  const limits = (): Required<RunLimits> => ({ ...JOB_LIMITS, ...jobsRuntime.limits, ...deps.limits });
  const docker = (): DockerDeps => ({ ...jobsRuntime.docker, ...deps.docker });

  const handle = (permission: "job:read" | "job:write", run: (req: Request) => Promise<unknown>, status = 200) =>
    [
      authorize(ctx, permission),
      requireProjectAccess(ctx, permission === "job:write" ? "write" : "read"),
      async (req: Request, res: Response, next: NextFunction) => {
        try {
          res.status(status).json(await run(req));
        } catch (error) {
          next(error);
        }
      },
    ] as const;

  async function findJob(req: Request): Promise<ExecutionJob> {
    const id = jobId(req);
    if (!/^[0-9a-f-]{36}$/i.test(id)) throw notFound("Job");
    const job = await ctx.prisma.executionJob.findFirst({ where: { id, projectId: projectId(req) } });
    if (!job) throw notFound("Job");
    return job;
  }

  async function projectDir(project: Project): Promise<string> {
    const generation = await ctx.prisma.projectGeneration.findUnique({ where: { projectId: project.id } });
    if (!generation || generation.status !== "SUCCEEDED") {
      throw conflict("This project has no generated project folder to run.");
    }
    const dir = await resolveOutputDir(ctx.config.GENERATION_OUTPUT_DIR, generation.outputDir);
    if (!dir) throw conflict("The project folder is missing or is not a real folder.");
    return dir;
  }

  async function execute(
    job: ExecutionJob,
    dir: string,
    nodeArgs: string[],
    mode: IsolationMode,
    signal: AbortSignal,
    actorId: string,
  ): Promise<void> {
    let result: RunResult;
    let marked: Promise<unknown> = Promise.resolve();
    const markRunning = () => {
      marked = ctx.prisma.executionJob
        .updateMany({ where: { id: job.id, status: "QUEUED" }, data: { status: "RUNNING", startedAt: ctx.now() } })
        .catch(() => undefined);
    };
    try {
      const files = await collectProjectFiles(dir);
      const lim = limits();
      if (mode === "container") {
        if (!(await containerLimiter.acquire(signal))) {
          result = {
            status: "CANCELLED",
            exitCode: null,
            stdout: "",
            stderr: "",
            truncated: false,
            durationMs: 0,
            reason: "cancelled while queued",
          };
        } else {
          try {
            result = await runInContainer({
              jobId: job.id,
              image,
              nodeArgs,
              files,
              limits: lim,
              signal,
              onSpawn: markRunning,
              docker: docker(),
            });
          } finally {
            containerLimiter.release();
          }
        }
      } else {
        result = await runIsolated({
          command: process.execPath,
          args: nodeArgs,
          files,
          limits: lim,
          confine: true,
          signal,
          onSpawn: markRunning,
        });
      }
    } catch (error) {
      const reason =
        error instanceof CopyError
          ? `Cannot copy project: ${error.message}`
          : error instanceof Error
            ? error.message.slice(0, 200)
            : "execution failed";
      result = {
        status: "FAILED",
        exitCode: null,
        stdout: "",
        stderr: "",
        truncated: false,
        durationMs: 0,
        reason,
      };
    }
    await marked;
    const finishedAt = ctx.now();
    await ctx.prisma.executionJob
      .updateMany({
        where: { id: job.id, status: { in: ["QUEUED", "RUNNING"] } },
        data: {
          status: result.status,
          exitCode: result.exitCode,
          stdout: clip(result.stdout),
          stderr: clip(result.stderr),
          truncated: result.truncated,
          reason: result.reason?.slice(0, 300) ?? null,
          finishedAt,
        },
      })
      .catch((error: unknown) => ctx.logger.error("job update failed", { error: String(error) }));
    await audit(ctx, null, {
      action: "job.finish",
      outcome: result.status === "SUCCEEDED" ? "SUCCESS" : "FAILURE",
      targetType: "ExecutionJob",
      targetId: job.id,
      metadata: {
        projectId: job.projectId,
        requestedById: actorId,
        task: job.task,
        isolation: mode,
        status: result.status,
        exitCode: result.exitCode,
        durationMs: result.durationMs,
      },
    });
  }

  router.post(
    "/",
    ...handle(
      "job:write",
      async (req) => {
        const project = await loadProjectAccess(ctx, req.owner!.id, projectId(req), "write");
        if (project.archivedAt) throw conflict("Restore the project before running jobs.");
        const parsed = submitSchema.safeParse(req.body);
        if (!parsed.success) {
          const fields: Record<string, string> = {};
          for (const issue of parsed.error.issues) fields[String(issue.path[0] ?? "body")] = "Invalid value.";
          throw validationFailed(fields);
        }
        const { task } = parsed.data;
        const dir = await projectDir(project);
        let target = "";
        let nodeArgs: string[];
        if (task === "node-script") {
          target = validateTarget(parsed.data.target);
          await requireTargetFile(dir, target);
          nodeArgs = [target];
        } else {
          nodeArgs = ["--test"];
        }
        const choice = await chooseIsolation(ctx.config.JOB_ISOLATION, image, docker());
        if (choice.unavailable) {
          throw new AppError(503, "UNAVAILABLE", `Container isolation is required but unavailable: ${choice.reason}`);
        }
        // User-supplied code gets no network by default. A container always provides that; the process fallback only
        // does on a Node release that can deny network, so staging/production fail closed instead of silently running
        // with network access (an explicit JOB_ISOLATION=process remains the operator's own choice).
        if (
          choice.mode === "process" &&
          ctx.config.JOB_ISOLATION === "auto" &&
          (ctx.config.NODE_ENV === "production" || ctx.config.NODE_ENV === "staging") &&
          !processConfinementBlocksNetwork()
        ) {
          throw new AppError(
            503,
            "UNAVAILABLE",
            `Jobs need container isolation here (network must be off for user code): ${choice.reason}`,
          );
        }
        const job = await ctx.prisma.executionJob.create({
          data: { projectId: project.id, requestedById: req.owner!.id, task, target, isolation: choice.mode },
        });
        await audit(ctx, req, {
          action: "job.submit",
          outcome: "SUCCESS",
          targetType: "ExecutionJob",
          targetId: job.id,
          metadata: { projectId: project.id, task, target, isolation: choice.mode },
        });
        const controller = new AbortController();
        const done = execute(job, dir, nodeArgs, choice.mode, controller.signal, req.owner!.id)
          .catch((error: unknown) => ctx.logger.error("job failed", { error: String(error) }))
          .finally(() => running.delete(job.id));
        running.set(job.id, { controller, done });
        return { job: jobView(job, image) };
      },
      202,
    ),
  );

  router.get(
    "/",
    ...handle("job:read", async (req) => {
      const jobs = await ctx.prisma.executionJob.findMany({
        where: { projectId: projectId(req) },
        orderBy: { createdAt: "desc" },
        take: 50,
      });
      return { jobs: jobs.map((job) => jobView(job, image)) };
    }),
  );

  router.get("/:jobId", ...handle("job:read", async (req) => ({ job: jobView(await findJob(req), image) })));

  router.get(
    "/:jobId/logs",
    ...handle("job:read", async (req) => {
      const job = await findJob(req);
      return { logs: { stdout: job.stdout, stderr: job.stderr, truncated: job.truncated } };
    }),
  );

  router.post(
    "/:jobId/cancel",
    ...handle("job:write", async (req) => {
      const job = await findJob(req);
      const entry = running.get(job.id);
      if (!entry || (job.status !== "QUEUED" && job.status !== "RUNNING")) {
        throw conflict("This job is not running.");
      }
      await audit(ctx, req, {
        action: "job.cancel",
        outcome: "SUCCESS",
        targetType: "ExecutionJob",
        targetId: job.id,
        metadata: { projectId: job.projectId, previousStatus: job.status },
      });
      entry.controller.abort();
      if (job.status === "QUEUED") {
        await ctx.prisma.executionJob.updateMany({
          where: { id: job.id, status: "QUEUED" },
          data: { status: "CANCELLED", reason: "cancelled by user", finishedAt: ctx.now() },
        });
      }
      await Promise.race([entry.done, new Promise((resolve) => setTimeout(resolve, CANCEL_WAIT_MS))]);
      return { job: jobView(await findJob(req), image) };
    }),
  );

  return router;
}
