import { randomUUID } from "node:crypto";
import type { Prisma, PrismaClient } from "@prisma/client";
import type { Request } from "express";
import { asaaEventsEnabled, type AppConfig } from "../../config/env.js";
import type { Logger } from "../../lib/logger.js";
import type { AuditEntry } from "../audit/audit.service.js";

/**
 * ASAA ecosystem event producer (contracts/asaa-ecosystem/v1/event-envelope.schema.json).
 *
 * - Events are written to a durable Postgres outbox (AsaaEventOutbox) and delivered by a background sender.
 * - Payloads are built from explicit allow-lists: ids, outcome and the actor (SSO `sub` or null) only. Template content, file
 *   contents, paths, environment values, secrets and free-text notes never enter an envelope.
 * - Disabled unless ASAA_EVENTS_URL, ASAA_ORG_ID and credentials are configured.
 */

export type EventType =
  | "templates.generation.completed"
  | "templates.generation.failed"
  | "templates.release.submitted"
  | "templates.release.approved"
  | "templates.release.released"
  | "templates.release.deprecated"
  | "templates.job.completed"
  | "templates.job.failed"
  | "templates.security.access-denied";

export interface EventEnvelope {
  specversion: "asaa.event.v1";
  id: string;
  source: "templates";
  type: EventType;
  time: string;
  orgId: string;
  project: "TEMPLATES";
  subject?: string;
  correlationId?: string;
  severity: "info" | "warning" | "critical";
  data: Record<string, unknown>;
}

export interface EventInput {
  type: EventType;
  subject?: string;
  correlationId?: string | null;
  severity?: EventEnvelope["severity"];
  data: Record<string, unknown>;
}

const CORRELATION = /^[A-Za-z0-9._-]{8,64}$/;
const MAX_DATA_BYTES = 16 * 1024;

type Json = string | number | boolean | null;
function pick(source: Record<string, unknown> | undefined, keys: string[]): Record<string, Json> {
  const out: Record<string, Json> = {};
  for (const key of keys) {
    const value = source?.[key];
    if (typeof value === "string") out[key] = value.slice(0, 120);
    else if (typeof value === "number" && Number.isFinite(value)) out[key] = value;
    else if (typeof value === "boolean" || value === null) out[key] = value;
  }
  return out;
}

const RELEASE_ACTIONS: Record<string, EventType> = {
  "template.release.submit": "templates.release.submitted",
  "template.release.approve": "templates.release.approved",
  "template.release.release": "templates.release.released",
  "template.release.deprecate": "templates.release.deprecated",
};

/** Map an audit entry to an event, or null when the action is not part of the ecosystem contract. */
export function eventFromAudit(entry: AuditEntry, req: Request | null): EventInput | null {
  const metadata = entry.metadata;
  // The actor is the SSO subject when the session came from SSO; internal Owner ids are never emitted.
  const actor = req?.owner?.ssoSub ?? null;
  const correlationId = req?.requestId ?? null;
  if (entry.action === "generation.complete") {
    const ok = entry.outcome === "SUCCESS";
    return {
      type: ok ? "templates.generation.completed" : "templates.generation.failed",
      subject: `generation/${String(metadata?.generationId ?? entry.targetId ?? "unknown")}`.slice(0, 200),
      correlationId,
      severity: ok ? "info" : "warning",
      data: {
        outcome: ok ? "success" : "failure",
        projectId: entry.targetId ?? null,
        actor,
        ...pick(metadata, ["generationId", "mode", "templateId", "templateVersion", "attempt"]),
        ...(ok && typeof metadata?.files === "number" ? { fileCount: metadata.files } : {}),
      },
    };
  }
  const release = RELEASE_ACTIONS[entry.action];
  if (release && entry.outcome === "SUCCESS") {
    return {
      type: release,
      subject: `release/${entry.targetId ?? "unknown"}`.slice(0, 200),
      correlationId,
      data: {
        outcome: "success",
        releaseId: entry.targetId ?? null,
        actor,
        ...pick(metadata, ["templateId", "version"]),
      },
    };
  }
  if (entry.action === "job.finish") {
    const ok = entry.outcome === "SUCCESS";
    return {
      type: ok ? "templates.job.completed" : "templates.job.failed",
      subject: `job/${entry.targetId ?? "unknown"}`.slice(0, 200),
      correlationId,
      severity: ok ? "info" : "warning",
      data: {
        outcome: ok ? "success" : "failure",
        jobId: entry.targetId ?? null,
        actor,
        ...pick(metadata, ["projectId", "task", "status", "exitCode", "durationMs", "isolation"]),
      },
    };
  }
  return null;
}

export type TokenFetch = typeof fetch;

/** Keycloak client-credentials token with an in-memory cache; the secret is never logged or stored. */
export class TokenProvider {
  private cached: { value: string; expiresAt: number } | null = null;
  constructor(
    private readonly config: Pick<
      AppConfig,
      "ASAA_EVENTS_TOKEN_URL" | "ASAA_EVENTS_CLIENT_ID" | "ASAA_EVENTS_CLIENT_SECRET" | "ASAA_EVENTS_TOKEN"
    >,
    private readonly doFetch: TokenFetch,
    private readonly nowMs: () => number,
  ) {}

  private get usesClientCredentials() {
    return Boolean(this.config.ASAA_EVENTS_TOKEN_URL && this.config.ASAA_EVENTS_CLIENT_SECRET);
  }

  /** Forget the cached token (refresh-on-401). A static token cannot be refreshed. */
  invalidate() {
    this.cached = null;
  }

  canRefresh() {
    return this.usesClientCredentials;
  }

  async get(): Promise<string> {
    if (!this.usesClientCredentials) {
      if (this.config.ASAA_EVENTS_TOKEN) return this.config.ASAA_EVENTS_TOKEN;
      throw new Error("no credentials configured");
    }
    if (this.cached && this.cached.expiresAt - 30_000 > this.nowMs()) return this.cached.value;
    const response = await this.doFetch(this.config.ASAA_EVENTS_TOKEN_URL!, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
      body: new URLSearchParams({
        grant_type: "client_credentials",
        client_id: this.config.ASAA_EVENTS_CLIENT_ID,
        client_secret: this.config.ASAA_EVENTS_CLIENT_SECRET!,
      }).toString(),
      // Never follow redirects: the request body carries the client secret.
      redirect: "manual",
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) throw new TokenError(`token endpoint status ${response.status}`);
    const body = (await response.json()) as { access_token?: unknown; expires_in?: unknown };
    if (typeof body.access_token !== "string" || !body.access_token)
      throw new TokenError("token endpoint gave no token");
    const seconds = typeof body.expires_in === "number" && body.expires_in > 0 ? body.expires_in : 60;
    this.cached = { value: body.access_token, expiresAt: this.nowMs() + seconds * 1000 };
    return this.cached.value;
  }
}

export interface EventServiceOptions {
  prisma: PrismaClient;
  config: AppConfig;
  logger: Logger;
  now: () => Date;
  doFetch?: typeof fetch;
  /** Sender poll interval; the aggregate access-denied window. */
  pollMs?: number;
  denyWindowMs?: number;
  baseBackoffMs?: number;
  maxBackoffMs?: number;
  maxAttempts?: number;
  /** Wait after a credential or routing problem (auth/routing outcomes). */
  outageBackoffMs?: number;
  /** Retention: DELIVERED rows are purged after 7 days, DEAD rows after 30 days (by creation time). */
  retentionDeliveredMs?: number;
  retentionDeadMs?: number;
  /** Upper bound for PENDING rows; the oldest routine (info) events are evicted first. */
  pendingCap?: number;
  /** Minimum time between maintenance runs started by the sender timer. */
  maintenanceIntervalMs?: number;
  batchSize?: number;
}

/**
 * delivered: accepted (2xx) or already known (409).
 * retry: transient (3xx, 408, 429, 5xx, unknown 4xx); counts toward maxAttempts.
 * dead: the event itself is bad (400, 413, 422); dead-lettered at once.
 * auth: credentials rejected (401/403, token endpoint failures); an operator fixes it, so the event is kept.
 * routing: wrong URL or method (404/405/410); an operator fixes it, so the event is kept.
 * auth and routing never count toward maxAttempts, wait the long outage backoff and pause the whole batch.
 */
export type DeliveryOutcome = "delivered" | "retry" | "dead" | "auth" | "routing";

export function classifyStatus(status: number): DeliveryOutcome {
  if ((status >= 200 && status < 300) || status === 409) return "delivered";
  if (status === 401 || status === 403) return "auth";
  if (status === 404 || status === 405 || status === 410) return "routing";
  if (status === 400 || status === 413 || status === 422) return "dead";
  return "retry";
}

/** A token endpoint failure (rejected client, redirect, malformed answer); never carries the secret. */
export class TokenError extends Error {}

export class EventService {
  private readonly enabled: boolean;
  private readonly endpoint: string | null;
  private readonly tokens: TokenProvider;
  private readonly doFetch: typeof fetch;
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  private degraded = false;
  private pausedUntil = 0;
  private lastMaintenance = 0;
  private denied = { count: 0, since: 0, permissions: new Map<string, number>() };

  constructor(private readonly options: EventServiceOptions) {
    this.enabled = asaaEventsEnabled(options.config);
    this.doFetch = options.doFetch ?? fetch;
    this.tokens = new TokenProvider(options.config, this.doFetch, () => options.now().getTime());
    this.endpoint = this.enabled ? eventsEndpoint(options.config.ASAA_EVENTS_URL!) : null;
  }

  get isEnabled() {
    return this.enabled;
  }

  /** Manifest check value; synchronous and free of network calls. */
  manifestStatus(): "ok" | "degraded" | "disabled" {
    if (!this.enabled) return "disabled";
    return this.degraded ? "degraded" : "ok";
  }

  /** Write an envelope to the outbox. Never throws: events must not break the request that caused them. */
  async record(input: EventInput): Promise<string | null> {
    if (!this.enabled) return null;
    try {
      const now = this.options.now();
      const correlationId =
        input.correlationId && CORRELATION.test(input.correlationId) ? input.correlationId : undefined;
      const envelope: EventEnvelope = {
        specversion: "asaa.event.v1",
        id: randomUUID(),
        source: "templates",
        type: input.type,
        time: now.toISOString(),
        orgId: this.options.config.ASAA_ORG_ID!,
        project: "TEMPLATES",
        ...(input.subject ? { subject: input.subject } : {}),
        ...(correlationId ? { correlationId } : {}),
        severity: input.severity ?? "info",
        data: input.data,
      };
      if (Buffer.byteLength(JSON.stringify(envelope.data)) > MAX_DATA_BYTES) throw new Error("event data too large");
      await this.options.prisma.asaaEventOutbox.create({
        data: {
          id: envelope.id,
          type: envelope.type,
          envelope: envelope as unknown as Prisma.InputJsonValue,
          nextAttemptAt: now,
          createdAt: now,
        },
      });
      return envelope.id;
    } catch (error) {
      this.options.logger.error("asaa event record failed", {
        type: input.type,
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  }

  /** Called by audit(): derive and record the matching event, or count an access denial. */
  onAudit(entry: AuditEntry, req: Request | null): void {
    if (!this.enabled) return;
    if (entry.action === "authz.denied") {
      this.noteAccessDenied(typeof entry.metadata?.permission === "string" ? entry.metadata.permission : "unknown");
      return;
    }
    const input = eventFromAudit(entry, req);
    if (input) void this.record(input);
  }

  /** Access denials are aggregated (never one event per request). */
  noteAccessDenied(permission: string) {
    if (!this.enabled) return;
    if (this.denied.count === 0) this.denied.since = this.options.now().getTime();
    this.denied.count += 1;
    const key = permission.slice(0, 60);
    this.denied.permissions.set(key, (this.denied.permissions.get(key) ?? 0) + 1);
  }

  /** Emit one aggregate event when the window has elapsed (or force=true) and denials were counted. */
  async flushAccessDenied(force = false): Promise<void> {
    if (!this.enabled || this.denied.count === 0) return;
    const nowMs = this.options.now().getTime();
    const windowMs = this.options.denyWindowMs ?? 5 * 60_000;
    if (!force && nowMs - this.denied.since < windowMs) return;
    const { count, since, permissions } = this.denied;
    this.denied = { count: 0, since: 0, permissions: new Map() };
    const top = [...permissions.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10);
    await this.record({
      type: "templates.security.access-denied",
      severity: count >= 50 ? "critical" : "warning",
      data: {
        count,
        windowStart: new Date(since).toISOString(),
        windowEnd: new Date(nowMs).toISOString(),
        byPermission: Object.fromEntries(top),
      },
    });
  }

  private backoffMs(attempts: number) {
    const base = this.options.baseBackoffMs ?? 5_000;
    const max = this.options.maxBackoffMs ?? 60 * 60_000;
    return Math.min(max, base * 2 ** Math.max(0, attempts - 1));
  }

  /** Deliver due outbox rows once. Returns the number delivered. */
  async deliverDue(): Promise<number> {
    if (!this.enabled || this.running) return 0;
    if (this.options.now().getTime() < this.pausedUntil) return 0;
    this.running = true;
    let delivered = 0;
    try {
      const now = this.options.now();
      const rows = await this.options.prisma.asaaEventOutbox.findMany({
        where: { status: "PENDING", nextAttemptAt: { lte: now } },
        orderBy: { createdAt: "asc" },
        take: this.options.batchSize ?? 20,
      });
      for (const row of rows) {
        // Claim the row with a lease so a second instance does not send it at the same time.
        const claim = await this.options.prisma.asaaEventOutbox.updateMany({
          where: { id: row.id, status: "PENDING", nextAttemptAt: row.nextAttemptAt },
          data: { nextAttemptAt: new Date(now.getTime() + 60_000) },
        });
        if (claim.count !== 1) continue;
        const outcome = await this.send(row.envelope);
        const attempts = row.attempts + 1;
        if (outcome.result === "delivered") {
          delivered += 1;
          this.degraded = false;
          await this.options.prisma.asaaEventOutbox.update({
            where: { id: row.id },
            data: { status: "DELIVERED", attempts, deliveredAt: this.options.now(), lastError: null },
          });
          continue;
        }
        this.degraded = true;
        if (outcome.result === "auth" || outcome.result === "routing") {
          // An operator problem, not a bad event: keep the event, do not count the attempt, pause the batch.
          const wait = this.options.outageBackoffMs ?? 15 * 60_000;
          this.pausedUntil = this.options.now().getTime() + wait;
          await this.options.prisma.asaaEventOutbox.update({
            where: { id: row.id },
            data: { lastError: outcome.error.slice(0, 120), nextAttemptAt: new Date(this.pausedUntil) },
          });
          this.options.logger.error("asaa event delivery paused", { reason: outcome.result, detail: outcome.error });
          break;
        }
        const exhausted = attempts >= (this.options.maxAttempts ?? 12);
        const dead = outcome.result === "dead" || exhausted;
        await this.options.prisma.asaaEventOutbox.update({
          where: { id: row.id },
          data: {
            status: dead ? "DEAD" : "PENDING",
            attempts,
            lastError: outcome.error.slice(0, 120),
            nextAttemptAt: new Date(this.options.now().getTime() + this.backoffMs(attempts)),
          },
        });
        this.options.logger.warn("asaa event not delivered", {
          eventId: row.id,
          attempts,
          dead,
          reason: outcome.error,
        });
      }
    } catch (error) {
      this.degraded = true;
      this.options.logger.error("asaa event sender failed", {
        error: error instanceof Error ? error.message : String(error),
      });
    } finally {
      this.running = false;
    }
    return delivered;
  }

  /** POST one envelope. Refreshes the token once on 401 when client credentials are configured. */
  private async send(
    envelope: unknown,
  ): Promise<{ result: DeliveryOutcome; error: string } | { result: "delivered"; error: "" }> {
    const body = JSON.stringify(envelope);
    const correlation = (envelope as { correlationId?: string }).correlationId;
    const post = async () => {
      const token = await this.tokens.get();
      return this.doFetch(this.endpoint!, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${token}`,
          ...(correlation ? { "x-request-id": correlation } : {}),
        },
        body,
        // Never follow redirects: a 3xx is treated as a retryable routing problem (logged), not as a new target.
        redirect: "manual",
        signal: AbortSignal.timeout(10_000),
      });
    };
    try {
      let response = await post();
      if (response.status === 401 && this.tokens.canRefresh()) {
        this.tokens.invalidate();
        response = await post();
      }
      if (response.status >= 300 && response.status < 400) {
        this.options.logger.error("asaa event endpoint answered with a redirect; not followed", {
          status: response.status,
        });
      }
      const result = classifyStatus(response.status);
      if (result === "delivered") return { result, error: "" };
      return { result, error: `status ${response.status}` };
    } catch (error) {
      // Token endpoint failures are credential problems; network and timeout errors are transient.
      // Messages carry no secrets.
      if (error instanceof TokenError) return { result: "auth", error: error.message.slice(0, 100) };
      return { result: "retry", error: (error instanceof Error ? error.message : "network error").slice(0, 100) };
    }
  }

  /**
   * Outbox housekeeping: purge old DELIVERED/DEAD rows and keep PENDING under the cap.
   * Eviction removes the oldest routine (info) events first, then the oldest of any severity.
   */
  async maintain(): Promise<{ purged: number; evicted: number }> {
    if (!this.enabled) return { purged: 0, evicted: 0 };
    const { prisma, logger } = this.options;
    const now = this.options.now().getTime();
    this.lastMaintenance = now;
    const day = 24 * 3600_000;
    let purged = 0;
    let evicted = 0;
    try {
      const delivered = await prisma.asaaEventOutbox.deleteMany({
        where: {
          status: "DELIVERED",
          createdAt: { lt: new Date(now - (this.options.retentionDeliveredMs ?? 7 * day)) },
        },
      });
      const dead = await prisma.asaaEventOutbox.deleteMany({
        where: { status: "DEAD", createdAt: { lt: new Date(now - (this.options.retentionDeadMs ?? 30 * day)) } },
      });
      purged = delivered.count + dead.count;
      const cap = this.options.pendingCap ?? 5000;
      const pending = await prisma.asaaEventOutbox.count({ where: { status: "PENDING" } });
      let excess = pending - cap;
      if (excess > 0) {
        const routine = await prisma.asaaEventOutbox.findMany({
          where: { status: "PENDING", envelope: { path: ["severity"], equals: "info" } },
          orderBy: { createdAt: "asc" },
          take: excess,
          select: { id: true },
        });
        if (routine.length > 0) {
          evicted += (await prisma.asaaEventOutbox.deleteMany({ where: { id: { in: routine.map((r) => r.id) } } }))
            .count;
        }
        excess -= routine.length;
        if (excess > 0) {
          const rest = await prisma.asaaEventOutbox.findMany({
            where: { status: "PENDING" },
            orderBy: { createdAt: "asc" },
            take: excess,
            select: { id: true },
          });
          evicted += (await prisma.asaaEventOutbox.deleteMany({ where: { id: { in: rest.map((r) => r.id) } } })).count;
        }
        logger.warn("asaa event outbox over cap; oldest pending events evicted", { cap, evicted });
      }
    } catch (error) {
      logger.error("asaa event maintenance failed", { error: error instanceof Error ? error.message : String(error) });
    }
    return { purged, evicted };
  }

  /** Start the background sender (no-op when disabled). The timer never keeps the process alive. */
  start() {
    if (!this.enabled || this.timer) return;
    this.timer = setInterval(() => {
      void this.flushAccessDenied()
        .then(() => this.deliverDue())
        .then(async () => {
          if (this.options.now().getTime() - this.lastMaintenance >= (this.options.maintenanceIntervalMs ?? 60_000)) {
            await this.maintain();
          }
        });
    }, this.options.pollMs ?? 5_000);
    this.timer.unref();
  }

  async stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    await this.flushAccessDenied(true).catch(() => undefined);
  }
}

/** ASAA_EVENTS_URL may be the ASAA origin (the contract path is appended) or the full endpoint URL. */
export function eventsEndpoint(configured: string): string {
  const url = new URL(configured);
  if (url.pathname === "" || url.pathname === "/") url.pathname = "/api/v1/integration/events";
  return url.toString();
}

export function createEventService(options: EventServiceOptions): EventService {
  return new EventService(options);
}
