import os from "node:os";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  ISOLATION_LEVEL,
  executionConfig,
  getExecutionStats,
  listLeftoverRunDirs,
  resetExecutionStats,
  runIsolated,
  type RunOptions,
} from "../src/execution/worker.js";

const node = process.execPath;
const run = (code: string, extra: Partial<RunOptions> = {}) =>
  runIsolated({ command: node, args: ["-e", code], ...extra });

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function waitDead(pid: number, ms = 5000): Promise<boolean> {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (!alive(pid)) return true;
    await new Promise((r) => setTimeout(r, 50));
  }
  return !alive(pid);
}

beforeEach(() => {
  executionConfig.maxConcurrent = 2;
});

afterEach(async () => {
  expect(await listLeftoverRunDirs()).toEqual([]);
});

describe("runIsolated", () => {
  it("declares an honest isolation level", () => {
    expect(ISOLATION_LEVEL).toMatch(/no network or syscall sandbox/);
  });

  it("captures stdout on success and runs in a temp dir with provided files", async () => {
    const r = await run("console.log(require('fs').readFileSync('in/a.txt','utf8')+'|'+process.cwd())", {
      files: { "in/a.txt": "hello" },
    });
    expect(r.status).toBe("SUCCEEDED");
    expect(r.exitCode).toBe(0);
    expect(r.truncated).toBe(false);
    expect(r.stdout).toContain("hello|");
    expect(r.stdout).toContain("asaa-run-");
    expect(r.stdout.toLowerCase()).toContain(os.tmpdir().slice(0, 3).toLowerCase());
  });

  it("reports non-zero exit as FAILED", async () => {
    const r = await run("console.error('boom');process.exit(3)");
    expect(r.status).toBe("FAILED");
    expect(r.exitCode).toBe(3);
    expect(r.stderr).toContain("boom");
  });

  it("times out an infinite loop and the process is really dead", async () => {
    let pid = 0;
    const r = await run("for(;;){}", { limits: { timeoutMs: 800 }, onSpawn: (p) => (pid = p) });
    expect(r.status).toBe("TIMED_OUT");
    expect(r.durationMs).toBeLessThan(6000);
    expect(pid).toBeGreaterThan(0);
    expect(await waitDead(pid)).toBe(true);
  });

  it("kills the whole process tree including grandchildren", async () => {
    const code = `
      const g = require('child_process').spawn(process.execPath, ['-e', 'setInterval(()=>{},1000)'], {stdio:'ignore'});
      console.log('GRAND:' + g.pid);
      setInterval(()=>{},1000);`;
    const r = await run(code, { limits: { timeoutMs: 2000 } });
    expect(r.status).toBe("TIMED_OUT");
    const grand = Number(/GRAND:(\d+)/.exec(r.stdout)?.[1]);
    expect(grand).toBeGreaterThan(0);
    expect(await waitDead(grand)).toBe(true);
  });

  it("caps an output flood and kills the child", async () => {
    const code = `
      const b = Buffer.alloc(1 << 20, 'x'); let i = 0;
      function w(){ while(i < 50){ i++; if(!process.stdout.write(b)){ process.stdout.once('drain', w); return; } } }
      w();`;
    const r = await run(code, { limits: { maxOutputBytes: 100_000, timeoutMs: 12_000 } });
    expect(r.status).toBe("LIMIT_EXCEEDED");
    expect(r.truncated).toBe(true);
    expect(r.stdout.length).toBeLessThanOrEqual(100_000);
  });

  it("ends a memory hog without hanging the parent", async () => {
    const r = await run("const a=[];for(;;)a.push(new Array(1e6).fill(1));", {
      limits: { maxMemoryMb: 32, timeoutMs: 12_000 },
    });
    expect(["FAILED", "LIMIT_EXCEEDED"]).toContain(r.status);
    const ok = await run("console.log('alive')");
    expect(ok.stdout.trim()).toBe("alive");
  });

  it("kills a disk filler with LIMIT_EXCEEDED", async () => {
    const code = `
      const fs = require('fs'); const b = Buffer.alloc(1 << 20, 1);
      for (let i = 0; i < 300; i++) fs.writeFileSync('f' + i, b);
      setInterval(()=>{},1000);`;
    const r = await run(code, { limits: { maxDiskBytes: 5 * 1024 * 1024, timeoutMs: 12_000 } });
    expect(r.status).toBe("LIMIT_EXCEEDED");
    expect(r.reason).toMatch(/disk|file count/);
  });

  it("cancels mid-run via AbortSignal", async () => {
    const ac = new AbortController();
    let pid = 0;
    const p = run("setInterval(()=>{},1000)", { signal: ac.signal, onSpawn: (x) => (pid = x) });
    setTimeout(() => ac.abort(), 500);
    const r = await p;
    expect(r.status).toBe("CANCELLED");
    expect(await waitDead(pid)).toBe(true);
    const pre = new AbortController();
    pre.abort();
    expect((await run("console.log(1)", { signal: pre.signal })).status).toBe("CANCELLED");
  });

  it("does not leak process.env secrets to the child", async () => {
    process.env.ASAA_SECRET_PROBE = "topsecret";
    process.env.DATABASE_URL = "postgres://secret";
    try {
      const r = await run(
        "console.log([process.env.ASAA_SECRET_PROBE ?? 'absent', process.env.DATABASE_URL ?? 'absent', process.env.EXPLICIT ?? 'absent', process.env.HTTP_PROXY ?? 'noproxy'].join(','))",
        { env: { EXPLICIT: "yes", HTTP_PROXY: "http://x" } },
      );
      expect(r.stdout.trim()).toBe("absent,absent,yes,noproxy");
    } finally {
      delete process.env.ASAA_SECRET_PROBE;
      delete process.env.DATABASE_URL;
    }
  });

  it("rejects path traversal, absolute paths and bad file names", async () => {
    for (const name of ["../evil.txt", "a/../../evil.txt", "/abs.txt", "C:\\abs.txt", "a//b", ""]) {
      await expect(run("1", { files: { [name]: "x" } })).rejects.toThrow();
    }
  });

  it("rejects executables outside the allowlist", async () => {
    await expect(runIsolated({ command: "cmd.exe", args: [] })).rejects.toThrow(/not allowed/);
    await expect(runIsolated({ command: "/bin/sh", args: ["-c", "true"] })).rejects.toThrow(/not allowed/);
  });

  it("respects the concurrency cap and queues the rest", async () => {
    resetExecutionStats();
    const runs = Array.from({ length: 5 }, () => run("setTimeout(()=>{},400)"));
    await new Promise((r) => setTimeout(r, 100));
    expect(getExecutionStats().active).toBeLessThanOrEqual(2);
    expect(getExecutionStats().queued).toBeGreaterThan(0);
    const results = await Promise.all(runs);
    expect(results.every((r) => r.status === "SUCCEEDED")).toBe(true);
    expect(getExecutionStats().peakActive).toBe(2);
    expect(getExecutionStats().active).toBe(0);
  });
});
