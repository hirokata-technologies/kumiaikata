import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock @sentry/node before any imports that reference it
vi.mock("@sentry/node", () => ({
  captureException: vi.fn(),
}));

import * as Sentry from "@sentry/node";
import { AppError, errorHandler } from "./error.js";
import type { ErrorCode } from "./error.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeContext(jsonFn = vi.fn()) {
  return { json: jsonFn } as unknown as Parameters<typeof errorHandler>[1];
}

// ---------------------------------------------------------------------------
// ErrorCode → HTTP status mapping
// ---------------------------------------------------------------------------

describe("AppError status codes", () => {
  const cases: Array<[ErrorCode, number]> = [
    ["UNAUTHENTICATED", 401],
    ["FORBIDDEN", 403],
    ["NOT_FOUND", 404],
    ["CONFLICT", 409],
    ["VALIDATION_ERROR", 422],
    ["PAYLOAD_TOO_LARGE", 413],
    ["UNSUPPORTED_MEDIA_TYPE", 415],
    ["DOMAIN_NOT_ALLOWED", 403],
    ["INTERNAL_ERROR", 500],
    ["BAD_GATEWAY", 502],
    ["SERVICE_UNAVAILABLE", 503],
  ];

  it.each(cases)("code %s maps to HTTP %d", (code, expectedStatus) => {
    const err = new AppError(code, "test message");
    expect(err.status).toBe(expectedStatus);
  });
});

// ---------------------------------------------------------------------------
// AppError shape
// ---------------------------------------------------------------------------

describe("AppError shape", () => {
  it("is an instance of Error", () => {
    const err = new AppError("NOT_FOUND", "resource missing");
    expect(err).toBeInstanceOf(Error);
  });

  it("name is 'AppError'", () => {
    const err = new AppError("NOT_FOUND", "resource missing");
    expect(err.name).toBe("AppError");
  });

  it("exposes the code property", () => {
    const err = new AppError("CONFLICT", "already exists");
    expect(err.code).toBe("CONFLICT");
  });

  it("exposes the message property", () => {
    const err = new AppError("FORBIDDEN", "access denied");
    expect(err.message).toBe("access denied");
  });

  it("details is undefined when not provided", () => {
    const err = new AppError("VALIDATION_ERROR", "bad input");
    expect(err.details).toBeUndefined();
  });

  it("details is set when provided", () => {
    const details = { field: "email", reason: "invalid format" };
    const err = new AppError("VALIDATION_ERROR", "bad input", details);
    expect(err.details).toEqual(details);
  });

  it("details can be any type (array)", () => {
    const details = ["field1", "field2"];
    const err = new AppError("VALIDATION_ERROR", "bad input", details);
    expect(err.details).toEqual(details);
  });

  it("details can be any type (string)", () => {
    const err = new AppError("VALIDATION_ERROR", "bad input", "extra info");
    expect(err.details).toBe("extra info");
  });
});

// ---------------------------------------------------------------------------
// errorHandler — AppError responses
// ---------------------------------------------------------------------------

describe("errorHandler with AppError", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns correct JSON structure for AppError", () => {
    const jsonFn = vi.fn();
    const c = makeContext(jsonFn);
    const err = new AppError("NOT_FOUND", "board not found");

    errorHandler(err, c);

    expect(jsonFn).toHaveBeenCalledWith(
      { error: { code: "NOT_FOUND", message: "board not found", details: undefined } },
      404,
    );
  });

  it("includes details in response when present", () => {
    const jsonFn = vi.fn();
    const c = makeContext(jsonFn);
    const details = { field: "id" };
    const err = new AppError("VALIDATION_ERROR", "invalid id", details);

    errorHandler(err, c);

    expect(jsonFn).toHaveBeenCalledWith(
      { error: { code: "VALIDATION_ERROR", message: "invalid id", details } },
      422,
    );
  });

  it("uses the AppError's HTTP status as the response status", () => {
    const jsonFn = vi.fn();
    const c = makeContext(jsonFn);
    const err = new AppError("UNAUTHENTICATED", "not logged in");

    errorHandler(err, c);

    const [, status] = jsonFn.mock.calls[0] as [unknown, number];
    expect(status).toBe(401);
  });

  it("does NOT call console.error for AppError", () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const c = makeContext();
    const err = new AppError("FORBIDDEN", "no access");

    errorHandler(err, c);

    expect(consoleSpy).not.toHaveBeenCalled();
    consoleSpy.mockRestore();
  });

  it("calls Sentry.captureException for 5xx AppErrors (INTERNAL_ERROR)", () => {
    const c = makeContext();
    const err = new AppError("INTERNAL_ERROR", "something broke");

    errorHandler(err, c);

    expect(Sentry.captureException).toHaveBeenCalledWith(err, {
      extra: { code: "INTERNAL_ERROR", details: undefined },
    });
  });

  it("does NOT call Sentry for 4xx AppErrors", () => {
    const c = makeContext();
    const err = new AppError("NOT_FOUND", "missing");

    errorHandler(err, c);

    expect(Sentry.captureException).not.toHaveBeenCalled();
  });

  it("does NOT call Sentry for FORBIDDEN (403) AppError", () => {
    const c = makeContext();
    const err = new AppError("FORBIDDEN", "not allowed");

    errorHandler(err, c);

    expect(Sentry.captureException).not.toHaveBeenCalled();
  });

  it("does NOT call Sentry for DOMAIN_NOT_ALLOWED (403) AppError", () => {
    const c = makeContext();
    const err = new AppError("DOMAIN_NOT_ALLOWED", "domain blocked");

    errorHandler(err, c);

    expect(Sentry.captureException).not.toHaveBeenCalled();
  });

  it("returns the result of c.json", () => {
    const sentinel = Symbol("response");
    const jsonFn = vi.fn().mockReturnValue(sentinel);
    const c = makeContext(jsonFn);
    const err = new AppError("CONFLICT", "duplicate");

    const result = errorHandler(err, c);

    expect(result).toBe(sentinel);
  });
});

// ---------------------------------------------------------------------------
// errorHandler — generic Error responses
// ---------------------------------------------------------------------------

describe("errorHandler with generic Error", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 500 INTERNAL_ERROR for a generic Error", () => {
    const jsonFn = vi.fn();
    const c = makeContext(jsonFn);
    const err = new Error("something unexpected");
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    errorHandler(err, c);

    expect(jsonFn).toHaveBeenCalledWith(
      { error: { code: "INTERNAL_ERROR", message: "Internal server error" } },
      500,
    );
    consoleSpy.mockRestore();
  });

  it("logs generic errors to console.error", () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const c = makeContext();
    const err = new Error("unexpected failure");

    errorHandler(err, c);

    expect(consoleSpy).toHaveBeenCalledWith("Unhandled error:", err);
    consoleSpy.mockRestore();
  });

  it("calls Sentry.captureException for generic errors", () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const c = makeContext();
    const err = new Error("crash");

    errorHandler(err, c);

    expect(Sentry.captureException).toHaveBeenCalledWith(err);
    consoleSpy.mockRestore();
  });

  it("returns the result of c.json for generic errors", () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const sentinel = Symbol("response");
    const jsonFn = vi.fn().mockReturnValue(sentinel);
    const c = makeContext(jsonFn);
    const err = new Error("crash");

    const result = errorHandler(err, c);

    expect(result).toBe(sentinel);
    consoleSpy.mockRestore();
  });
});

// ---------------------------------------------------------------------------
// All 9 error codes produce correct statuses (exhaustive round-trip)
// ---------------------------------------------------------------------------

describe("all error codes round-trip through errorHandler", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  const codes: Array<[ErrorCode, number]> = [
    ["UNAUTHENTICATED", 401],
    ["FORBIDDEN", 403],
    ["NOT_FOUND", 404],
    ["CONFLICT", 409],
    ["VALIDATION_ERROR", 422],
    ["PAYLOAD_TOO_LARGE", 413],
    ["UNSUPPORTED_MEDIA_TYPE", 415],
    ["DOMAIN_NOT_ALLOWED", 403],
    ["INTERNAL_ERROR", 500],
    ["BAD_GATEWAY", 502],
    ["SERVICE_UNAVAILABLE", 503],
  ];

  it.each(codes)("errorHandler uses status %d for %s", (code, expectedStatus) => {
    const jsonFn = vi.fn();
    const c = makeContext(jsonFn);
    const err = new AppError(code, "msg");

    errorHandler(err, c);

    const [body, status] = jsonFn.mock.calls[0] as [{ error: { code: string } }, number];
    expect(status).toBe(expectedStatus);
    expect(body.error.code).toBe(code);
  });
});
