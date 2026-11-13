import { changePasswordSchema, loginSchema, passwordSchema, type OwnerView, type SessionView } from "@asaa/contracts";
import type { CookieOptions, NextFunction, Request, Response } from "express";
import { Router } from "express";
import { z } from "zod";
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

const ownerView = (owner: { id: string; email: string; displayName: string; role: OwnerView["role"] }): OwnerView => ({
  id: owner.id,
  email: owner.email,
  displayName: owner.displayName,
  role: owner.role,
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
        !session.owner.isActive ||
        session.revokedAt ||
        session.expiresAt <= now ||
        now.getTime() - session.lastSeenAt.getTime() > idleLimit ||
        session.createdAt < session.owner.passwordChangedAt
      ) {
        res.clearCookie(SESSION_COOKIE, cookieOptions(ctx));
        return next();
      }
      req.owner = ownerView(session.owner);
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

  const accessRequestIpLimiter = new RateLimiter(5, 60 * 60_000, () => ctx.now().getTime());
  const accessRequestEmailLimiter = new RateLimiter(2, 24 * 60 * 60_000, () => ctx.now().getTime());

  // Public access request: account existence and duplicate submissions are not disclosed.
  router.post("/access-requests", async (req, res, next) => {
    try {
      const input = z
        .object({
          email: z.string().trim().toLowerCase().email().max(254),
          displayName: z.string().trim().min(1).max(120),
          reason: z.string().trim().max(1000).default(""),
        })
        .parse(req.body);
      const retryAfter = Math.max(
        accessRequestIpLimiter.consume(req.ip ?? "unknown"),
        accessRequestEmailLimiter.consume(input.email),
      );
      if (retryAfter > 0) {
        res.setHeader("retry-after", String(retryAfter));
        throw new AppError(429, "RATE_LIMITED", "Too many access requests. Try again later.");
      }
      const existingAccount = await ctx.prisma.owner.findUnique({
        where: { email: input.email },
        select: { id: true },
      });
      const existingRequest = await ctx.prisma.accessRequest.findFirst({
        where: { email: input.email, status: "PENDING" },
        select: { id: true },
      });
      if (!existingAccount && !existingRequest) {
        const request = await ctx.prisma.accessRequest.create({ data: input });
        await audit(ctx, req, {
          action: "identity.access_request.submit",
          outcome: "SUCCESS",
          targetType: "access_request",
          targetId: request.id,
        });
      }
      res
        .status(202)
        .json({ message: "If the address is eligible, the request will be reviewed by an administrator." });
    } catch (error) {
      next(error);
    }
  });

  router.post("/access-requests/activate", async (req, res, next) => {
    try {
      const input = z.object({ token: z.string().min(32).max(200), password: passwordSchema }).parse(req.body);
      const tokenHash = hashToken(input.token);
      const now = ctx.now();
      const request = await ctx.prisma.accessRequest.findFirst({
        where: { tokenHash, status: "APPROVED", activatedAt: null, tokenExpiresAt: { gt: now } },
      });
      if (!request) throw new AppError(400, "VALIDATION_FAILED", "This activation link is invalid or has expired.");
      const member = await ctx.prisma.$transaction(async (tx) => {
        const claimed = await tx.accessRequest.updateMany({
          where: { id: request.id, tokenHash, status: "APPROVED", activatedAt: null, tokenExpiresAt: { gt: now } },
          data: { activatedAt: now, tokenHash: null },
        });
        if (claimed.count !== 1)
          throw new AppError(400, "VALIDATION_FAILED", "This activation link is invalid or has expired.");
        return tx.owner.create({
          data: {
            email: request.email,
            displayName: request.displayName,
            role: request.approvedRole,
            passwordHash: await hashPassword(input.password),
            passwordChangedAt: now,
            createdAt: now,
          },
          select: { id: true, email: true, displayName: true, role: true },
        });
      });
      await audit(ctx, req, {
        action: "identity.access_request.activate",
        outcome: "SUCCESS",
        targetType: "member",
        targetId: member.id,
        metadata: { role: member.role },
      });
      res.status(201).json({ member });
    } catch (error) {
      if (error && typeof error === "object" && "code" in error && error.code === "P2002") {
        next(new AppError(409, "CONFLICT", "This account has already been activated."));
        return;
      }
      next(error);
    }
  });

  router.get("/access-requests", requireOwner(), authorize(ctx, "identity:manage"), async (_req, res, next) => {
    try {
      const requests = await ctx.prisma.accessRequest.findMany({
        where: { status: "PENDING" },
        orderBy: { createdAt: "asc" },
        select: { id: true, email: true, displayName: true, reason: true, status: true, createdAt: true },
      });
      res.json({ requests: requests.map((item) => ({ ...item, createdAt: item.createdAt.toISOString() })) });
    } catch (error) {
      next(error);
    }
  });

  router.post(
    "/access-requests/:id/approve",
    requireOwner(),
    authorize(ctx, "identity:manage"),
    async (req, res, next) => {
      try {
        const input = z
          .object({ role: z.enum(["ADMIN", "DEVELOPER", "TESTER", "EMPLOYEE"]).default("EMPLOYEE") })
          .parse(req.body);
        if (req.owner!.role !== "OWNER" && input.role === "ADMIN") {
          throw new AppError(403, "FORBIDDEN", "Only the owner can approve administrator access.");
        }
        const id = String(req.params.id);
        const request = await ctx.prisma.accessRequest.findUnique({ where: { id } });
        if (!request || request.status !== "PENDING")
          throw new AppError(404, "NOT_FOUND", "Pending access request not found.");
        if (await ctx.prisma.owner.findUnique({ where: { email: request.email }, select: { id: true } })) {
          throw new AppError(409, "CONFLICT", "An account already exists for this email address.");
        }
        const { token, tokenHash } = newSessionToken();
        const now = ctx.now();
        const expiresAt = new Date(now.getTime() + 24 * 60 * 60_000);
        const changed = await ctx.prisma.accessRequest.updateMany({
          where: { id, status: "PENDING" },
          data: {
            status: "APPROVED",
            approvedRole: input.role,
            reviewerId: req.owner!.id,
            reviewedAt: now,
            tokenHash,
            tokenExpiresAt: expiresAt,
          },
        });
        if (changed.count !== 1) throw new AppError(409, "CONFLICT", "This request has already been reviewed.");
        await audit(ctx, req, {
          action: "identity.access_request.approve",
          outcome: "SUCCESS",
          targetType: "access_request",
          targetId: id,
          metadata: { role: input.role, expiresAt: expiresAt.toISOString() },
        });
        res.status(200).json({
          activationUrl: `${ctx.config.WEB_ORIGIN}/activate?token=${encodeURIComponent(token)}`,
          expiresAt: expiresAt.toISOString(),
        });
      } catch (error) {
        next(error);
      }
    },
  );

  router.post(
    "/access-requests/:id/reject",
    requireOwner(),
    authorize(ctx, "identity:manage"),
    async (req, res, next) => {
      try {
        const id = String(req.params.id);
        const changed = await ctx.prisma.accessRequest.updateMany({
          where: { id, status: "PENDING" },
          data: { status: "REJECTED", reviewerId: req.owner!.id, reviewedAt: ctx.now() },
        });
        if (changed.count !== 1) throw new AppError(404, "NOT_FOUND", "Pending access request not found.");
        await audit(ctx, req, {
          action: "identity.access_request.reject",
          outcome: "SUCCESS",
          targetType: "access_request",
          targetId: id,
        });
        res.status(204).end();
      } catch (error) {
        next(error);
      }
    },
  );

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
      if (!owner || !owner.isActive || !valid) {
        await audit(ctx, req, {
          action: "auth.login",
          outcome: "FAILURE",
          metadata: { reason: "invalid_credentials" },
        });
        throw new AppError(401, "UNAUTHENTICATED", INVALID_LOGIN);
      }
      if (needsRehash(owner.passwordHash)) {
        await ctx.prisma.owner.update({
          where: { id: owner.id },
          data: { passwordHash: await hashPassword(parsed.data.password) },
        });
      }
      // A successful account login clears both counters.
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
      req.owner = ownerView(owner);
      await audit(ctx, req, { action: "auth.login", outcome: "SUCCESS", targetType: "session", targetId: session.id });
      res.status(200).json({ owner: ownerView(owner) });
    } catch (error) {
      next(error);
    }
  });

  router.get("/members", requireOwner(), authorize(ctx, "identity:manage"), async (_req, res, next) => {
    try {
      const members = await ctx.prisma.owner.findMany({
        select: { id: true, email: true, displayName: true, role: true, isActive: true, createdAt: true },
        orderBy: [{ role: "asc" }, { displayName: "asc" }],
      });
      res.json({ members: members.map((member) => ({ ...member, createdAt: member.createdAt.toISOString() })) });
    } catch (error) {
      next(error);
    }
  });

  router.post("/members", requireOwner(), authorize(ctx, "identity:manage"), async (req, res, next) => {
    try {
      const input = z
        .object({
          email: z.string().trim().toLowerCase().email().max(254),
          displayName: z.string().trim().min(1).max(120),
          role: z.enum(["ADMIN", "DEVELOPER", "TESTER", "EMPLOYEE"]),
          password: passwordSchema,
        })
        .parse(req.body);
      if (req.owner!.role !== "OWNER" && input.role === "ADMIN") {
        throw new AppError(403, "FORBIDDEN", "Only the owner can appoint an administrator.");
      }
      const { password, ...account } = input;
      const member = await ctx.prisma.owner.create({
        data: { ...account, passwordHash: await hashPassword(password), passwordChangedAt: ctx.now() },
        select: { id: true, email: true, displayName: true, role: true, isActive: true, createdAt: true },
      });
      await audit(ctx, req, {
        action: "identity.member.create",
        outcome: "SUCCESS",
        targetType: "member",
        targetId: member.id,
        metadata: { role: member.role },
      });
      res.status(201).json({ member: { ...member, createdAt: member.createdAt.toISOString() } });
    } catch (error) {
      if (error && typeof error === "object" && "code" in error && error.code === "P2002") {
        next(new AppError(409, "CONFLICT", "An account with this email already exists."));
        return;
      }
      next(error);
    }
  });

  router.patch("/members/:id/active", requireOwner(), authorize(ctx, "identity:manage"), async (req, res, next) => {
    try {
      const input = z.object({ isActive: z.boolean() }).parse(req.body);
      const id = String(req.params.id);
      if (id === req.owner!.id && !input.isActive)
        throw validationFailed({ isActive: "You cannot deactivate your own account." });
      const target = await ctx.prisma.owner.findUnique({ where: { id } });
      if (!target) throw new AppError(404, "NOT_FOUND", "Member not found.");
      if (target.role === "OWNER")
        throw new AppError(403, "FORBIDDEN", "The owner account cannot be deactivated here.");
      await ctx.prisma.owner.update({ where: { id }, data: { isActive: input.isActive } });
      if (!input.isActive)
        await ctx.prisma.session.updateMany({
          where: { ownerId: id, revokedAt: null },
          data: { revokedAt: ctx.now() },
        });
      await audit(ctx, req, {
        action: "identity.member.status",
        outcome: "SUCCESS",
        targetType: "member",
        targetId: id,
        metadata: input,
      });
      res.status(204).end();
    } catch (error) {
      next(error);
    }
  });

  router.post("/logout", async (req, res, next) => {
    try {
      if (req.sessionId) {
        await ctx.prisma.session.update({ where: { id: req.sessionId }, data: { revokedAt: ctx.now() } });
        await audit(ctx, req, {
          action: "auth.logout",
          outcome: "SUCCESS",
          targetType: "session",
          targetId: req.sessionId,
        });
      }
      res.clearCookie(SESSION_COOKIE, cookieOptions(ctx));
      res.status(204).end();
    } catch (error) {
      next(error);
    }
  });

  router.get("/session", requireOwner(), (req, res) => {
    res.json({ owner: req.owner });
  });

  router.get("/sessions", requireOwner(), authorize(ctx, "session:self-manage"), async (req, res, next) => {
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

  router.post("/sessions/:id/revoke", requireOwner(), authorize(ctx, "session:self-manage"), async (req, res, next) => {
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

  router.post(
    "/sessions/revoke-others",
    requireOwner(),
    authorize(ctx, "session:self-manage"),
    async (req, res, next) => {
      try {
        const result = await ctx.prisma.session.updateMany({
          where: { ownerId: req.owner!.id, revokedAt: null, NOT: { id: req.sessionId! } },
          data: { revokedAt: ctx.now() },
        });
        await audit(ctx, req, {
          action: "auth.session.revoke_others",
          outcome: "SUCCESS",
          metadata: { revoked: result.count },
        });
        res.json({ revoked: result.count });
      } catch (error) {
        next(error);
      }
    },
  );

  router.post("/password", requireOwner(), authorize(ctx, "session:self-manage"), async (req, res, next) => {
    try {
      const input = changePasswordSchema.parse(req.body);
      const owner = await ctx.prisma.owner.findUniqueOrThrow({ where: { id: req.owner!.id } });
      if (!(await verifyPassword(input.currentPassword, owner.passwordHash))) {
        await audit(ctx, req, {
          action: "auth.password.change",
          outcome: "FAILURE",
          metadata: { reason: "wrong_current" },
        });
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
      await audit(ctx, req, {
        action: "auth.password.change",
        outcome: "SUCCESS",
        targetType: "owner",
        targetId: owner.id,
      });
      res.status(204).end();
    } catch (error) {
      next(error);
    }
  });

  return router;
}
