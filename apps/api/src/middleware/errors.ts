import type { ApiErrorBody } from "@asaa/contracts";
import { fieldErrors } from "@asaa/contracts";
import { Prisma } from "@prisma/client";
import type { NextFunction, Request, Response } from "express";
import { ZodError } from "zod";
import type { AppContext } from "../context.js";
import { AppError } from "../lib/errors.js";

function send(res: Response, req: Request, error: AppError) {
  const body: ApiErrorBody = {
    error: {
      code: error.code,
      message: error.message,
      requestId: req.requestId,
      ...(error.fields ? { fields: error.fields } : {}),
    },
  };
  res.status(error.status).json(body);
}

/** Standardised error responses; internal details are logged, never returned. */
export function errorHandler(ctx: AppContext) {
  // Express identifies error middleware by its four-argument signature.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  return (error: unknown, req: Request, res: Response, _next: NextFunction) => {
    if (error instanceof AppError) return send(res, req, error);
    if (error instanceof ZodError) {
      return send(res, req, new AppError(400, "VALIDATION_FAILED", "Check the highlighted fields.", fieldErrors(error)));
    }
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return send(res, req, new AppError(409, "CONFLICT", "A record with that identifier already exists."));
    }
    const status = (error as { status?: number; type?: string })?.status;
    if (status === 413) return send(res, req, new AppError(413, "PAYLOAD_TOO_LARGE", "Request body is too large."));
    if (status === 400 && (error as { type?: string }).type === "entity.parse.failed") {
      return send(res, req, new AppError(400, "VALIDATION_FAILED", "Request body is not valid JSON."));
    }
    ctx.logger.error("unhandled error", {
      requestId: req.requestId,
      path: req.path,
      error: error instanceof Error ? { name: error.name, message: error.message, stack: error.stack } : String(error),
    });
    send(res, req, new AppError(500, "INTERNAL", "Something went wrong. Try again or check the server logs."));
  };
}

export function notFoundHandler() {
  return (req: Request, res: Response) =>
    send(res, req, new AppError(404, "NOT_FOUND", "No such API route."));
}
