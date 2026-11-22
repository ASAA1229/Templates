import { readdir } from "node:fs/promises";
import path from "node:path";
import type { OpsOverviewView } from "@asaa/contracts";
import { Router } from "express";
import type { AppContext } from "../../context.js";
import type { ConnectorHub } from "../connectors/connectors.js";
import { authorize } from "../auth/policy.js";

const DAY_MS = 24 * 60 * 60 * 1000;
const STALE_DAYS = 180;

const toRecord = <K extends string>(rows: { key: K; count: number }[]): Record<string, number> =>
  Object.fromEntries(rows.map((row) => [row.key, row.count]));

async function pendingSubmissions(ctx: AppContext): Promise<number> {
  const dir = path.join(ctx.config.TEMPLATE_LIBRARY_DIR, ".submissions");
  try {
    const entries = await readdir(dir, { withFileTypes: true });
    return entries.filter((entry) => entry.isDirectory() && !entry.name.startsWith(".tmp-")).length;
  } catch {
    return 0;
  }
}

/** Aggregated operational and asset view for management (D3.21). Read-only; contains counts and titles, no content. */
export async function opsOverview(ctx: AppContext, hub: ConnectorHub): Promise<OpsOverviewView> {
  const now = ctx.now();
  const since = new Date(now.getTime() - DAY_MS);
  const stale = new Date(now.getTime() - STALE_DAYS * DAY_MS);
  const [jobs, failedJobs, delivery, outbox, releases, generations, items, usage, pending] = await Promise.all([
    ctx.prisma.executionJob.groupBy({ by: ["status"], _count: { _all: true } }),
    ctx.prisma.executionJob.count({
      where: { status: { in: ["FAILED", "TIMED_OUT", "LIMIT_EXCEEDED"] }, finishedAt: { gte: since } },
    }),
    ctx.prisma.deliveryRequest.groupBy({ by: ["status"], _count: { _all: true } }),
    ctx.prisma.asaaEventOutbox.groupBy({ by: ["status"], _count: { _all: true } }),
    ctx.prisma.templateRelease.groupBy({ by: ["status"], _count: { _all: true } }),
    ctx.prisma.projectGeneration.groupBy({ by: ["status"], _count: { _all: true } }),
    ctx.prisma.catalogItem.findMany({
      select: {
        id: true,
        slug: true,
        title: true,
        kind: true,
        lifecycle: true,
        trustStatus: true,
        sector: true,
        updatedAt: true,
      },
      take: 5000,
    }),
    ctx.prisma.projectGeneration.groupBy({ by: ["catalogItemId"], _count: { _all: true } }),
    pendingSubmissions(ctx),
  ]);
  const count = <T extends { _count: { _all: number } }>(rows: T[], pick: (row: T) => string) =>
    toRecord(rows.map((row) => ({ key: pick(row), count: row._count._all })));
  const jobsByStatus = count(jobs, (row) => row.status);
  const deliveryByStatus = count(delivery, (row) => row.status);
  const outboxByStatus = count(outbox, (row) => row.status);
  const used = new Map(usage.filter((row) => row.catalogItemId).map((row) => [row.catalogItemId!, row._count._all]));

  const tally = (pick: (item: (typeof items)[number]) => string) => {
    const result: Record<string, number> = {};
    for (const item of items) result[pick(item)] = (result[pick(item)] ?? 0) + 1;
    return result;
  };
  const attention: OpsOverviewView["assets"]["attention"] = [];
  for (const item of items) {
    const reasons: string[] = [];
    if (item.trustStatus !== "TRUSTED" && item.lifecycle !== "RETIRED")
      reasons.push(`Not trusted (${item.trustStatus})`);
    if (item.lifecycle === "DEPRECATED" && (used.get(item.id) ?? 0) > 0) {
      reasons.push(`Deprecated but used by ${used.get(item.id)} generated project(s)`);
    }
    if (item.lifecycle === "ACTIVE" && item.updatedAt < stale) reasons.push(`Not reviewed in ${STALE_DAYS} days`);
    if (reasons.length) attention.push({ id: item.id, slug: item.slug, title: item.title, reason: reasons.join("; ") });
  }

  const connectors: OpsOverviewView["integrations"]["connectors"] = [];
  for (const id of hub.info.keys()) {
    const health = await hub.manager.health(id, "ops-overview").catch(() => null);
    connectors.push({ id, ok: Boolean(health?.ok), status: health?.status ?? "down" });
  }

  return {
    generatedAt: now.toISOString(),
    jobs: { byStatus: jobsByStatus, failedLast24h: failedJobs, runningNow: jobsByStatus.RUNNING ?? 0 },
    delivery: { pending: deliveryByStatus.REQUESTED ?? 0, byStatus: deliveryByStatus },
    events: { pending: outboxByStatus.PENDING ?? 0, failed: outboxByStatus.DEAD ?? 0 },
    templates: { releasesByStatus: count(releases, (row) => row.status), pendingSubmissions: pending },
    generations: { byStatus: count(generations, (row) => row.status) },
    integrations: {
      jarvisEnabled: ctx.config.JARVIS_FEATURES_ENABLED,
      aiEnabled: ctx.config.AI_ENABLED,
      connectors,
    },
    assets: {
      total: items.length,
      byKind: tally((item) => item.kind),
      byLifecycle: tally((item) => item.lifecycle),
      byTrust: tally((item) => item.trustStatus),
      bySector: tally((item) => item.sector ?? "unassigned"),
      unsectored: items.filter((item) => !item.sector).length,
      attention: attention.slice(0, 25),
    },
  };
}

export function opsRouter(ctx: AppContext, hub: ConnectorHub): Router {
  const router = Router();
  router.get("/overview", authorize(ctx, "ops:read"), async (_req, res, next) => {
    try {
      res.json({ overview: await opsOverview(ctx, hub) });
    } catch (error) {
      next(error);
    }
  });
  return router;
}
