import { createHash } from "node:crypto";
import {
  CONNECTOR_CONTRACT_VERSION,
  type ArtifactRef,
  type BuildConnector,
  type BuildRequest,
  type BuildState,
  type ConnectorHealth,
  type RegistryConnector,
} from "./connectors.js";

/** Deterministic in-memory connectors for tests and local demos (no network, no credentials). */
export class MockBuildConnector implements BuildConnector {
  readonly kind = "BUILD" as const;
  contract: number = CONNECTOR_CONTRACT_VERSION;
  capabilities: BuildConnector["capabilities"] = ["trigger", "status", "cancel"];
  failNext = false;
  private seq = 0;
  private readonly builds = new Map<string, { job: string; polls: number; state: BuildState; willFail: boolean }>();

  async health(): Promise<ConnectorHealth> {
    return { ok: true, status: "up", latencyMs: 1, version: "mock-1" };
  }
  async trigger(request: BuildRequest) {
    const buildId = String(++this.seq);
    this.builds.set(buildId, { job: request.job, polls: 0, state: "QUEUED", willFail: this.failNext });
    this.failNext = false;
    return { buildId };
  }
  async status(job: string, buildId: string) {
    const build = this.builds.get(buildId);
    if (!build || build.job !== job) throw new Error("Unknown build.");
    if (build.state === "QUEUED" || build.state === "RUNNING") {
      build.polls += 1;
      build.state = build.polls < 2 ? "RUNNING" : build.willFail ? "FAILED" : "SUCCESS";
    }
    return { state: build.state };
  }
  async cancel(job: string, buildId: string) {
    const build = this.builds.get(buildId);
    if (!build || build.job !== job) throw new Error("Unknown build.");
    if (build.state === "SUCCESS" || build.state === "FAILED") throw new Error("The build already finished.");
    build.state = "CANCELLED";
  }
}

export class MockRegistryConnector implements RegistryConnector {
  readonly kind = "ARTIFACT_REGISTRY" as const;
  contract: number = CONNECTOR_CONTRACT_VERSION;
  capabilities: RegistryConnector["capabilities"] = ["publish", "fetch", "list"];
  readonly store = new Map<string, Buffer>();

  async health(): Promise<ConnectorHealth> {
    return { ok: true, status: "up", latencyMs: 1, version: "mock-1" };
  }
  private key(ref: ArtifactRef) {
    return `${ref.repository}/${ref.path}`;
  }
  async publish(ref: ArtifactRef, content: Buffer, sha256: string) {
    if (createHash("sha256").update(content).digest("hex") !== sha256) throw new Error("Checksum mismatch.");
    const existing = this.store.get(this.key(ref));
    if (existing && !existing.equals(content)) throw new Error("Artifacts are immutable once published.");
    this.store.set(this.key(ref), Buffer.from(content));
    return { url: `mock://${this.key(ref)}`, sha256 };
  }
  async fetch(ref: ArtifactRef) {
    const content = this.store.get(this.key(ref));
    if (!content) throw new Error("Artifact not found.");
    return { content, sha256: createHash("sha256").update(content).digest("hex") };
  }
  async list(repository: string, prefix = "") {
    return [...this.store.keys()]
      .filter((key) => key.startsWith(`${repository}/${prefix}`))
      .map((key) => key.slice(repository.length + 1))
      .sort();
  }
}
