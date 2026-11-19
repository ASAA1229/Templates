import { EventEmitter } from "node:events";
import type { ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { listLeftoverRunDirs } from "../src/execution/worker.js";
import { hashPassword } from "../src/lib/password.js";
import {
  buildContainerArgs,
  chooseIsolation,
  probeDocker,
  resetDockerProbeCache,
  runInContainer,
  type DockerDeps,
  type SpawnFn,
} from "../src/modules/execution/container.js";
import { jobsRuntime } from "../src/modules/execution/jobs.js";
import { createHarness } from "./helpers.js";

/** RG-07: authenticated build/test jobs with process isolation and an optional Docker container boundary. */
const PASSWORD = "a sufficiently long test password";
const IMAGE = "node:24.22.3-alpine3.24";

// ---- fake docker -----------------------------------------------------------------------------------------------

interface FakeCall {
  command: string;
  args: string[];
}

/** Fake `spawn`: `handler` decides how each docker invocation behaves. */
function fakeDocker(handler: (call: FakeCall, child: FakeChild) => void): { deps: DockerDeps; calls: FakeCall[] } {
  const calls: FakeCall[] = [];
  const spawn = ((command: string, args: string[]) => {
    const call = { command, args };
    calls.push(call);
    const child = new FakeChild();
    setImmediate(() => handler(call, child));
    return child as unknown as ChildProcess;
  }) as unknown as SpawnFn;
  return { deps: { spawn }, calls };
}

class FakeChild extends EventEmitter {
  stdout = new EventEmitter();
  stderr = new EventEmitter();
  killed = false;
  kill(): boolean {
    this.killed = true;
    this.emit("close", null);
    return true;
  }
  exit(code: number, out = "", err = ""): void {
    if (out) this.stdout.emit("data", Buffer.from(out));
    if (err) this.stderr.emit("data", Buffer.from(err));
    this.emit("close", code);
  }
}

const dockerAbsent = () =>
  fakeDocker((_call, child) => {
    child.emit("error", Object.assign(new Error("spawn docker ENOENT"), { code: "ENOENT" }));
  });
const dockerReady = (onRun?: (call: FakeCall, child: FakeChild) => void) =>
  fakeDocker((call, child) => {
    if (call.args[0] === "run" && onRun) onRun(call, child);
    else if (call.args[0] === "run") child.exit(0, "from container\n");
    else child.exit(0, "27.0.0");
  });

// ---- unit tests ------------------------------------------------------------------------------------------------

describe("container command and isolation selection", () => {
  beforeEach(() => resetDockerProbeCache());

  it("builds the exact hardened docker command", () => {
    expect(
      buildContainerArgs({
        jobId: "abc",
        image: IMAGE,
        hostDir: "/tmp/asaa-run-x",
        nodeArgs: ["--test"],
        limits: { maxMemoryMb: 256 },
      }),
    ).toEqual([
      "run",
      "--rm",
      "--name",
      "asaa-job-abc",
      "--network",
      "none",
      "--read-only",
      "--tmpfs",
      "/tmp:rw,size=64m",
      "--cap-drop",
      "ALL",
      "--security-opt",
      "no-new-privileges",
      "--pids-limit",
      "128",
      "--memory",
      "256m",
      "--cpus",
      "1",
      "--user",
      "1000:1000",
      "-v",
      "/tmp/asaa-run-x:/work:ro",
      "-w",
      "/work",
      IMAGE,
      "node",
      "--test",
    ]);
  });

  it("falls back to process isolation when docker is absent (auto) and refuses when container is required", async () => {
    const fake = dockerAbsent();
    const auto = await chooseIsolation("auto", IMAGE, fake.deps);
    expect(auto).toMatchObject({ mode: "process" });
    expect(auto.reason).toMatch(/Falling back to process/);
    expect(auto.unavailable).toBeUndefined();
    expect((await chooseIsolation("container", IMAGE, fake.deps)).unavailable).toBe(true);
    expect((await chooseIsolation("process", IMAGE, fake.deps)).mode).toBe("process");
  });

  it("uses a container only when the daemon answers and the image exists, never pulling, and caches the probe", async () => {
    const ready = dockerReady();
    expect((await chooseIsolation("auto", IMAGE, ready.deps)).mode).toBe("container");
    const before = ready.calls.length;
    expect((await chooseIsolation("auto", IMAGE, ready.deps)).mode).toBe("container");
    expect(ready.calls.length).toBe(before); // cached
    expect(ready.calls.map((c) => c.args[0])).toEqual(["info", "image"]);
    expect(ready.calls.some((c) => c.args.includes("pull"))).toBe(false);

    resetDockerProbeCache();
    const noImage = fakeDocker((call, child) => child.exit(call.args[0] === "info" ? 0 : 1));
    const probe = await probeDocker(IMAGE, noImage.deps);
    expect(probe.usable).toBe(false);
    expect(probe.reason).toMatch(/not present locally/);
    expect(noImage.calls.some((c) => c.args[0] === "pull" || c.args[0] === "run")).toBe(false);
  });

  it("treats a hung docker probe as unavailable after its timeout", async () => {
    const hung = fakeDocker(() => undefined);
    const started = Date.now();
    const probe = await probeDocker(IMAGE, hung.deps);
    expect(probe.usable).toBe(false);
    expect(Date.now() - started).toBeLessThan(5000);
  });

  const limits = { timeoutMs: 5000, maxOutputBytes: 1000, maxMemoryMb: 256, maxFiles: 100, maxDiskBytes: 1_000_000 };

  it("runs through the injected spawn with a read-only mount and cleans up its folder", async () => {
    let mounted = "";
    let existedDuringRun = false;
    const fake = dockerReady((call, child) => {
      mounted = call.args[call.args.indexOf("-v") + 1]!.replace(/:\/work:ro$/, "");
      existedDuringRun = existsSync(path.join(mounted, "main.js"));
      child.exit(0, "hello");
    });
    const result = await runInContainer({
      jobId: "job1",
      image: IMAGE,
      nodeArgs: ["main.js"],
      files: { "main.js": Buffer.from("1") },
      limits,
      docker: fake.deps,
    });
    expect(result).toMatchObject({ status: "SUCCEEDED", stdout: "hello", exitCode: 0 });
    expect(existedDuringRun).toBe(true);
    expect(existsSync(mounted)).toBe(false);
    expect(fake.calls.at(-1)).toEqual({ command: "docker", args: ["rm", "-f", "asaa-job-job1"] });
  });

  it("removes the container on cancel and on timeout, and caps output", async () => {
    const hang = dockerReady(() => undefined);
    const controller = new AbortController();
    const cancelled = runInContainer({
      jobId: "job2",
      image: IMAGE,
      nodeArgs: ["--test"],
      files: {},
      limits,
      signal: controller.signal,
      docker: hang.deps,
    });
    await new Promise((resolve) => setTimeout(resolve, 100));
    controller.abort();
    expect((await cancelled).status).toBe("CANCELLED");
    expect(hang.calls.some((c) => c.args.join(" ") === "rm -f asaa-job-job2")).toBe(true);

    const slow = dockerReady(() => undefined);
    const timedOut = await runInContainer({
      jobId: "job3",
      image: IMAGE,
      nodeArgs: ["--test"],
      files: {},
      limits: { ...limits, timeoutMs: 200 },
      docker: slow.deps,
    });
    expect(timedOut.status).toBe("TIMED_OUT");
    expect(slow.calls.some((c) => c.args.join(" ") === "rm -f asaa-job-job3")).toBe(true);

    const noisy = dockerReady((_call, child) => child.exit(0, "x".repeat(5000)));
    const capped = await runInContainer({
      jobId: "job4",
      image: IMAGE,
      nodeArgs: ["--test"],
      files: {},
      limits,
      docker: noisy.deps,
    });
    expect(capped).toMatchObject({ status: "LIMIT_EXCEEDED", truncated: true });
    expect(capped.stdout.length).toBe(1000);
  });
});

// ---- API tests -------------------------------------------------------------------------------------------------

describe("build/test job API", () => {
  let base: string;
  let output: string;
  let h: ReturnType<typeof createHarness>;
  let baselineDirs: Set<string>;

  beforeAll(async () => {
    base = await mkdtemp(path.join(tmpdir(), "asaa-jobs-"));
    output = path.join(base, "output");
    h = createHarness({ GENERATION_OUTPUT_DIR: output });
    baselineDirs = new Set(await listLeftoverRunDirs());
  });
  afterAll(async () => {
    await h.close();
    await rm(base, { recursive: true, force: true, maxRetries: 8, retryDelay: 250 });
  });
  beforeEach(async () => {
    await rm(output, { recursive: true, force: true, maxRetries: 8, retryDelay: 250 });
    await h.reset();
    await h.createOwner();
    resetDockerProbeCache();
    jobsRuntime.docker = dockerAbsent().deps;
    jobsRuntime.limits = undefined;
  });
  afterEach(() => {
    jobsRuntime.docker = undefined;
    jobsRuntime.limits = undefined;
    resetDockerProbeCache();
  });

  async function member(email: string) {
    const user = await h.ctx.prisma.owner.create({
      data: {
        email,
        displayName: email,
        role: "EMPLOYEE",
        passwordHash: await hashPassword(PASSWORD),
        passwordChangedAt: new Date(h.clock.now.getTime() - 1000),
        createdAt: new Date(h.clock.now.getTime() - 1000),
      },
    });
    const agent = h.agent();
    expect((await agent.post("/api/auth/login", { email, password: PASSWORD })).status).toBe(200);
    return { user, agent };
  }

  async function project(scripts: Record<string, string> = {}) {
    const { agent, user } = await member("author@asaa.test");
    const created = await agent.post("/api/generations", {
      mode: "SCRATCH",
      projectType: "web-app",
      project: { key: "JOBS", name: "Jobs", purpose: "Run jobs" },
      inputs: {},
    });
    expect(created.status).toBe(201);
    const generation = created.body.generation;
    const root = path.join(output, generation.outputDir);
    for (const [name, source] of Object.entries(scripts)) await writeFile(path.join(root, name), source);
    return {
      agent,
      user,
      projectId: generation.projectId as string,
      root,
      jobs: `/api/projects/${generation.projectId}/jobs`,
    };
  }

  type Agent = ReturnType<typeof h.agent>;
  async function waitFor(agent: Agent, url: string, done: (status: string) => boolean) {
    for (let i = 0; i < 200; i++) {
      const response = await agent.get(url);
      if (done(response.body.job?.status)) return response.body.job;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    throw new Error("job did not reach the expected state");
  }
  const final = (status: string) => !["QUEUED", "RUNNING"].includes(status);

  it("runs a node script, stores status and logs, and labels isolation honestly", async () => {
    const p = await project({ "hello.js": "console.log(1+1); console.error('warn')" });
    const submitted = await p.agent.post(p.jobs, { task: "node-script", target: "hello.js" });
    expect(submitted.status).toBe(202);
    expect(submitted.body.job).toMatchObject({ task: "node-script", target: "hello.js", isolation: "process" });
    expect(submitted.body.job.isolationDescription).toMatch(/NO network sandbox and NO filesystem sandbox/);
    const job = await waitFor(p.agent, `${p.jobs}/${submitted.body.job.id}`, final);
    expect(job).toMatchObject({ status: "SUCCEEDED", exitCode: 0, isolation: "process" });
    expect(job.finishedAt).not.toBeNull();
    const logs = await p.agent.get(`${p.jobs}/${job.id}/logs`);
    expect(logs.status).toBe(200);
    expect(logs.body.logs.stdout).toContain("2");
    expect(logs.body.logs.stderr).toContain("warn");
    expect(logs.body.logs.truncated).toBe(false);
    const list = await p.agent.get(p.jobs);
    expect(list.body.jobs.map((j: { id: string }) => j.id)).toContain(job.id);
    // Source folder is untouched by the job.
    expect(existsSync(path.join(p.root, "hello.js"))).toBe(true);
    const audits = await h.ctx.prisma.auditEvent.findMany({
      where: { action: { in: ["job.submit", "job.finish"] } },
    });
    expect(audits.map((a) => a.action).sort()).toEqual(["job.finish", "job.submit"]);
    const text = JSON.stringify(audits.map((a) => a.metadata));
    expect(text).not.toContain("console.log");
    expect(text).not.toContain("warn");
  });

  it("runs node --test", async () => {
    const p = await project({
      "sample.test.mjs":
        "import test from 'node:test'; import assert from 'node:assert'; test('ok', () => assert.equal(1, 1));",
    });
    // The generated scaffold ships a vitest spec that cannot run without installed dependencies.
    await rm(path.join(p.root, "src", "App.test.ts"), { force: true });
    const submitted = await p.agent.post(p.jobs, { task: "node-test" });
    expect(submitted.status).toBe(202);
    const job = await waitFor(p.agent, `${p.jobs}/${submitted.body.job.id}`, final);
    expect(job.status).toBe("SUCCEEDED");
  }, 180_000);

  it("reports a failing script as FAILED with its exit code", async () => {
    const p = await project({ "bad.js": "console.log('x'); process.exit(3)" });
    const submitted = await p.agent.post(p.jobs, { task: "node-script", target: "bad.js" });
    const job = await waitFor(p.agent, `${p.jobs}/${submitted.body.job.id}`, final);
    expect(job).toMatchObject({ status: "FAILED", exitCode: 3 });
    expect(job.reason).toMatch(/exit code 3/);
  });

  it("times out an infinite loop", async () => {
    jobsRuntime.limits = { timeoutMs: 1500 };
    const p = await project({ "loop.js": "while (true) {}" });
    const submitted = await p.agent.post(p.jobs, { task: "node-script", target: "loop.js" });
    const job = await waitFor(p.agent, `${p.jobs}/${submitted.body.job.id}`, final);
    expect(job.status).toBe("TIMED_OUT");
  });

  it("cancels a running job and leaves no run folders behind", async () => {
    const p = await project({ "wait.js": "console.log('started'); setInterval(() => {}, 1000)" });
    const submitted = await p.agent.post(p.jobs, { task: "node-script", target: "wait.js" });
    const url = `${p.jobs}/${submitted.body.job.id}`;
    await waitFor(p.agent, url, (status) => status === "RUNNING");
    const cancelled = await p.agent.post(`${url}/cancel`);
    expect(cancelled.status).toBe(200);
    expect(cancelled.body.job.status).toBe("CANCELLED");
    expect((await p.agent.post(`${url}/cancel`)).status).toBe(409);
    const leftovers = (await listLeftoverRunDirs()).filter((dir) => !baselineDirs.has(dir));
    expect(leftovers).toEqual([]);
    const actions = (await h.ctx.prisma.auditEvent.findMany({ where: { action: "job.cancel" } })).length;
    expect(actions).toBe(1);
  });

  it("does not expose server environment secrets to the job", async () => {
    process.env.ASAA_JOB_TEST_SECRET = "super-secret-value-123";
    try {
      const p = await project({
        "env.js":
          "console.log('SECRET=' + (process.env.ASAA_JOB_TEST_SECRET ?? 'absent')); console.log('DB=' + (process.env.DATABASE_URL ?? 'absent'));",
      });
      const submitted = await p.agent.post(p.jobs, { task: "node-script", target: "env.js" });
      const job = await waitFor(p.agent, `${p.jobs}/${submitted.body.job.id}`, final);
      expect(job.status).toBe("SUCCEEDED");
      const logs = (await p.agent.get(`${p.jobs}/${job.id}/logs`)).body.logs.stdout as string;
      expect(logs).toContain("SECRET=absent");
      expect(logs).toContain("DB=absent");
      expect(logs).not.toContain("super-secret-value-123");
    } finally {
      delete process.env.ASAA_JOB_TEST_SECRET;
    }
  });

  it("enforces project authorization: viewers read, cannot submit or cancel; strangers and anonymous are blocked", async () => {
    const p = await project({ "hello.js": "console.log('visible')", "wait.js": "setInterval(() => {}, 1000)" });
    const viewer = await member("viewer@asaa.test");
    const stranger = await member("stranger@asaa.test");
    await p.agent.post(`/api/projects/${p.projectId}/members`, { email: viewer.user.email, role: "VIEWER" });
    const submitted = await p.agent.post(p.jobs, { task: "node-script", target: "hello.js" });
    const id = submitted.body.job.id as string;
    await waitFor(p.agent, `${p.jobs}/${id}`, final);

    expect((await viewer.agent.post(p.jobs, { task: "node-script", target: "hello.js" })).status).toBe(404);
    expect((await viewer.agent.get(p.jobs)).status).toBe(200);
    expect((await viewer.agent.get(`${p.jobs}/${id}`)).status).toBe(200);
    expect((await viewer.agent.get(`${p.jobs}/${id}/logs`)).body.logs.stdout).toContain("visible");

    const running = await p.agent.post(p.jobs, { task: "node-script", target: "wait.js" });
    const runUrl = `${p.jobs}/${running.body.job.id}`;
    await waitFor(p.agent, runUrl, (status) => status === "RUNNING");
    expect((await viewer.agent.post(`${runUrl}/cancel`)).status).toBe(404);
    expect((await viewer.agent.get(runUrl)).body.job.status).toBe("RUNNING");
    expect((await p.agent.post(`${runUrl}/cancel`)).status).toBe(200);

    for (const response of [
      await stranger.agent.get(p.jobs),
      await stranger.agent.get(`${p.jobs}/${id}`),
      await stranger.agent.get(`${p.jobs}/${id}/logs`),
      await stranger.agent.post(p.jobs, { task: "node-script", target: "hello.js" }),
      await stranger.agent.post(`${p.jobs}/${id}/cancel`),
    ]) {
      expect(response.status).toBe(404);
      expect(JSON.stringify(response.body)).not.toContain("visible");
    }
    const anon = h.agent();
    expect((await anon.get(p.jobs)).status).toBe(401);
    expect((await anon.post(p.jobs, { task: "node-test" })).status).toBe(401);
    expect((await anon.get(`${p.jobs}/${id}/logs`)).status).toBe(401);
    // A job id from another project is not reachable through this one.
    expect(
      (
        await p.agent.get(
          `/api/projects/${p.projectId.replace(/.$/, p.projectId.endsWith("0") ? "1" : "0")}/jobs/${id}`,
        )
      ).status,
    ).toBe(404);
  });

  it("rejects unsafe or invalid targets and bodies", async () => {
    const p = await project({ "ok.js": "1" });
    await mkdir(path.join(p.root, "dir"));
    await mkdir(path.join(p.root, "node_modules"), { recursive: true });
    await writeFile(path.join(p.root, "node_modules", "x.js"), "1");
    for (const target of [
      "../outside.js",
      "a/../../x.js",
      "/etc/passwd",
      "C:/x.js",
      "a\\b.js",
      ".git/config",
      "node_modules/x.js",
      ".asaa/x.js",
      "missing.js",
      "dir",
      "",
    ]) {
      const response = await p.agent.post(p.jobs, { task: "node-script", target });
      expect(response.status, target).toBe(400);
    }
    expect((await p.agent.post(p.jobs, { task: "node-script" })).status).toBe(400);
    expect((await p.agent.post(p.jobs, { task: "rm -rf /" })).status).toBe(400);
    expect((await p.agent.post(p.jobs, { task: "node-script", target: "ok.js", extra: 1 })).status).toBe(202);
    expect(await h.ctx.prisma.executionJob.count()).toBe(1);

    try {
      await symlink(path.join(base, "outside.js"), path.join(p.root, "link.js"));
    } catch {
      return; // Symlink creation needs privileges on some Windows setups.
    }
    expect((await p.agent.post(p.jobs, { task: "node-script", target: "link.js" })).status).toBe(422);
  });

  it("fails a job whose project contains a symbolic link instead of copying it", async () => {
    const p = await project({ "ok.js": "console.log(1)" });
    try {
      await symlink(path.join(base, "outside.txt"), path.join(p.root, "link.txt"));
    } catch {
      return;
    }
    const submitted = await p.agent.post(p.jobs, { task: "node-script", target: "ok.js" });
    const job = await waitFor(p.agent, `${p.jobs}/${submitted.body.job.id}`, final);
    expect(job.status).toBe("FAILED");
    expect(job.reason).toMatch(/symbolic link/);
  });

  it("refuses jobs on archived projects", async () => {
    const p = await project({ "ok.js": "1" });
    expect((await p.agent.post(`/api/projects/${p.projectId}/archive`)).status).toBe(200);
    expect((await p.agent.post(p.jobs, { task: "node-script", target: "ok.js" })).status).toBe(409);
    expect((await p.agent.get(p.jobs)).status).toBe(200);
  });

  it("uses the container boundary when docker is usable (injected fake) and labels it", async () => {
    const fake = dockerReady((_call, child) => child.exit(0, "from container\n"));
    jobsRuntime.docker = fake.deps;
    const p = await project({ "hello.js": "console.log(1+1)" });
    const submitted = await p.agent.post(p.jobs, { task: "node-script", target: "hello.js" });
    expect(submitted.body.job.isolation).toBe("container");
    expect(submitted.body.job.isolationDescription).toMatch(/Container isolation/);
    const job = await waitFor(p.agent, `${p.jobs}/${submitted.body.job.id}`, final);
    expect(job.status).toBe("SUCCEEDED");
    expect((await p.agent.get(`${p.jobs}/${job.id}/logs`)).body.logs.stdout).toContain("from container");
    const run = fake.calls.find((c) => c.args[0] === "run")!;
    expect(run.args).toEqual(expect.arrayContaining(["--network", "none", "--read-only", "--cap-drop", "ALL"]));
    expect(run.args.slice(-2)).toEqual(["node", "hello.js"]);
    expect(run.args).toContain(`asaa-job-${job.id}`);
    expect((await listLeftoverRunDirs()).filter((dir) => !baselineDirs.has(dir))).toEqual([]);
  });

  it("falls back to a labelled process job when docker is absent", async () => {
    const p = await project({ "hello.js": "console.log(1+1)" });
    const submitted = await p.agent.post(p.jobs, { task: "node-script", target: "hello.js" });
    expect(submitted.body.job.isolation).toBe("process");
    await waitFor(p.agent, `${p.jobs}/${submitted.body.job.id}`, final);
  });
});

// ---- optional live container run -------------------------------------------------------------------------------

const live = (await probeDocker(IMAGE)).usable;
describe("live docker container", () => {
  it.skipIf(!live)("runs a script inside a real container", async () => {
    const { runInContainer: run } = await import("../src/modules/execution/container.js");
    const result = await run({
      jobId: `live-${Date.now()}`,
      image: IMAGE,
      nodeArgs: ["main.js"],
      files: { "main.js": Buffer.from("console.log(1+1)") },
      limits: { timeoutMs: 30_000, maxOutputBytes: 10_000, maxMemoryMb: 256, maxFiles: 100, maxDiskBytes: 1_000_000 },
    });
    expect(result.status).toBe("SUCCEEDED");
    expect(result.stdout).toContain("2");
  });
});
