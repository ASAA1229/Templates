import { createHash } from "node:crypto";
import {
  CONNECTOR_CONTRACT_VERSION,
  type ArtifactRef,
  type BuildConnector,
  type BuildRequest,
  type BuildState,
  type ConnectorHealth,
  type CredentialProvider,
  type RegistryConnector,
} from "./connectors.js";

/**
 * HTTP adapters for Jenkins and Nexus Repository 3, written against their documented REST APIs and tested
 * locally against protocol-faithful fake servers. They have NOT been run against a real Jenkins or Nexus:
 * that needs an authorized endpoint and credentials (see docs/OPERATIONS.md).
 */
export interface HttpConnectorOptions {
  baseUrl: string;
  /** Name of the credential (resolved at call time): "user:token" for Jenkins, "user:password" or a bearer token for Nexus. */
  credentialRef: string;
  credentials: CredentialProvider;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

const SAFE_SEGMENT = /^[A-Za-z0-9._@+-][A-Za-z0-9._@+ -]*$/;

function segments(path: string, label: string): string[] {
  const parts = path.split("/");
  if (
    path.startsWith("/") ||
    parts.some((part) => !part || part === "." || part === ".." || !SAFE_SEGMENT.test(part))
  ) {
    throw new Error(`Invalid ${label}.`);
  }
  return parts.map(encodeURIComponent);
}

abstract class HttpBase {
  protected readonly base: string;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;
  constructor(protected readonly options: HttpConnectorOptions) {
    const url = new URL(options.baseUrl);
    if (url.protocol !== "https:" && url.hostname !== "localhost" && url.hostname !== "127.0.0.1") {
      throw new Error("Connectors must use https (plain http is only allowed for localhost).");
    }
    if (url.username || url.password) throw new Error("Do not put credentials in the connector URL.");
    this.base = url.toString().replace(/\/+$/, "");
    this.timeoutMs = options.timeoutMs ?? 10_000;
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  protected authorization(): string {
    const secret = this.options.credentials.get(this.options.credentialRef);
    if (!secret) throw new Error("The connector credential is not configured.");
    return secret.includes(":") ? `Basic ${Buffer.from(secret).toString("base64")}` : `Bearer ${secret}`;
  }

  protected async request(path: string, init: RequestInit = {}): Promise<Response> {
    const headers = new Headers(init.headers);
    headers.set("authorization", this.authorization());
    return this.fetchImpl(`${this.base}${path}`, {
      ...init,
      headers,
      redirect: "manual",
      signal: AbortSignal.timeout(this.timeoutMs),
    });
  }

  protected async timed(run: () => Promise<Omit<ConnectorHealth, "latencyMs">>): Promise<ConnectorHealth> {
    const started = Date.now();
    try {
      return { ...(await run()), latencyMs: Date.now() - started };
    } catch (error) {
      const configuration = error instanceof Error && /credential|Invalid/.test(error.message);
      return {
        ok: false,
        status: configuration ? "misconfigured" : "down",
        latencyMs: Date.now() - started,
        detail: error instanceof Error ? error.message.slice(0, 200) : "Unreachable.",
      };
    }
  }
}

export class JenkinsConnector extends HttpBase implements BuildConnector {
  readonly kind = "BUILD" as const;
  readonly contract = CONNECTOR_CONTRACT_VERSION;
  readonly capabilities = ["trigger", "status", "cancel"] as const;

  async health(): Promise<ConnectorHealth> {
    return this.timed(async () => {
      const response = await this.request("/api/json?tree=mode");
      if (response.status === 401 || response.status === 403) return { ok: false, status: "unauthorized" };
      if (!response.ok) return { ok: false, status: "down", detail: `HTTP ${response.status}` };
      return { ok: true, status: "up", version: response.headers.get("x-jenkins") ?? undefined };
    });
  }

  /** CSRF crumb (Jenkins rejects state-changing calls without one when the issuer is enabled). */
  private async crumb(): Promise<Record<string, string>> {
    const response = await this.request("/crumbIssuer/api/json");
    if (response.status === 404) return {};
    if (!response.ok) throw new Error(`Jenkins crumb request failed (HTTP ${response.status}).`);
    const body = (await response.json()) as { crumbRequestField: string; crumb: string };
    return { [body.crumbRequestField]: body.crumb };
  }

  async trigger(request: BuildRequest): Promise<{ buildId: string }> {
    const job = segments(request.job, "job name").join("/job/");
    const parameters = request.parameters ?? {};
    const hasParameters = Object.keys(parameters).length > 0;
    const response = await this.request(`/job/${job}/${hasParameters ? "buildWithParameters" : "build"}`, {
      method: "POST",
      headers: { ...(await this.crumb()), "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(parameters).toString(),
    });
    if (response.status !== 201 && response.status !== 200)
      throw new Error(`Jenkins refused the build (HTTP ${response.status}).`);
    const location = response.headers.get("location") ?? "";
    const queued = /\/queue\/item\/(\d+)\/?$/.exec(location);
    if (!queued) throw new Error("Jenkins did not return a queue item.");
    return { buildId: `queue:${queued[1]}` };
  }

  async status(job: string, buildId: string): Promise<{ state: BuildState; url?: string }> {
    const queued = /^queue:(\d+)$/.exec(buildId);
    if (queued) {
      const response = await this.request(`/queue/item/${queued[1]}/api/json`);
      if (response.status === 404) return { state: "CANCELLED" };
      if (!response.ok) throw new Error(`Jenkins status failed (HTTP ${response.status}).`);
      const item = (await response.json()) as { cancelled?: boolean; executable?: { number: number; url: string } };
      if (item.cancelled) return { state: "CANCELLED" };
      return item.executable ? { state: "RUNNING", url: item.executable.url } : { state: "QUEUED" };
    }
    if (!/^\d+$/.test(buildId)) throw new Error("Invalid build id.");
    const path = segments(job, "job name").join("/job/");
    const response = await this.request(`/job/${path}/${buildId}/api/json?tree=building,result,url`);
    if (!response.ok) throw new Error(`Jenkins status failed (HTTP ${response.status}).`);
    const build = (await response.json()) as { building: boolean; result: string | null; url?: string };
    if (build.building) return { state: "RUNNING", url: build.url };
    const state: BuildState =
      build.result === "SUCCESS" ? "SUCCESS" : build.result === "ABORTED" ? "CANCELLED" : "FAILED";
    return { state, url: build.url };
  }

  async cancel(job: string, buildId: string): Promise<void> {
    const queued = /^queue:(\d+)$/.exec(buildId);
    const headers = await this.crumb();
    const response = queued
      ? await this.request(`/queue/cancelItem?id=${queued[1]}`, { method: "POST", headers })
      : await this.request(
          `/job/${segments(job, "job name").join("/job/")}/${/^\d+$/.test(buildId) ? buildId : "0"}/stop`,
          {
            method: "POST",
            headers,
          },
        );
    if (!response.ok && response.status !== 302) throw new Error(`Jenkins cancel failed (HTTP ${response.status}).`);
  }
}

export class NexusConnector extends HttpBase implements RegistryConnector {
  readonly kind = "ARTIFACT_REGISTRY" as const;
  readonly contract = CONNECTOR_CONTRACT_VERSION;
  readonly capabilities = ["publish", "fetch", "list"] as const;

  async health(): Promise<ConnectorHealth> {
    return this.timed(async () => {
      const response = await this.request("/service/rest/v1/status");
      if (response.status === 401 || response.status === 403) return { ok: false, status: "unauthorized" };
      if (!response.ok) return { ok: false, status: "down", detail: `HTTP ${response.status}` };
      return { ok: true, status: "up", version: response.headers.get("server") ?? undefined };
    });
  }

  private url(ref: ArtifactRef): string {
    return `/repository/${segments(ref.repository, "repository").join("/")}/${segments(ref.path, "artifact path").join("/")}`;
  }

  async publish(ref: ArtifactRef, content: Buffer, sha256: string): Promise<{ url: string; sha256: string }> {
    const actual = createHash("sha256").update(content).digest("hex");
    if (actual !== sha256) throw new Error("The artifact checksum does not match its content.");
    const path = this.url(ref);
    // Published artifacts are immutable: refuse to overwrite different content.
    const existing = await this.request(path);
    if (existing.ok) {
      const current = createHash("sha256")
        .update(Buffer.from(await existing.arrayBuffer()))
        .digest("hex");
      if (current !== sha256) throw new Error("An artifact with different content already exists at this path.");
      return { url: `${this.base}${path}`, sha256 };
    }
    const response = await this.request(path, {
      method: "PUT",
      body: new Uint8Array(content),
      headers: { "content-type": "application/octet-stream" },
    });
    if (!response.ok) throw new Error(`Nexus refused the upload (HTTP ${response.status}).`);
    const verified = await this.fetch(ref);
    if (verified.sha256 !== sha256) throw new Error("Read-after-write verification failed: stored content differs.");
    return { url: `${this.base}${path}`, sha256 };
  }

  async fetch(ref: ArtifactRef): Promise<{ content: Buffer; sha256: string }> {
    const response = await this.request(this.url(ref));
    if (response.status === 404) throw new Error("Artifact not found.");
    if (!response.ok) throw new Error(`Nexus download failed (HTTP ${response.status}).`);
    const content = Buffer.from(await response.arrayBuffer());
    return { content, sha256: createHash("sha256").update(content).digest("hex") };
  }

  async list(repository: string, prefix = ""): Promise<string[]> {
    const names: string[] = [];
    let token: string | undefined;
    for (let page = 0; page < 20; page++) {
      const query = new URLSearchParams({ repository });
      if (token) query.set("continuationToken", token);
      const response = await this.request(`/service/rest/v1/assets?${query.toString()}`);
      if (!response.ok) throw new Error(`Nexus listing failed (HTTP ${response.status}).`);
      const body = (await response.json()) as { items: { path: string }[]; continuationToken: string | null };
      names.push(...body.items.map((item) => item.path).filter((name) => name.startsWith(prefix)));
      if (!body.continuationToken) break;
      token = body.continuationToken;
    }
    return names.sort();
  }
}
