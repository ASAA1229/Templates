import { spawn } from "node:child_process";

/**
 * Safe child-process execution for fixed, platform-chosen executables.
 *
 * - No shell: the executable and an explicit argument array go straight to the OS,
 *   so there is no interpolation, globbing or command chaining.
 * - Controlled working directory and a minimal, explicit environment.
 * - Hard timeout and output-size limit; the process is killed when exceeded.
 * - Arguments must be strings without NUL bytes.
 */
export interface RunOptions {
  cwd: string;
  timeoutMs: number;
  maxOutputBytes: number;
  /** Complete environment for the child (the parent environment is NOT inherited). */
  env: Record<string, string>;
}

export interface RunResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export class ProcessUnavailableError extends Error {
  constructor(readonly executable: string) {
    super(`"${executable}" is not installed or not on PATH.`);
    this.name = "ProcessUnavailableError";
  }
}
export class ProcessTimeoutError extends Error {
  constructor(readonly timeoutMs: number) {
    super(`The command did not finish within ${Math.round(timeoutMs / 1000)} seconds and was stopped.`);
    this.name = "ProcessTimeoutError";
  }
}
export class ProcessOutputLimitError extends Error {
  constructor(readonly limit: number) {
    super(`The command produced more than ${limit} bytes of output and was stopped.`);
    this.name = "ProcessOutputLimitError";
  }
}

/** Minimal environment needed for programs to run on Windows and POSIX. */
export function baseEnvironment(): Record<string, string> {
  const keep = ["PATH", "Path", "SystemRoot", "SYSTEMROOT", "WINDIR", "TEMP", "TMP", "TMPDIR", "HOME", "USERPROFILE"];
  const env: Record<string, string> = {};
  for (const key of keep) {
    const value = process.env[key];
    if (value !== undefined) env[key] = value;
  }
  env.LC_ALL = "C";
  env.LANG = "C";
  return env;
}

export function runProcess(executable: string, args: string[], options: RunOptions): Promise<RunResult> {
  for (const arg of args) {
    if (typeof arg !== "string" || arg.includes("\0")) throw new Error("Invalid process argument.");
  }
  return new Promise<RunResult>((resolve, reject) => {
    let settled = false;
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    let bytes = 0;
    const child = spawn(executable, args, {
      cwd: options.cwd,
      env: options.env,
      shell: false,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const finish = (error: Error | null, result?: RunResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) reject(error);
      else resolve(result!);
    };
    const kill = () => {
      if (child.exitCode === null && !child.killed) child.kill("SIGKILL");
    };
    const timer = setTimeout(() => {
      kill();
      finish(new ProcessTimeoutError(options.timeoutMs));
    }, options.timeoutMs);
    const collect = (sink: Buffer[]) => (chunk: Buffer) => {
      if (settled) return;
      bytes += chunk.length;
      if (bytes > options.maxOutputBytes) {
        kill();
        finish(new ProcessOutputLimitError(options.maxOutputBytes));
        return;
      }
      sink.push(chunk);
    };
    child.stdout.on("data", collect(stdout));
    child.stderr.on("data", collect(stderr));
    child.on("error", (error: NodeJS.ErrnoException) => {
      finish(error.code === "ENOENT" || error.code === "EACCES" ? new ProcessUnavailableError(executable) : error);
    });
    child.on("close", (code) => {
      finish(null, {
        stdout: Buffer.concat(stdout).toString("utf8"),
        stderr: Buffer.concat(stderr).toString("utf8"),
        exitCode: code ?? -1,
      });
    });
  });
}
