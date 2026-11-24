import type { CookieOptions, Request, Response, Router } from "express";
import { z } from "zod";
import type { AppContext } from "../../context.js";
import { AppError, notFound, validationFailed } from "../../lib/errors.js";
import { hashToken, newSessionToken } from "../../lib/tokens.js";
import { DbRateLimiter } from "../../middleware/rate-limit.js";
import { audit } from "../audit/audit.service.js";
import { requireOwner, startSession } from "./auth.js";
import { verifySecondFactor } from "./mfa.js";
import { OidcSso, SsoError, hasControlChars, readOidcConfig } from "./oidc.js";
import { authorize } from "./policy.js";

/**
 * Optional single sign-on (disabled unless TEMPLATES_OIDC_ISSUER / _CLIENT_ID / _CLIENT_SECRET are set).
 *
 * Security model: SSO signs in EXISTING, active local accounts only. The account is matched by an explicit
 * subject link (Owner.ssoSubject) or, when the subject is not linked anywhere, by the provider's VERIFIED
 * email (never for OWNER/ADMIN accounts, which the owner links explicitly). It never provisions users and never reads roles from the token: roles stay with Templates. An
 * account with MFA enabled still has to pass the existing TOTP/recovery-code step. Local login is untouched.
 */
const STATE_COOKIE = "asaa_sso_state";
const MFA_COOKIE = "asaa_sso_mfa";
const COOKIE_PATH = "/api/auth/sso";
const STEP_TTL_MS = 10 * 60_000;
const MFA_TTL_MS = 5 * 60_000;
const MAX_MFA_TICKETS = 200;

interface Options {
  /** Test seam: a ready client instead of reading the environment. */
  client?: OidcSso;
}

export function registerSsoRoutes(router: Router, ctx: AppContext, options: Options = {}) {
  const config = options.client ? undefined : readOidcConfig(ctx.config, ctx.config.WEB_ORIGIN);
  const sso = options.client ?? (config ? new OidcSso(config) : undefined);
  const ipLimiter = new DbRateLimiter(ctx, "sso-ip", 30, 15 * 60_000);
  const mfaLimiter = new DbRateLimiter(ctx, "sso-mfa", 8, 15 * 60_000);
  const mfaTickets = new Map<string, { ownerId: string; expiresAt: number }>();

  const cookie = (maxAge: number, sameSite: "lax" | "strict"): CookieOptions => ({
    httpOnly: true,
    sameSite,
    secure: ctx.config.COOKIE_SECURE,
    path: COOKIE_PATH,
    maxAge,
  });
  const clear = (res: Response, name: string, sameSite: "lax" | "strict") =>
    res.clearCookie(name, { httpOnly: true, sameSite, secure: ctx.config.COOKIE_SECURE, path: COOKIE_PATH });
  const fail = async (req: Request, res: Response, reason: string, targetId?: string) => {
    await audit(ctx, req, { action: "auth.sso.login", outcome: "FAILURE", ...(targetId ? { targetType: "owner", targetId } : {}), metadata: { reason } });
    clear(res, STATE_COOKIE, "lax");
    res.redirect(302, "/login?sso=failed");
  };

  router.get("/sso/status", (_req, res) => {
    res.json({ enabled: Boolean(sso) });
  });

  router.get("/sso/login", async (req, res, next) => {
    try {
      if (!sso) throw notFound("Single sign-on is not enabled.");
      if ((await ipLimiter.consume(req.ip ?? "unknown")) > 0) throw new AppError(429, "RATE_LIMITED", "Too many sign-in attempts. Try again later.");
      let begun: { url: string; state: string };
      try {
        begun = await sso.beginLogin();
      } catch (error) {
        if (error instanceof SsoError) {
          await audit(ctx, req, { action: "auth.sso.login", outcome: "FAILURE", metadata: { reason: error.code } });
          return res.redirect(302, "/login?sso=unavailable");
        }
        throw error;
      }
      res.cookie(STATE_COOKIE, begun.state, cookie(STEP_TTL_MS, "lax"));
      res.redirect(302, begun.url);
    } catch (error) {
      next(error);
    }
  });

  router.get("/sso/callback", async (req, res, next) => {
    try {
      if (!sso) throw notFound("Single sign-on is not enabled.");
      if ((await ipLimiter.consume(req.ip ?? "unknown")) > 0) throw new AppError(429, "RATE_LIMITED", "Too many sign-in attempts. Try again later.");
      const code = typeof req.query.code === "string" ? req.query.code : "";
      const state = typeof req.query.state === "string" ? req.query.state : "";
      const bound = req.cookies?.[STATE_COOKIE] as string | undefined;
      // The state must come back in the same browser that started the login (login CSRF defence).
      if (typeof req.query.error === "string" || !state || !bound || bound !== state) {
        return await fail(req, res, typeof req.query.error === "string" ? "provider_denied" : "state_mismatch");
      }
      let identity;
      try {
        identity = await sso.completeLogin(code, state);
      } catch (error) {
        if (error instanceof SsoError) return await fail(req, res, error.code);
        throw error;
      }
      // Explicit subject link first; otherwise a verified email, but only when the account is not linked to another subject.
      let owner = await ctx.prisma.owner.findUnique({ where: { ssoSubject: identity.sub } });
      let via = "subject_link";
      if (!owner && identity.verifiedEmail) {
        const byEmail = await ctx.prisma.owner.findUnique({ where: { email: identity.verifiedEmail } });
        if (byEmail && !byEmail.ssoSubject && (byEmail.role === "OWNER" || byEmail.role === "ADMIN")) {
          // Privileged accounts are never linked by email: the owner must link them via PUT /members/:id/sso-subject (E3:D5.16).
          return await fail(req, res, "privileged_email_link_refused", byEmail.id);
        } else if (byEmail && !byEmail.ssoSubject) {
          owner = byEmail;
          via = "verified_email";
        } else if (byEmail) {
          return await fail(req, res, "linked_to_other_subject", byEmail.id);
        }
      }
      if (!owner || !owner.isActive) return await fail(req, res, owner ? "inactive_account" : "no_local_account", owner?.id);
      clear(res, STATE_COOKIE, "lax");
      if (owner.mfaEnabledAt) {
        // Same second factor as local sign-in: hold a short-lived, single-use ticket until the code is verified.
        const now = ctx.now().getTime();
        for (const [key, entry] of mfaTickets) if (entry.expiresAt <= now) mfaTickets.delete(key);
        while (mfaTickets.size >= MAX_MFA_TICKETS) {
          const oldest = mfaTickets.keys().next().value;
          if (oldest === undefined) break;
          mfaTickets.delete(oldest);
        }
        const { token, tokenHash } = newSessionToken();
        mfaTickets.set(tokenHash, { ownerId: owner.id, expiresAt: now + MFA_TTL_MS });
        res.cookie(MFA_COOKIE, token, cookie(MFA_TTL_MS, "strict"));
        await audit(ctx, req, { action: "auth.sso.login", outcome: "DENIED", targetType: "owner", targetId: owner.id, metadata: { reason: "mfa_required", via } });
        return res.redirect(302, "/login?sso=mfa");
      }
      await startSession(ctx, req, res, owner, "auth.sso.login", { via });
      res.redirect(302, "/");
    } catch (error) {
      next(error);
    }
  });

  router.post("/sso/mfa", async (req, res, next) => {
    try {
      if (!sso) throw notFound("Single sign-on is not enabled.");
      const input = z.object({ code: z.string().trim().min(6).max(32) }).safeParse(req.body);
      const token = req.cookies?.[MFA_COOKIE] as string | undefined;
      const ticket = token && token.length <= 100 ? mfaTickets.get(hashToken(token)) : undefined;
      if (!input.success) throw validationFailed({ code: "Enter the code from your authenticator app." });
      if (!ticket || ticket.expiresAt <= ctx.now().getTime()) {
        clear(res, MFA_COOKIE, "strict");
        throw new AppError(401, "UNAUTHENTICATED", "Single sign-in expired. Start again.");
      }
      const retryAfter = Math.max(await mfaLimiter.consume(ticket.ownerId), await ipLimiter.consume(req.ip ?? "unknown"));
      if (retryAfter > 0) {
        res.setHeader("retry-after", String(retryAfter));
        throw new AppError(429, "RATE_LIMITED", "Too many attempts. Try again later.");
      }
      const owner = await ctx.prisma.owner.findUnique({ where: { id: ticket.ownerId } });
      if (!owner || !owner.isActive || !owner.mfaEnabledAt) {
        mfaTickets.delete(hashToken(token!));
        throw new AppError(401, "UNAUTHENTICATED", "Single sign-in expired. Start again.");
      }
      if (!(await verifySecondFactor(ctx, owner, input.data.code))) {
        await audit(ctx, req, { action: "auth.sso.login", outcome: "FAILURE", targetType: "owner", targetId: owner.id, metadata: { reason: "invalid_mfa_code" } });
        throw new AppError(401, "UNAUTHENTICATED", "Invalid verification code.");
      }
      mfaTickets.delete(hashToken(token!));
      clear(res, MFA_COOKIE, "strict");
      await mfaLimiter.reset(owner.id);
      await startSession(ctx, req, res, owner, "auth.sso.login", { via: "mfa" });
      res.json({ owner: req.owner });
    } catch (error) {
      next(error);
    }
  });

  /** Explicit subject link. Only the owner may (re)link privileged accounts, so an administrator cannot hijack them. */
  router.put("/members/:id/sso-subject", requireOwner(), authorize(ctx, "identity:manage"), async (req, res, next) => {
    try {
      const input = z
        .object({ subject: z.string().trim().min(1).max(255).refine((value) => !hasControlChars(value)).nullable() })
        .safeParse(req.body);
      if (!input.success) throw validationFailed({ subject: "Provide the identity provider subject, or null to unlink." });
      const id = String(req.params.id);
      const target = await ctx.prisma.owner.findUnique({ where: { id } });
      if (!target) throw notFound("Member not found.");
      if ((target.role === "OWNER" || target.role === "ADMIN") && req.owner!.role !== "OWNER") {
        throw new AppError(403, "FORBIDDEN", "Only the owner can link single sign-on for privileged accounts.");
      }
      try {
        await ctx.prisma.owner.update({ where: { id }, data: { ssoSubject: input.data.subject } });
      } catch (error) {
        if (error && typeof error === "object" && "code" in error && error.code === "P2002") {
          throw new AppError(409, "CONFLICT", "That subject is already linked to another account.");
        }
        throw error;
      }
      await audit(ctx, req, {
        action: input.data.subject ? "auth.sso.link" : "auth.sso.unlink",
        outcome: "SUCCESS",
        targetType: "owner",
        targetId: id,
      });
      res.status(204).end();
    } catch (error) {
      next(error);
    }
  });
}
