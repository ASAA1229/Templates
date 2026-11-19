import type { ApiErrorCode } from "@asaa/contracts";

/** Errors that are safe to show to the client; anything else becomes a generic 500. */
export class AppError extends Error {
  constructor(
    readonly status: number,
    readonly code: ApiErrorCode,
    message: string,
    readonly fields?: Record<string, string>,
  ) {
    super(message);
    this.name = "AppError";
  }
}

export const notFound = (what = "Resource") => new AppError(404, "NOT_FOUND", `${what} not found.`);
export const conflict = (message: string) => new AppError(409, "CONFLICT", message);
export const validationFailed = (fields: Record<string, string>, message = "Check the highlighted fields.") =>
  new AppError(400, "VALIDATION_FAILED", message, fields);
export const unauthenticated = () => new AppError(401, "UNAUTHENTICATED", "Sign in to continue.");
export const forbidden = () => new AppError(403, "FORBIDDEN", "You do not have permission for this action.");
export const notEligible = (message: string, fields?: Record<string, string>) =>
  new AppError(422, "NOT_ELIGIBLE", message, fields);
