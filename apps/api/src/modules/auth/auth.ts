import { changePasswordSchema, loginSchema, type OwnerView, type SessionView } from "@asaa/contracts";
import type { CookieOptions, NextFunction, Request, Response } from "express";
import { Router } from "express";
import type { AppContext } from "../../context.js";
import { AppError, unauthenticated, validationFailed } from "../../lib/errors.js";
import { hashPassword, needsRehash, timingDummyHash, verifyPassword } from "../../lib/password.js";
import { hashToken, newSessionToken } from "../../lib/tokens.js";
import { RateLimiter } from "../../middleware/security.js";
import { audit } from "../audit/audit.service.js";
import { authorize } from "./policy.js";

export const SESSION_COOKIE = "asaa_session";
const INVALID_LOGIN = "Invalid email or password.";

function cookieOptions(ctx: AppContext): CookieOptions {
  return {
    httpOnly: true,
    sameSite: "strict",
    secure: ctx.config.COOKIE_SECURE,
    path: "/",
  };
}

const ownerView = (owner: { id: string; email: string; displayName: string }): OwnerView => ({
  id: owner.id,
  email: owner.email,
  displayName: owner.displayName,
});

/**
 * Resolve the session cookie (US-A02). Sessions have an absolute expiry and an
 * idle timeout; revoked/expired sessions are rejected and the cookie cleared.
 */
export function authenticate(ctx: AppContext) {
  return async (req: Request, res: Response, next: NextFunction) => {
    const token = req.cookies?.[SESSION_COOKIE] as string | undefined;
    if (!token || token.length > 100) return next();
    try {
      const session = await ctx.prisma.session.findUnique({
        where: { tokenHash: hashToken(token) },
        include: { owner: true },
      });
      const now = ctx.now();
      const idleLimit = ctx.config.SESSION_IDLE_MINUTES * 60_000;
      if (
        !session ||
        session.revokedAt ||
        session.expiresAt <= now ||
        now.getTime() - session.lastSeenAt.getTime() > idleLimit ||
        session.createdAt < session.owner.passwordChangedAt
      ) {
        res.clearCookie(SESSION_COOKIE, cookieOptions(ctx));
        return next();
      }
      req.owner = { ...ownerView(session.owner), role: "OWNER" };
      req.sessionId = session.id;
      // Throttle last-seen writes to once a minute.
      if (now.getTime() - session.lastSeenAt.getTime() > 60_000) {
        await ctx.prisma.session.update({ where: { id: session.id }, data: { lastSeenAt: now } });
      }
      next();
    } catch (error) {
      next(error);
    }
  };
}

export function requireOwner() {
  return (req: Request, _res: Response, next: NextFunction) => (req.owner ? next() : next(unauthenticated()));
}

export function authRouter(ctx: AppContext): Router {
  const router = Router();
  // Per client address and per submitted email, so neither can be brute-forced.
  const ipLimiter = new RateLimiter(20, 15 * 60_000, () => ctx.now().getTime());
  const emailLimiter = new RateLimiter(8, 15 * 60_000, () => ctx.now().getTime());

  router.post("/login", async (req, res, next) => {
    try {
      const parsed = loginSchema.safeParse(req.body);
      const email = parsed.success ? parsed.data.email : "";
      const retryAfter = Math.max(ipLimiter.consume(req.ip ?? "unknown"), email ? emailLimiter.consume(email) : 0);
      if (retryAfter > 0) {
        await audit(ctx, req, { action: "auth.login", outcome: "DENIED", metadata: { reason: "rate_limited" } });
        res.setHeader("retry-after", String(retryAfter));
        throw new AppError(429, "RATE_LIMITED", "Too many sign-in attempts. Try again later.");
      }
      if (!parsed.success) throw validationFailed({ _: INVALID_LOGIN }, INVALID_LOGIN);

      const owner = await ctx.prisma.owner.findUnique({ where: { email } });
      // Always run one scrypt verification so response time does not reveal whether the account exists.
      const valid = await verifyPassword(parsed.data.password, owner?.passwordHash ?? (await timingDummyHash()));
      if (!owner || !valid) {
        await audit(ctx, req, { action: "auth.login", outcome: "FAILURE", metadata: { reason: "invalid_credentials" } });
        throw new AppError(401, "UNAUTHENTICATED", INVALID_LOGIN);
      }
      if (needsRehash(owner.passwordHash)) {
        await ctx.prisma.owner.update({
          where: { id: owner.id },
          data: { passwordHash: await hashPassword(parsed.data.password) },
        });
      }
      // Only the single owner can succeed, so a success clears both counters.
      emailLimiter.reset(email);
      ipLimiter.reset(req.ip ?? "unknown");
      const { token, tokenHash } = newSessionToken();
      const now = ctx.now();
      const session = await ctx.prisma.session.create({
        data: {
          ownerId: owner.id,
          tokenHash,
          createdAt: now,
          lastSeenAt: now,
          expiresAt: new Date(now.getTime() + ctx.config.SESSION_ABSOLUTE_MINUTES * 60_000),
          userAgent: req.get("user-agent")?.slice(0, 200) ?? null,
        },
      });
      res.cookie(SESSION_COOKIE, token, { ...cookieOptions(ctx), expires: session.expiresAt });
      req.owner = { ...ownerView(owner), role: "OWNER" };
      await audit(ctx, req, { action: "auth.login", outcome: "SUCCESS", targetType: "session", targetId: session.id });
      res.status(200).json({ owner: ownerView(owner) });
    } catch (error) {
      next(error);
    }
  });

  router.post("/logout", async (req, res, next) => {
    try {
      if (req.sessionId) {
        await ctx.prisma.session.update({ where: { id: req.sessionId }, data: { revokedAt: ctx.now() } });
        await audit(ctx, req, { action: "auth.logout", outcome: "SUCCESS", targetType: "session", targetId: req.sessionId });
      }
      res.clearCookie(SESSION_COOKIE, cookieOptions(ctx));
      res.status(204).end();
    } catch (error) {
      next(error);
    }
  });

  router.get("/session", requireOwner(), (req, res) => {
    res.json({ owner: { id: req.owner!.id, email: req.owner!.email, displayName: req.owner!.displayName } });
  });

  router.get("/sessions", requireOwner(), authorize(ctx, "session:manage"), async (req, res, next) => {
    try {
      const sessions = await ctx.prisma.session.findMany({
        where: { ownerId: req.owner!.id, revokedAt: null, expiresAt: { gt: ctx.now() } },
        orderBy: { lastSeenAt: "desc" },
      });
      const view: SessionView[] = sessions.map((session) => ({
        id: session.id,
        createdAt: session.createdAt.toISOString(),
        lastSeenAt: session.lastSeenAt.toISOString(),
        expiresAt: session.expiresAt.toISOString(),
        userAgent: session.userAgent,
        current: session.id === req.sessionId,
      }));
      res.json({ sessions: view });
    } catch (error) {
      next(error);
    }
  });

  router.post("/sessions/:id/revoke", requireOwner(), authorize(ctx, "session:manage"), async (req, res, next) => {
    try {
      const id = String(req.params.id);
      const result = await ctx.prisma.session.updateMany({
        where: { id, ownerId: req.owner!.id, revokedAt: null },
        data: { revokedAt: ctx.now() },
      });
      if (result.count === 0) throw new AppError(404, "NOT_FOUND", "Session not found.");
      await audit(ctx, req, { action: "auth.session.revoke", outcome: "SUCCESS", targetType: "session", targetId: id });
      if (id === req.sessionId) res.clearCookie(SESSION_COOKIE, cookieOptions(ctx));
      res.status(204).end();
    } catch (error) {
      next(error);
    }
  });

  router.post("/sessions/revoke-others", requireOwner(), authorize(ctx, "session:manage"), async (req, res, next) => {
    try {
      const result = await ctx.prisma.session.updateMany({
        where: { ownerId: req.owner!.id, revokedAt: null, NOT: { id: req.sessionId! } },
        data: { revokedAt: ctx.now() },
      });
      await audit(ctx, req, { action: "auth.session.revoke_others", outcome: "SUCCESS", metadata: { revoked: result.count } });
      res.json({ revoked: result.count });
    } catch (error) {
      next(error);
    }
  });

  router.post("/password", requireOwner(), authorize(ctx, "session:manage"), async (req, res, next) => {
    try {
      const input = changePasswordSchema.parse(req.body);
      const owner = await ctx.prisma.owner.findUniqueOrThrow({ where: { id: req.owner!.id } });
      if (!(await verifyPassword(input.currentPassword, owner.passwordHash))) {
        await audit(ctx, req, { action: "auth.password.change", outcome: "FAILURE", metadata: { reason: "wrong_current" } });
        throw validationFailed({ currentPassword: "Current password is incorrect." });
      }
      const now = ctx.now();
      await ctx.prisma.$transaction([
        ctx.prisma.owner.update({
          where: { id: owner.id },
          data: { passwordHash: await hashPassword(input.newPassword), passwordChangedAt: now },
        }),
        // Every other session ends; the current one is re-issued below.
        ctx.prisma.session.updateMany({ where: { ownerId: owner.id, revokedAt: null }, data: { revokedAt: now } }),
      ]);
      const { token, tokenHash } = newSessionToken();
      const later = new Date(now.getTime() + 1);
      const session = await ctx.prisma.session.create({
        data: {
          ownerId: owner.id,
          tokenHash,
          createdAt: later,
          lastSeenAt: later,
          expiresAt: new Date(now.getTime() + ctx.config.SESSION_ABSOLUTE_MINUTES * 60_000),
          userAgent: req.get("user-agent")?.slice(0, 200) ?? null,
        },
      });
      res.cookie(SESSION_COOKIE, token, { ...cookieOptions(ctx), expires: session.expiresAt });
      await audit(ctx, req, { action: "auth.password.change", outcome: "SUCCESS", targetType: "owner", targetId: owner.id });
      res.status(204).end();
    } catch (error) {
      next(error);
    }
  });

  return router;
}
