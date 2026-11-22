import { spawn, type ChildProcess } from "node:child_process";
import { lstat, mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

/**
 * Honest description of what this worker provides. There is NO network or syscall sandbox: OS-level network
 * blocking (namespaces, firewall rules, containers, seccomp) needs privileged or paid infrastructure that this
 * zero-cost local worker does not assume. Network access is only discouraged on a best-effort basis by scrubbing
 * proxy variables; a child that opens sockets directly can still reach the network.
 */
export const ISOLATION_LEVEL =
  "process-level: temp dir, scrubbed env, time/memory/output/disk limits, tree kill; no network or syscall sandbox";

export const RUN_DIR_PREFIX = "asaa-run-";

export type RunStatus = "SUCCEEDED" | "FAILED" | "TIMED_OUT" | "CANCELLED" | "LIMIT_EXCEEDED";

export interface RunLimits {
  timeoutMs: number;
  maxOutputBytes: number;
  maxMemoryMb: number;
  maxFiles?: number;
  maxDiskBytes: number;
}

export interface RunOptions {
  command: string;
  args: string[];
  files?: Record<string, string | Buffer>;
  limits?: Partial<RunLimits>;
  env?: Record<string, string>;
  signal?: AbortSignal;
  /** Called once the child is spawned (useful for tests and supervision). */
  onSpawn?: (pid: number) => void;
}

export interface RunResult {
  status: RunStatus;
  exitCode: number | null;
  stdout: string;
  stderr: string;
  truncated: boolean;
  durationMs: number;
  reason?: string;
}

export const DEFAULT_LIMITS: Required<RunLimits> = {
  timeoutMs: 10_000,
  maxOutputBytes: 1024 * 1024,
  maxMemoryMb: 256,
  maxFiles: 200,
  maxDiskBytes: 10 * 1024 * 1024,
};

/** Mutable, exported configuration. */
export const executionConfig: { maxConcurrent: number; allowedExecutables: string[] } = {
  maxConcurrent: 2,
  allowedExecutables: [process.execPath],
};

export class ExecutionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ExecutionError";
  }
}

const POLL_MS = 50;
const KILL_GRACE_MS = 3000;
const PROXY_KEYS = /^(https?_proxy|all_proxy|no_proxy)$/i;

// ---- concurrency -----------------------------------------------------------------------------------------------

interface Waiter {
  grant: () => void;
  abort: () => void;
}
let active = 0;
let peakActive = 0;
const waiters: Waiter[] = [];

export function getExecutionStats(): { active: number; queued: number; peakActive: number } {
  return { active, queued: waiters.length, peakActive };
}

export function resetExecutionStats(): void {
  peakActive = active;
}

function pump(): void {
  while (waiters.length > 0 && active < executionConfig.maxConcurrent) {
    active += 1;
    peakActive = Math.max(peakActive, active);
    waiters.shift()?.grant();
  }
}

function acquire(signal?: AbortSignal): Promise<boolean> {
  return new Promise((resolve) => {
    const waiter: Waiter = {
      grant: () => {
        signal?.removeEventListener("abort", waiter.abort);
        resolve(true);
      },
      abort: () => {
        const i = waiters.indexOf(waiter);
        if (i >= 0) waiters.splice(i, 1);
        resolve(false);
      },
    };
    signal?.addEventListener("abort", waiter.abort, { once: true });
    waiters.push(waiter);
    pump();
  });
}

function release(): void {
  active -= 1;
  pump();
}

// ---- helpers ---------------------------------------------------------------------------------------------------

export async function listLeftoverRunDirs(): Promise<string[]> {
  const entries = await readdir(os.tmpdir());
  return entries.filter((e) => e.startsWith(RUN_DIR_PREFIX));
}

function sameExe(a: string, b: string): boolean {
  const x = path.resolve(a);
  const y = path.resolve(b);
  return process.platform === "win32" ? x.toLowerCase() === y.toLowerCase() : x === y;
}

function validateFilePath(rel: string): string {
  if (rel.length === 0 || rel.includes("\0")) throw new ExecutionError(`invalid file path: ${JSON.stringify(rel)}`);
  if (path.isAbsolute(rel) || path.win32.isAbsolute(rel) || path.posix.isAbsolute(rel) || /^[a-zA-Z]:/.test(rel)) {
    throw new ExecutionError(`absolute file path rejected: ${rel}`);
  }
  const parts = rel.split(/[\\/]/);
  if (parts.some((p) => p === ".." || p === "" || p === ".")) {
    throw new ExecutionError(`path traversal rejected: ${rel}`);
  }
  return parts.join(path.sep);
}

async function writeInputFiles(dir: string, files: Record<string, string | Buffer>): Promise<void> {
  for (const [rel, content] of Object.entries(files)) {
    const clean = validateFilePath(rel);
    const target = path.join(dir, clean);
    const relCheck = path.relative(dir, target);
    if (relCheck.startsWith("..") || path.isAbsolute(relCheck)) {
      throw new ExecutionError(`path traversal rejected: ${rel}`);
    }
    // Reject symlinks anywhere along the parent chain.
    let cur = dir;
    for (const part of path
      .dirname(clean)
      .split(path.sep)
      .filter((p) => p !== ".")) {
      cur = path.join(cur, part);
      const st = await lstat(cur).catch(() => null);
      if (st?.isSymbolicLink()) throw new ExecutionError(`symlink rejected: ${rel}`);
    }
    await mkdir(path.dirname(target), { recursive: true });
    // 'wx' refuses to overwrite (and never follows a pre-existing symlink).
    await writeFile(target, content, { flag: "wx" });
  }
}

async function measureDir(dir: string): Promise<{ bytes: number; files: number }> {
  let bytes = 0;
  let files = 0;
  const walk = async (d: string): Promise<void> => {
    let entries;
    try {
      entries = await readdir(d, { withFileTypes: true });
    } catch {
      return; // directory vanished mid-walk
    }
    for (const e of entries) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) await walk(p);
      else {
        files += 1;
        const st = await lstat(p).catch(() => null);
        if (st) bytes += st.size;
      }
    }
  };
  await walk(dir);
  return { bytes, files };
}

function killTree(child: ChildProcess): Promise<void> {
  const pid = child.pid;
  if (pid === undefined) return Promise.resolve();
  const fallback = (): void => {
    try {
      child.kill("SIGKILL");
    } catch {
      // already gone
    }
  };
  if (process.platform === "win32") {
    return new Promise((resolve) => {
      const k = spawn("taskkill", ["/pid", String(pid), "/T", "/F"], { stdio: "ignore", windowsHide: true });
      k.on("error", () => {
        fallback();
        resolve();
      });
      k.on("close", () => resolve());
    });
  }
  try {
    process.kill(-pid, "SIGKILL"); // child is its own process-group leader (detached)
  } catch {
    fallback();
  }
  return Promise.resolve();
}

function linuxRssMb(pid: number): number | null {
  if (process.platform !== "linux") return null;
  try {
    const m = /VmRSS:\s+(\d+)\s+kB/.exec(readFileSync(`/proc/${pid}/status`, "utf8"));
    return m?.[1] ? Number(m[1]) / 1024 : null;
  } catch {
    return null;
  }
}

function buildEnv(dir: string, extra: Record<string, string> | undefined): Record<string, string> {
  const env: Record<string, string> = {};
  const pathValue = process.env.PATH ?? process.env.Path;
  if (pathValue) env.PATH = pathValue;
  if (process.platform === "win32" && process.env.SystemRoot) env.SystemRoot = process.env.SystemRoot;
  env.HOME = dir;
  env.USERPROFILE = dir;
  env.TEMP = dir;
  env.TMP = dir;
  env.TMPDIR = dir;
  for (const [k, v] of Object.entries(extra ?? {})) if (!PROXY_KEYS.test(k)) env[k] = v;
  return env;
}

// ---- supervision -----------------------------------------------------------------------------------------------

function supervise(dir: string, opts: RunOptions, limits: Required<RunLimits>): Promise<RunResult> {
  return new Promise<RunResult>((resolve) => {
    const started = Date.now();
    const isNode = sameExe(opts.command, process.execPath);
    // Memory cap: V8 heap limit for node children. RSS is additionally polled on Linux only.
    const args = isNode ? [`--max-old-space-size=${limits.maxMemoryMb}`, ...opts.args] : opts.args;

    let status: RunStatus | undefined;
    let reason: string | undefined;
    let truncated = false;
    let captured = 0;
    let settled = false;
    let killing: Promise<void> = Promise.resolve();
    const out: Buffer[] = [];
    const err: Buffer[] = [];

    const child = spawn(opts.command, args, {
      cwd: dir,
      env: buildEnv(dir, opts.env),
      stdio: ["ignore", "pipe", "pipe"],
      detached: process.platform !== "win32",
      windowsHide: true,
      shell: false,
    });
    if (child.pid !== undefined) opts.onSpawn?.(child.pid);

    let fallbackTimer: NodeJS.Timeout | undefined;
    const timeout = setTimeout(() => stop("TIMED_OUT", `exceeded ${limits.timeoutMs}ms`), limits.timeoutMs);
    let polling = false;
    const poll = setInterval(() => {
      if (polling || status) return;
      polling = true;
      void (async () => {
        try {
          const m = await measureDir(dir);
          if (m.bytes > limits.maxDiskBytes) {
            stop("LIMIT_EXCEEDED", `disk usage exceeded ${limits.maxDiskBytes} bytes`);
          } else if (m.files > limits.maxFiles) {
            stop("LIMIT_EXCEEDED", `file count exceeded ${limits.maxFiles}`);
          } else if (child.pid !== undefined) {
            const rss = linuxRssMb(child.pid);
            if (rss !== null && rss > limits.maxMemoryMb * 2) {
              stop("LIMIT_EXCEEDED", `memory exceeded ${limits.maxMemoryMb}MB`);
            }
          }
        } finally {
          polling = false;
        }
      })();
    }, POLL_MS);
    const onAbort = (): void => stop("CANCELLED", "cancelled by caller");
    opts.signal?.addEventListener("abort", onAbort, { once: true });

    function stop(s: RunStatus, r: string): void {
      if (status || settled) return;
      status = s;
      reason = r;
      killing = killTree(child);
      fallbackTimer = setTimeout(() => finish(null), KILL_GRACE_MS);
    }

    function capture(chunks: Buffer[], chunk: Buffer): void {
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
    }

    function finish(code: number | null): void {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      clearInterval(poll);
      if (fallbackTimer) clearTimeout(fallbackTimer);
      opts.signal?.removeEventListener("abort", onAbort);
      const stderr = Buffer.concat(err).toString("utf8");
      if (!status) {
        if (code === 0) status = "SUCCEEDED";
        else if (/heap out of memory|allocation failed/i.test(stderr)) {
          status = "LIMIT_EXCEEDED";
          reason = `memory limit ${limits.maxMemoryMb}MB exceeded`;
        } else {
          status = "FAILED";
          reason = code === null ? "terminated by signal" : `exit code ${code}`;
        }
      }
      void killing.then(() =>
        resolve({
          status: status as RunStatus,
          exitCode: code,
          stdout: Buffer.concat(out).toString("utf8"),
          stderr,
          truncated,
          durationMs: Date.now() - started,
          ...(reason ? { reason } : {}),
        }),
      );
    }

    child.stdout?.on("data", (c: Buffer) => capture(out, c));
    child.stderr?.on("data", (c: Buffer) => capture(err, c));
    child.on("error", (e) => {
      if (!status) {
        status = "FAILED";
        reason = `spawn error: ${e.message}`;
      }
      finish(null);
    });
    child.on("exit", () => {
      // A grandchild may keep the pipes open after the leader exits; do not wait forever.
      setTimeout(() => {
        if (settled) return;
        killing = killTree(child);
        finish(child.exitCode);
      }, 500).unref();
    });
    child.on("close", (code) => finish(code));
  });
}

// ---- public API ------------------------------------------------------------------------------------------------

const cancelled = (reason: string): RunResult => ({
  status: "CANCELLED",
  exitCode: null,
  stdout: "",
  stderr: "",
  truncated: false,
  durationMs: 0,
  reason,
});

export async function runIsolated(opts: RunOptions): Promise<RunResult> {
  if (!executionConfig.allowedExecutables.some((a) => sameExe(a, opts.command))) {
    throw new ExecutionError(`executable not allowed: ${opts.command}`);
  }
  const limits: Required<RunLimits> = { ...DEFAULT_LIMITS, ...opts.limits } as Required<RunLimits>;
  const files = opts.files ?? {};
  if (Object.keys(files).length > limits.maxFiles) throw new ExecutionError("too many input files");
  const seen = new Set<string>();
  for (const rel of Object.keys(files)) {
    const clean = validateFilePath(rel);
    if (seen.has(clean)) throw new ExecutionError(`duplicate file path: ${rel}`);
    seen.add(clean);
  }

  if (opts.signal?.aborted) return cancelled("cancelled before start");
  if (!(await acquire(opts.signal))) return cancelled("cancelled while queued");
  let dir: string | undefined;
  try {
    dir = await mkdtemp(path.join(os.tmpdir(), RUN_DIR_PREFIX));
    await writeInputFiles(dir, files);
    return await supervise(dir, opts, limits);
  } finally {
    if (dir) {
      if (process.platform === "win32") await new Promise((resolve) => setTimeout(resolve, 250));
      await rm(dir, { recursive: true, force: true, maxRetries: 100, retryDelay: 200 }).catch(() => undefined);
    }
    release();
  }
}
