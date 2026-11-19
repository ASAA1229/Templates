import { AppError } from "../lib/errors.js";

/**
 * Provider-independent connector contracts and a guarded manager (RG-12). Concrete adapters (Jenkins and
 * Nexus over HTTP, plus in-memory mocks) implement these interfaces. The manager enforces, for every call:
 * contract/capability compatibility, scoped targets, revocation, explicit approval for consequential
 * actions, a timeout, secret redaction and an audit record. Credentials are resolved at call time through a
 * CredentialProvider and are never stored, logged or returned.
 */
export const CONNECTOR_CONTRACT_VERSION = 1;

export type ConnectorKind = "BUILD" | "ARTIFACT_REGISTRY";
export type BuildCapability = "trigger" | "status" | "cancel";
export type RegistryCapability = "publish" | "fetch" | "list";

export interface ConnectorHealth {
  ok: boolean;
  status: "up" | "down" | "unauthorized" | "misconfigured";
  latencyMs: number;
  version?: string;
  detail?: string;
}

export interface BuildRequest {
  job: string;
  parameters?: Record<string, string>;
}
export type BuildState = "QUEUED" | "RUNNING" | "SUCCESS" | "FAILED" | "CANCELLED";
export interface BuildConnector {
  kind: "BUILD";
  contract: number;
  capabilities: readonly BuildCapability[];
  health(): Promise<ConnectorHealth>;
  trigger(request: BuildRequest): Promise<{ buildId: string }>;
  status(job: string, buildId: string): Promise<{ state: BuildState; url?: string }>;
  cancel(job: string, buildId: string): Promise<void>;
}

export interface ArtifactRef {
  repository: string;
  path: string;
}
export interface RegistryConnector {
  kind: "ARTIFACT_REGISTRY";
  contract: number;
  capabilities: readonly RegistryCapability[];
  health(): Promise<ConnectorHealth>;
  publish(ref: ArtifactRef, content: Buffer, sha256: string): Promise<{ url: string; sha256: string }>;
  fetch(ref: ArtifactRef): Promise<{ content: Buffer; sha256: string }>;
  list(repository: string, prefix?: string): Promise<string[]>;
}

export type Connector = BuildConnector | RegistryConnector;

export interface CredentialProvider {
  /** Secret for a credential reference, or undefined when not configured. Never log the result. */
  get(reference: string): string | undefined;
}

/** Reads credentials from environment variables named by the reference (e.g. "JENKINS_TOKEN"). */
export class EnvCredentialProvider implements CredentialProvider {
  constructor(private readonly env: NodeJS.ProcessEnv = process.env) {}
  get(reference: string): string | undefined {
    return /^[A-Z][A-Z0-9_]{2,63}$/.test(reference) ? this.env[reference] || undefined : undefined;
  }
}

export interface ConnectorScope {
  /** Allowed Jenkins jobs / build targets. */
  jobs?: string[];
  /** Allowed registry repositories. */
  repositories?: string[];
}
export interface AuditSink {
  (event: {
    connectorId: string;
    action: string;
    outcome: "SUCCESS" | "FAILURE" | "DENIED";
    actor: string;
    detail?: string;
  }): void | Promise<void>;
}

interface Registration {
  connector: Connector;
  scope: ConnectorScope;
  revoked: boolean;
  credentialRef: string | null;
}

export class ConnectorError extends AppError {
  constructor(status: number, message: string) {
    super(
      status,
      status === 403 ? "FORBIDDEN" : status === 404 ? "NOT_FOUND" : status === 409 ? "CONFLICT" : "UNAVAILABLE",
      message,
    );
  }
}

/** Remove any occurrence of known secret values (and Authorization-looking text) from a message. */
export function redact(message: string, secrets: (string | undefined)[]): string {
  let out = message.replace(/(authorization:?\s*)(basic|bearer)\s+[A-Za-z0-9+/=._-]+/gi, "$1[redacted]");
  for (const secret of secrets) {
    // Redact the whole credential and each part of "user:token" style secrets.
    for (const part of secret ? [secret, ...secret.split(":")] : []) {
      if (part.length >= 4) out = out.split(part).join("[redacted]");
    }
  }
  return out;
}

export interface CallOptions {
  actor: string;
  /** Consequential actions (build triggers, publishing, cancelling) need a named approver. */
  approvedBy?: string;
  timeoutMs?: number;
}

export class ConnectorManager {
  private readonly registry = new Map<string, Registration>();
  constructor(
    private readonly credentials: CredentialProvider,
    private readonly audit: AuditSink = () => undefined,
  ) {}

  register(id: string, connector: Connector, scope: ConnectorScope = {}, credentialRef: string | null = null) {
    if (!/^[a-z][a-z0-9-]{1,39}$/.test(id)) throw new ConnectorError(409, "Invalid connector id.");
    if (this.registry.has(id)) throw new ConnectorError(409, `Connector ${id} is already registered.`);
    this.registry.set(id, { connector, scope, revoked: false, credentialRef });
  }

  /** Immediately stop all use of a connector (credential revocation). */
  async revoke(id: string, actor: string) {
    this.get(id).revoked = true;
    await this.audit({ connectorId: id, action: "connector.revoke", outcome: "SUCCESS", actor });
  }

  private get(id: string): Registration {
    const registration = this.registry.get(id);
    if (!registration) throw new ConnectorError(404, `Connector ${id} is not registered.`);
    return registration;
  }

  describe(id: string) {
    const { connector, scope, revoked } = this.get(id);
    return {
      id,
      kind: connector.kind,
      contract: connector.contract,
      capabilities: [...connector.capabilities],
      scope,
      revoked,
    };
  }

  async health(id: string, actor: string): Promise<ConnectorHealth> {
    const registration = this.get(id);
    if (registration.revoked) return { ok: false, status: "misconfigured", latencyMs: 0, detail: "Connector revoked." };
    if (registration.credentialRef && !this.credentials.get(registration.credentialRef)) {
      return { ok: false, status: "misconfigured", latencyMs: 0, detail: "Credential is not configured." };
    }
    const result = await this.guard(id, "connector.health", actor, () => registration.connector.health(), 10_000);
    return result;
  }

  async trigger(id: string, request: BuildRequest, options: CallOptions) {
    const connector = this.require(id, "BUILD", "trigger", options, true);
    this.inScope(id, request.job, this.get(id).scope.jobs, "job", options.actor, "connector.build.trigger");
    return this.guard(
      id,
      "connector.build.trigger",
      options.actor,
      () => connector.trigger(request),
      options.timeoutMs,
    );
  }

  async status(id: string, job: string, buildId: string, options: CallOptions) {
    const connector = this.require(id, "BUILD", "status", options, false);
    this.inScope(id, job, this.get(id).scope.jobs, "job", options.actor, "connector.build.status");
    return this.guard(
      id,
      "connector.build.status",
      options.actor,
      () => connector.status(job, buildId),
      options.timeoutMs,
    );
  }

  async cancel(id: string, job: string, buildId: string, options: CallOptions) {
    const connector = this.require(id, "BUILD", "cancel", options, true);
    this.inScope(id, job, this.get(id).scope.jobs, "job", options.actor, "connector.build.cancel");
    return this.guard(
      id,
      "connector.build.cancel",
      options.actor,
      () => connector.cancel(job, buildId),
      options.timeoutMs,
    );
  }

  async publish(id: string, ref: ArtifactRef, content: Buffer, sha256: string, options: CallOptions) {
    const connector = this.require(id, "ARTIFACT_REGISTRY", "publish", options, true);
    this.inScope(
      id,
      ref.repository,
      this.get(id).scope.repositories,
      "repository",
      options.actor,
      "connector.registry.publish",
    );
    return this.guard(
      id,
      "connector.registry.publish",
      options.actor,
      () => connector.publish(ref, content, sha256),
      options.timeoutMs,
    );
  }

  async fetch(id: string, ref: ArtifactRef, options: CallOptions) {
    const connector = this.require(id, "ARTIFACT_REGISTRY", "fetch", options, false);
    this.inScope(
      id,
      ref.repository,
      this.get(id).scope.repositories,
      "repository",
      options.actor,
      "connector.registry.fetch",
    );
    return this.guard(id, "connector.registry.fetch", options.actor, () => connector.fetch(ref), options.timeoutMs);
  }

  async list(id: string, repository: string, prefix: string | undefined, options: CallOptions) {
    const connector = this.require(id, "ARTIFACT_REGISTRY", "list", options, false);
    this.inScope(
      id,
      repository,
      this.get(id).scope.repositories,
      "repository",
      options.actor,
      "connector.registry.list",
    );
    return this.guard(
      id,
      "connector.registry.list",
      options.actor,
      () => connector.list(repository, prefix),
      options.timeoutMs,
    );
  }

  // ───── guards ─────

  private require<K extends ConnectorKind>(
    id: string,
    kind: K,
    capability: string,
    options: CallOptions,
    needsApproval: boolean,
  ): K extends "BUILD" ? BuildConnector : RegistryConnector {
    const registration = this.get(id);
    const deny = (message: string, status = 403): never => {
      void this.audit({
        connectorId: id,
        action: `connector.${capability}`,
        outcome: "DENIED",
        actor: options.actor,
        detail: message,
      });
      throw new ConnectorError(status, message);
    };
    if (registration.revoked) deny("This connector has been revoked.");
    if (registration.connector.kind !== kind) deny(`Connector ${id} is not a ${kind} connector.`, 409);
    if (registration.connector.contract !== CONNECTOR_CONTRACT_VERSION) {
      deny(
        `Connector contract ${registration.connector.contract} is not supported (platform contract ${CONNECTOR_CONTRACT_VERSION}).`,
        409,
      );
    }
    if (!(registration.connector.capabilities as readonly string[]).includes(capability)) {
      deny(`Connector ${id} does not support ${capability}.`, 409);
    }
    if (registration.credentialRef && !this.credentials.get(registration.credentialRef)) {
      deny("The connector credential is not configured.", 409);
    }
    if (needsApproval && !options.approvedBy) deny("This action requires an explicit approver.");
    return registration.connector as never;
  }

  private inScope(
    id: string,
    target: string,
    allowed: string[] | undefined,
    label: string,
    actor: string,
    action: string,
  ) {
    // An empty or missing allow-list denies everything: scopes must be granted explicitly.
    if (!allowed || !allowed.includes(target)) {
      void this.audit({
        connectorId: id,
        action,
        outcome: "DENIED",
        actor,
        detail: `${label} ${target} is outside the connector scope`,
      });
      throw new ConnectorError(403, `The ${label} "${target}" is outside this connector's granted scope.`);
    }
  }

  private async guard<T>(
    id: string,
    action: string,
    actor: string,
    run: () => Promise<T>,
    timeoutMs = 15_000,
  ): Promise<T> {
    const registration = this.get(id);
    const secrets = registration.credentialRef ? [this.credentials.get(registration.credentialRef)] : [];
    let timer: NodeJS.Timeout | undefined;
    try {
      const result = await Promise.race([
        run(),
        new Promise<never>((_, reject) => {
          timer = setTimeout(
            () => reject(new ConnectorError(503, "The connector did not respond in time.")),
            timeoutMs,
          );
        }),
      ]);
      await this.audit({ connectorId: id, action, outcome: "SUCCESS", actor });
      return result;
    } catch (error) {
      const message = redact(error instanceof Error ? error.message : "Connector failure.", secrets);
      await this.audit({ connectorId: id, action, outcome: "FAILURE", actor, detail: message.slice(0, 200) });
      if (error instanceof ConnectorError) throw new ConnectorError(error.status, message);
      throw new ConnectorError(503, message.slice(0, 300));
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
}
