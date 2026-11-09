import type { NextFunction, Request, Response } from "express";
import type { AppContext, AuthenticatedOwner } from "../../context.js";
import { forbidden } from "../../lib/errors.js";
import { audit } from "../audit/audit.service.js";

/**
 * Policy-based authorization foundation (US-A04). Every protected route declares
 * the permission it needs; the check runs server-side. Initially only the OWNER
 * role exists and holds every permission. New roles (admin, employee, org admin)
 * are added here without touching routes; ABAC/ReBAC rules can be layered into
 * `isAllowed` through the resource argument.
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
  "generation:read",
  "generation:write",
  "audit:read",
  "session:manage",
] as const;
export type Permission = (typeof PERMISSIONS)[number];

const ROLE_PERMISSIONS: Record<AuthenticatedOwner["role"], ReadonlySet<Permission>> = {
  OWNER: new Set(PERMISSIONS),
};

export function isAllowed(actor: AuthenticatedOwner | undefined, permission: Permission): boolean {
  return Boolean(actor && ROLE_PERMISSIONS[actor.role]?.has(permission));
}

export function authorize(ctx: AppContext, permission: Permission) {
  return async (req: Request, _res: Response, next: NextFunction) => {
    if (isAllowed(req.owner, permission)) return next();
    await audit(ctx, req, { action: "authz.denied", outcome: "DENIED", metadata: { permission, path: req.path } });
    next(forbidden());
  };
}
