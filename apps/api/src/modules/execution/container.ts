import { spawn as nodeSpawn, type ChildProcess, type SpawnOptions } from "node:child_process";
import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { RUN_DIR_PREFIX, type RunLimits, type RunResult } from "../../execution/worker.js";

export type SpawnFn = (command: string, args: string[], options: SpawnOptions) => ChildProcess;

export interface DockerDeps {
  spawn?: SpawnFn;
  /** Executable name or absolute path of the Docker CLI. */
  executable?: string;
}

export type IsolationMode = "process" | "container";

export const CONTAINER_NAME_PREFIX = "asaa-job-";
const PROBE_TIMEOUT_MS = 3000;
const PROBE_TTL_MS = 30_000;
const KILL_GRACE_MS = 3000;

export function processIsolationDescription(blocksNetwork: boolean): string {
  return (
    "Process isolation: runs as a host process in a disposable folder with a scrubbed environment and time, memory, output and disk limits. " +
    "Node's permission model confines file access to that folder and blocks child processes and workers" +
    (blocksNetwork ? " and network access" : "; network access is NOT blocked on this Node release") +
    ". It is not a security boundary against native code: use container isolation for untrusted code."
  );
}

export function containerIsolationDescription(image: string): string {
  return `Container isolation: runs in a Docker container from local image ${image} with no network, a read-only root and project mount, dropped capabilities, and CPU, memory and process limits.`;
}

const dockerEnv = (): Record<string, string> => {
  const env: Record<string, string> = {};
  for (const key of [
    "PATH",
    "Path",
    "SystemRoot",
    "USERPROFILE",
    "HOME",
    "APPDATA",
    "LOCALAPPDATA",
    "DOCKER_HOST",
    "DOCKER_CONTEXT",
    "DOCKER_CONFIG",
  ]) {
    const value = process.env[key];
    if (value) env[key] = value;
  }
  return env;
};

/** Run a short docker CLI command (no shell); resolves with the exit code, or null on spawn error or timeout. */
export function dockerCommand(
  args: string[],
  deps: DockerDeps = {},
  timeoutMs = PROBE_TIMEOUT_MS,
): Promise<{ code: number | null; stdout: string }> {
  const spawnFn = deps.spawn ?? nodeSpawn;
  return new Promise((resolve) => {
    let settled = false;
    let stdout = "";
    const done = (code: number | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ code, stdout });
    };
    let child: ChildProcess;
    try {
      child = spawnFn(deps.executable ?? "docker", args, {
        stdio: ["ignore", "pipe", "ignore"],
        shell: false,
        windowsHide: true,
        env: dockerEnv(),
      });
    } catch {
      resolve({ code: null, stdout: "" });
      return;
    }
    const timer = setTimeout(() => {
      try {
        child.kill();
      } catch {
        // already gone
      }
      done(null);
    }, timeoutMs);
    child.stdout?.on("data", (chunk: Buffer) => {
      if (stdout.length < 4096) stdout += chunk.toString("utf8");
    });
    child.on("error", () => done(null));
    child.on("close", (code) => done(code));
  });
}

export interface IsolationChoice {
  mode: IsolationMode;
  reason: string;
  /** True when container isolation was demanded but cannot be provided. */
  unavailable?: boolean;
}

let cache: { key: string; at: number; usable: boolean; reason: string } | undefined;

export function resetDockerProbeCache(): void {
  cache = undefined;
}

/** True only when the daemon answers `docker info` AND the image already exists locally. Never pulls. */
export async function probeDocker(
  image: string,
  deps: DockerDeps = {},
  now: () => number = Date.now,
): Promise<{ usable: boolean; reason: string }> {
  const key = `${deps.executable ?? "docker"}|${image}`;
  if (cache && cache.key === key && now() - cache.at < PROBE_TTL_MS) return cache;
  let result: { usable: boolean; reason: string };
  if ((await dockerCommand(["info", "--format", "{{.ServerVersion}}"], deps)).code !== 0) {
    result = { usable: false, reason: "Docker is not installed or its daemon is not running." };
  } else if ((await dockerCommand(["image", "inspect", image], deps)).code !== 0) {
    result = { usable: false, reason: `Docker image ${image} is not present locally (images are never pulled).` };
  } else {
    result = { usable: true, reason: "Docker is available." };
  }
  cache = { key, at: now(), ...result };
  return result;
}

/** auto -> container when usable, else process; process -> process; container -> container or unavailable. */
export async function chooseIsolation(
  setting: "auto" | "process" | "container",
  image: string,
  deps: DockerDeps = {},
): Promise<IsolationChoice> {
  if (setting === "process") return { mode: "process", reason: "JOB_ISOLATION=process." };
  const probe = await probeDocker(image, deps);
  if (probe.usable) return { mode: "container", reason: probe.reason };
  if (setting === "container") return { mode: "process", reason: probe.reason, unavailable: true };
  return { mode: "process", reason: `${probe.reason} Falling back to process isolation.` };
}

export function containerName(jobId: string): string {
  return `${CONTAINER_NAME_PREFIX}${jobId}`;
}

/** The exact docker argument vector; the project mount is read-only, scratch space is /tmp. */
export function buildContainerArgs(opts: {
  jobId: string;
  image: string;
  hostDir: string;
  nodeArgs: string[];
  limits: Pick<RunLimits, "maxMemoryMb">;
}): string[] {
  return [
    "run",
    "--rm",
    "--name",
    containerName(opts.jobId),
    "--network",
    "none",
    "--read-only",
    "--tmpfs",
    "/tmp:rw,noexec,nosuid,nodev,size=64m",
    "--ipc",
    "none",
    "--cap-drop",
    "ALL",
    "--security-opt",
    "no-new-privileges",
    "--pids-limit",
    "128",
    "--memory",
    `${opts.limits.maxMemoryMb}m`,
    // Same value as --memory: the container cannot spill into swap to exceed its memory limit.
    "--memory-swap",
    `${opts.limits.maxMemoryMb}m`,
    "--ulimit",
    "nofile=256:256",
    "--cpus",
    "1",
    "--user",
    "1000:1000",
    "-v",
    `${opts.hostDir}:/work:ro`,
    "-w",
    "/work",
    opts.image,
    "node",
    ...opts.nodeArgs,
  ];
}

// ---- concurrency for container runs (same cap as the process worker) -------------------------------------------

export function createLimiter(getMax: () => number) {
  let active = 0;
  const waiting: (() => void)[] = [];
  const pump = () => {
    while (waiting.length > 0 && active < getMax()) {
      active += 1;
      waiting.shift()?.();
    }
  };
  return {
    acquire(signal?: AbortSignal): Promise<boolean> {
      return new Promise((resolve) => {
        const abort = () => {
          const i = waiting.indexOf(grant);
          if (i >= 0) waiting.splice(i, 1);
          resolve(false);
        };
        const grant = () => {
          signal?.removeEventListener("abort", abort);
          resolve(true);
        };
        signal?.addEventListener("abort", abort, { once: true });
        waiting.push(grant);
        pump();
      });
    },
    release() {
      active -= 1;
      pump();
    },
  };
}

// ---- container run ---------------------------------------------------------------------------------------------

export interface ContainerRunOptions {
  jobId: string;
  image: string;
  nodeArgs: string[];
  files: Record<string, Buffer>;
  limits: Required<RunLimits>;
  signal?: AbortSignal;
  onSpawn?: () => void;
  docker?: DockerDeps;
}

const cancelledResult = (reason: string): RunResult => ({
  status: "CANCELLED",
  exitCode: null,
  stdout: "",
  stderr: "",
  truncated: false,
  durationMs: 0,
  reason,
});

export async function runInContainer(opts: ContainerRunOptions): Promise<RunResult> {
  if (opts.signal?.aborted) return cancelledResult("cancelled before start");
  const dir = await mkdtemp(path.join(os.tmpdir(), `${RUN_DIR_PREFIX}c-`));
  const docker = opts.docker ?? {};
  const name = containerName(opts.jobId);
  const removeContainer = () => dockerCommand(["rm", "-f", name], docker, 10_000).catch(() => undefined);
  try {
    // The container user (1000) must be able to read the mount even though the host user owns it.
    if (process.platform !== "win32") await chmod(dir, 0o755);
    for (const [rel, content] of Object.entries(opts.files)) {
      const target = path.join(dir, ...rel.split("/"));
      await mkdir(path.dirname(target), { recursive: true });
      await writeFile(target, content, { flag: "wx", mode: 0o644 });
    }
    return await supervise(opts, dir, removeContainer);
  } finally {
    await removeContainer();
    await rm(dir, { recursive: true, force: true, maxRetries: 30, retryDelay: 100 }).catch(() => undefined);
  }
}

function supervise(
  opts: ContainerRunOptions,
  dir: string,
  removeContainer: () => Promise<unknown>,
): Promise<RunResult> {
  const spawnFn = opts.docker?.spawn ?? nodeSpawn;
  const limits = opts.limits;
  return new Promise<RunResult>((resolve) => {
    const started = Date.now();
    const out: Buffer[] = [];
    const err: Buffer[] = [];
    let captured = 0;
    let truncated = false;
    let status: RunResult["status"] | undefined;
    let reason: string | undefined;
    let settled = false;
    let fallback: NodeJS.Timeout | undefined;

    const args = buildContainerArgs({
      jobId: opts.jobId,
      image: opts.image,
      hostDir: dir,
      nodeArgs: opts.nodeArgs,
      limits,
    });
    let child: ChildProcess;
    try {
      child = spawnFn(opts.docker?.executable ?? "docker", args, {
        stdio: ["ignore", "pipe", "pipe"],
        shell: false,
        windowsHide: true,
        env: dockerEnv(),
      });
    } catch (error) {
      resolve({
        status: "FAILED",
        exitCode: null,
        stdout: "",
        stderr: "",
        truncated: false,
        durationMs: 0,
        reason: `spawn error: ${error instanceof Error ? error.message : String(error)}`,
      });
      return;
    }
    opts.onSpawn?.();

    const onAbort = () => stop("CANCELLED", "cancelled by caller");
    const finish = (code: number | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      if (fallback) clearTimeout(fallback);
      opts.signal?.removeEventListener("abort", onAbort);
      if (!status) {
        if (code === 0) status = "SUCCEEDED";
        else {
          status = "FAILED";
          reason =
            code === null
              ? "terminated by signal"
              : code === 137
                ? "killed (exit 137, possibly memory limit)"
                : `exit code ${code}`;
        }
      }
      resolve({
        status,
        exitCode: code,
        stdout: Buffer.concat(out).toString("utf8"),
        stderr: Buffer.concat(err).toString("utf8"),
        truncated,
        durationMs: Date.now() - started,
        ...(reason ? { reason } : {}),
      });
    };
    function stop(s: RunResult["status"], r: string) {
      if (status || settled) return;
      status = s;
      reason = r;
      void removeContainer();
      try {
        child.kill();
      } catch {
        // already gone
      }
      fallback = setTimeout(() => finish(null), KILL_GRACE_MS);
    }
    const timeout = setTimeout(() => stop("TIMED_OUT", `exceeded ${limits.timeoutMs}ms`), limits.timeoutMs);
    opts.signal?.addEventListener("abort", onAbort, { once: true });

    const capture = (chunks: Buffer[], chunk: Buffer) => {
      if (status) return;
      const room = limits.maxOutputBytes - captured;
      if (chunk.length > room) {
        if (room > 0) chunks.push(chunk.subarray(0, room));
        captured = limits.maxOutputBytes;
        truncated = true;
        stop("LIMIT_EXCEEDED", `output exceeded ${limits.maxOutputBytes} bytes`);
        return;
      }
      chunks.push(chunk);
      captured += chunk.length;
    };
    child.stdout?.on("data", (c: Buffer) => capture(out, c));
    child.stderr?.on("data", (c: Buffer) => capture(err, c));
    child.on("error", (e) => {
      if (!status) {
        status = "FAILED";
        reason = `spawn error: ${e.message}`;
      }
      finish(null);
    });
    child.on("close", (code) => finish(code));
  });
}
