import type { Prisma } from "@prisma/client";
import type { Request } from "express";
import type { AppContext } from "../../context.js";
import { redact } from "../../lib/logger.js";

export interface AuditEntry {
  action: string;
  outcome: "SUCCESS" | "FAILURE" | "DENIED";
  targetType?: string;
  targetId?: string;
  metadata?: Record<string, unknown>;
}

/**
 * Append an audit event (US-I02). Sensitive keys are redacted before storage.
 * Audit failures are logged but never leak details to the client.
 */
export async function audit(ctx: AppContext, req: Request | null, entry: AuditEntry): Promise<void> {
  try {
    await ctx.prisma.auditEvent.create({
      data: {
        actorType: req?.owner ? (req.owner.role === "OWNER" ? "OWNER" : "MEMBER") : req ? "ANONYMOUS" : "SYSTEM",
        actorId: req?.owner?.id ?? null,
        action: entry.action,
        outcome: entry.outcome,
        targetType: entry.targetType ?? null,
        targetId: entry.targetId ?? null,
        requestId: req?.requestId ?? null,
        metadata: redact(entry.metadata ?? {}) as Prisma.InputJsonValue,
      },
    });
    ctx.events?.onAudit(entry, req);
  } catch (error) {
    ctx.logger.error("audit write failed", {
      action: entry.action,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
