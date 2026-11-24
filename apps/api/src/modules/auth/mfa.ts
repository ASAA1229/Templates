import type { Response, Router } from "express";
import { z } from "zod";
import type { AppContext } from "../../context.js";
import { AppError, notFound } from "../../lib/errors.js";
import { verifyPassword } from "../../lib/password.js";
import {
  decryptSecret,
  encryptSecret,
  encryptionKey,
  generateRecoveryCodes,
  generateSecret,
  hashRecoveryCode,
  otpauthUri,
  verifyTotp,
} from "../../lib/totp.js";
import { audit } from "../audit/audit.service.js";
import { authorize } from "./policy.js";
import { enforceReauthLimit, requireOwner } from "./auth.js";

/**
 * TOTP multi-factor authentication (US-A04). Secrets are encrypted at rest (AES-256-GCM) with
 * MFA_ENCRYPTION_KEY; recovery codes are stored only as hashes and are single use; accepted TOTP steps
 * cannot be replayed. Administrators can reset another account's MFA (the owner for privileged accounts).
 */
const ISSUER = "ASAA Templates";

export function mfaKey(ctx: AppContext): Buffer | null {
  return ctx.config.MFA_ENCRYPTION_KEY ? encryptionKey(ctx.config.MFA_ENCRYPTION_KEY) : null;
}

interface MfaOwner {
  id: string;
  mfaSecretEnc: string | null;
  mfaEnabledAt: Date | null;
  mfaLastStep: number | null;
}

/**
 * Check a TOTP code or a recovery code for an account with MFA enabled. TOTP steps are claimed atomically
 * (a conditional update), and recovery codes are removed atomically, so neither can be used twice.
 */
export async function verifySecondFactor(ctx: AppContext, owner: MfaOwner, code: string | undefined): Promise<boolean> {
  const key = mfaKey(ctx);
  if (!code || !key || !owner.mfaSecretEnc) return false;
  const trimmed = code.trim();
  if (/^\d{6}$/.test(trimmed)) {
    const secret = decryptSecret(owner.mfaSecretEnc, key);
    const step = verifyTotp(secret, trimmed, ctx.now().getTime(), 1, owner.mfaLastStep ?? -1);
    if (step === null) return false;
    const claimed = await ctx.prisma.$executeRaw`
      UPDATE "Owner" SET "mfaLastStep" = ${step}
      WHERE "id" = ${owner.id}::uuid AND ("mfaLastStep" IS NULL OR "mfaLastStep" < ${step})`;
    return claimed === 1;
  }
  const hash = hashRecoveryCode(trimmed);
  const removed = await ctx.prisma.$executeRaw`
    UPDATE "Owner" SET "mfaRecoveryHashes" = array_remove("mfaRecoveryHashes", ${hash})
    WHERE "id" = ${owner.id}::uuid AND ${hash} = ANY("mfaRecoveryHashes")`;
  return removed === 1;
}

export function registerMfaRoutes(router: Router, ctx: AppContext) {
  const self = [requireOwner(), authorize(ctx, "session:self-manage")] as const;

  const requireKey = () => {
    const key = mfaKey(ctx);
    if (!key) throw new AppError(503, "UNAVAILABLE", "Multi-factor authentication is not configured on this server.");
    return key;
  };

  async function confirmPassword(ownerId: string, password: string, res: Response) {
    await enforceReauthLimit(ctx, res, ownerId);
    const owner = await ctx.prisma.owner.findUniqueOrThrow({ where: { id: ownerId } });
    if (!(await verifyPassword(password, owner.passwordHash))) {
      throw new AppError(400, "VALIDATION_FAILED", "Current password is incorrect.", {
        password: "Current password is incorrect.",
      });
    }
    return owner;
  }

  router.get("/mfa", ...self, async (req, res, next) => {
    try {
      const owner = await ctx.prisma.owner.findUniqueOrThrow({ where: { id: req.owner!.id } });
      res.json({
        mfa: {
          available: mfaKey(ctx) !== null,
          enabled: owner.mfaEnabledAt !== null,
          pendingEnrollment: owner.mfaEnabledAt === null && owner.mfaSecretEnc !== null,
          recoveryCodesRemaining: owner.mfaRecoveryHashes.length,
          requiredForPrivileged: ctx.config.REQUIRE_MFA_PRIVILEGED,
        },
      });
    } catch (error) {
      next(error);
    }
  });

  router.post("/mfa/enroll", ...self, async (req, res, next) => {
    try {
      const key = requireKey();
      const { password } = z.object({ password: z.string().min(1).max(200) }).parse(req.body);
      const owner = await confirmPassword(req.owner!.id, password, res);
      if (owner.mfaEnabledAt) throw new AppError(409, "CONFLICT", "Multi-factor authentication is already enabled.");
      const secret = generateSecret();
      await ctx.prisma.owner.update({
        where: { id: owner.id },
        data: {
          mfaSecretEnc: encryptSecret(secret, key),
          mfaEnabledAt: null,
          mfaRecoveryHashes: [],
          mfaLastStep: null,
        },
      });
      await audit(ctx, req, { action: "auth.mfa.enroll", outcome: "SUCCESS", targetType: "owner", targetId: owner.id });
      res.json({ secret, otpauthUri: otpauthUri(ISSUER, owner.email, secret) });
    } catch (error) {
      next(error);
    }
  });

  router.post("/mfa/activate", ...self, async (req, res, next) => {
    try {
      const key = requireKey();
      const { code } = z
        .object({
          code: z
            .string()
            .trim()
            .regex(/^\d{6}$/, "Enter the 6-digit code."),
        })
        .parse(req.body);
      const owner = await ctx.prisma.owner.findUniqueOrThrow({ where: { id: req.owner!.id } });
      if (owner.mfaEnabledAt || !owner.mfaSecretEnc) throw new AppError(409, "CONFLICT", "Start enrollment first.");
      const step = verifyTotp(decryptSecret(owner.mfaSecretEnc, key), code, ctx.now().getTime());
      if (step === null) {
        await audit(ctx, req, {
          action: "auth.mfa.activate",
          outcome: "FAILURE",
          targetType: "owner",
          targetId: owner.id,
        });
        throw new AppError(400, "VALIDATION_FAILED", "That code is not valid. Check the time on your device.", {
          code: "That code is not valid.",
        });
      }
      const recoveryCodes = generateRecoveryCodes();
      await ctx.prisma.owner.update({
        where: { id: owner.id },
        data: {
          mfaEnabledAt: ctx.now(),
          mfaLastStep: step,
          mfaRecoveryHashes: recoveryCodes.map(hashRecoveryCode),
        },
      });
      await audit(ctx, req, {
        action: "auth.mfa.activate",
        outcome: "SUCCESS",
        targetType: "owner",
        targetId: owner.id,
      });
      // Shown exactly once; only hashes are stored.
      res.json({ recoveryCodes });
    } catch (error) {
      next(error);
    }
  });

  router.post("/mfa/disable", ...self, async (req, res, next) => {
    try {
      const input = z
        .object({ password: z.string().min(1).max(200), code: z.string().trim().min(6).max(32) })
        .parse(req.body);
      const owner = await confirmPassword(req.owner!.id, input.password, res);
      if (!owner.mfaEnabledAt) throw new AppError(409, "CONFLICT", "Multi-factor authentication is not enabled.");
      if (!(await verifySecondFactor(ctx, owner, input.code))) {
        await audit(ctx, req, {
          action: "auth.mfa.disable",
          outcome: "FAILURE",
          targetType: "owner",
          targetId: owner.id,
        });
        throw new AppError(400, "VALIDATION_FAILED", "That code is not valid.", { code: "That code is not valid." });
      }
      await ctx.prisma.owner.update({
        where: { id: owner.id },
        data: { mfaSecretEnc: null, mfaEnabledAt: null, mfaRecoveryHashes: [], mfaLastStep: null },
      });
      await audit(ctx, req, {
        action: "auth.mfa.disable",
        outcome: "SUCCESS",
        targetType: "owner",
        targetId: owner.id,
      });
      res.status(204).end();
    } catch (error) {
      next(error);
    }
  });

  /** Administrative reset for a locked-out member. The owner resets privileged accounts; sessions end. */
  router.post("/members/:id/mfa-reset", requireOwner(), authorize(ctx, "identity:manage"), async (req, res, next) => {
    try {
      const id = String(req.params.id);
      if (!/^[0-9a-f-]{36}$/i.test(id)) throw notFound("Member");
      const target = await ctx.prisma.owner.findUnique({ where: { id } });
      if (!target) throw notFound("Member");
      if ((target.role === "OWNER" || target.role === "ADMIN") && req.owner!.role !== "OWNER") {
        throw new AppError(
          403,
          "FORBIDDEN",
          "Only the owner can reset multi-factor authentication for privileged accounts.",
        );
      }
      const now = ctx.now();
      await ctx.prisma.$transaction([
        ctx.prisma.owner.update({
          where: { id },
          data: { mfaSecretEnc: null, mfaEnabledAt: null, mfaRecoveryHashes: [], mfaLastStep: null },
        }),
        ctx.prisma.session.updateMany({ where: { ownerId: id, revokedAt: null }, data: { revokedAt: now } }),
      ]);
      await audit(ctx, req, { action: "auth.mfa.reset", outcome: "SUCCESS", targetType: "owner", targetId: id });
      res.status(204).end();
    } catch (error) {
      next(error);
    }
  });
}
