import type { NextFunction, Request, Response } from "express";
import type { AppContext, AuthenticatedOwner } from "../../context.js";
import { AppError, forbidden } from "../../lib/errors.js";
import { audit } from "../audit/audit.service.js";

/**
 * Policy-based authorization foundation (US-A04). Every protected route declares
 * the permission it needs; the check runs server-side. Workspace roles receive
 * least-privilege permission sets here; resource-level ownership checks remain
 * enforced by the corresponding project and domain services.
 */
export const PERMISSIONS = [
  "dashboard:read",
  "project:read",
  "project:write",
  "requirement:read",
  "requirement:write",
  "catalog:read",
  "catalog:write",
  "template:read",
  "template:approve",
  "template:submit",
  "template:review",
  "generation:read",
  "generation:write",
  "workspace:read",
  "workspace:write",
  "audit:read",
  "session:manage",
  "session:self-manage",
  "identity:manage",
] as const;
export type Permission = (typeof PERMISSIONS)[number];

const ROLE_PERMISSIONS: Record<AuthenticatedOwner["role"], ReadonlySet<Permission>> = {
  OWNER: new Set(PERMISSIONS),
  ADMIN: new Set(PERMISSIONS.filter((permission) => permission !== "session:manage")),
  DEVELOPER: new Set([
    "dashboard:read",
    "project:read",
    "project:write",
    "requirement:read",
    "requirement:write",
    "catalog:read",
    "template:read",
    "template:submit",
    "generation:read",
    "generation:write",
    "workspace:read",
    "workspace:write",
    "session:self-manage",
  ]),
  TESTER: new Set([
    "dashboard:read",
    "project:read",
    "requirement:read",
    "requirement:write",
    "catalog:read",
    "template:read",
    "template:submit",
    "generation:read",
    "workspace:read",
    "workspace:write",
    "session:self-manage",
  ]),
  EMPLOYEE: new Set([
    "dashboard:read",
    "project:read",
    "project:write",
    "requirement:read",
    "requirement:write",
    "catalog:read",
    "template:read",
    "template:submit",
    "generation:read",
    "generation:write",
    "workspace:read",
    "workspace:write",
    "session:self-manage",
  ]),
};

export function isAllowed(actor: AuthenticatedOwner | undefined, permission: Permission): boolean {
  return Boolean(actor && ROLE_PERMISSIONS[actor.role]?.has(permission));
}

/** Permissions that, for OWNER/ADMIN, require MFA when REQUIRE_MFA_PRIVILEGED is on. */
const MFA_GATED: ReadonlySet<Permission> = new Set([
  "identity:manage",
  "template:approve",
  "catalog:write",
  "audit:read",
  "session:manage",
]);

export function authorize(ctx: AppContext, permission: Permission) {
  return async (req: Request, _res: Response, next: NextFunction) => {
    if (
      ctx.config.REQUIRE_MFA_PRIVILEGED &&
      req.owner &&
      (req.owner.role === "OWNER" || req.owner.role === "ADMIN") &&
      !req.owner.mfaEnabled &&
      MFA_GATED.has(permission) &&
      isAllowed(req.owner, permission)
    ) {
      await audit(ctx, req, {
        action: "authz.denied",
        outcome: "DENIED",
        metadata: { permission, reason: "mfa_required" },
      });
      return next(
        new AppError(
          403,
          "FORBIDDEN",
          "Multi-factor authentication is required for this action. Enable it under Security.",
        ),
      );
    }
    if (isAllowed(req.owner, permission)) return next();
    await audit(ctx, req, { action: "authz.denied", outcome: "DENIED", metadata: { permission, path: req.path } });
    next(forbidden());
  };
}
