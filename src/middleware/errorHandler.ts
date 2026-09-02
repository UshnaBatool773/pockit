import { Request, Response } from "express";
import { ZodError } from "zod";
import { env } from "../config/env";
import { logger } from "../utils/logger";

export class ApiError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export function notFoundHandler(_req: Request, res: Response): void {
  res.status(404).json({
    error: "Not found",
  });
}

export function errorHandler(
  err: unknown,
  _req: Request,
  res: Response,
  _next: import("express").NextFunction
): void {
  if (err instanceof ZodError) {
    res.status(400).json({
      error: "Validation failed",
      details: err.issues.map((i) => ({
        path: i.path.join("."),
        message: i.message,
      })),
    });
    return;
  }

  if (err instanceof ApiError) {
    res.status(err.status).json({
      error: err.message,
    });
    return;
  }

  // Log full detail server-side, but never leak stack traces/internals.
  logger.error({ err }, "Unhandled error");

  res.status(500).json({
    error: "Internal server error",
    ...(env.isProd
      ? {}
      : {
          detail: err instanceof Error ? err.message : String(err),
        }),
  });
}