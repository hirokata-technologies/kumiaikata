import * as Sentry from "@sentry/node";
import type { Context } from "hono";

export type ErrorCode =
  | "UNAUTHENTICATED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "CONFLICT"
  | "VALIDATION_ERROR"
  | "PAYLOAD_TOO_LARGE"
  | "UNSUPPORTED_MEDIA_TYPE"
  | "DOMAIN_NOT_ALLOWED"
  | "INTERNAL_ERROR";

const STATUS: Record<ErrorCode, number> = {
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  VALIDATION_ERROR: 422,
  PAYLOAD_TOO_LARGE: 413,
  UNSUPPORTED_MEDIA_TYPE: 415,
  DOMAIN_NOT_ALLOWED: 403,
  INTERNAL_ERROR: 500,
};

export class AppError extends Error {
  constructor(
    public readonly code: ErrorCode,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = "AppError";
  }

  get status(): number {
    return STATUS[this.code];
  }
}

export const errorHandler = (err: Error, c: Context) => {
  if (err instanceof AppError) {
    if (err.status >= 500) {
      Sentry.captureException(err, { extra: { code: err.code, details: err.details } });
    }
    return c.json(
      { error: { code: err.code, message: err.message, details: err.details } },
      err.status as Parameters<typeof c.json>[1],
    );
  }
  Sentry.captureException(err);
  console.error("Unhandled error:", err);
  return c.json(
    { error: { code: "INTERNAL_ERROR", message: "Internal server error" } },
    500,
  );
};
