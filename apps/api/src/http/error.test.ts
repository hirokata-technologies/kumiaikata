import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { Context } from "hono";
import { AppError, errorHandler } from "./error.js";
import { ok, created, noContent } from "./responders.js";
import { validateId } from "./validate.js";

// ---------------------------------------------------------------------------
// AppError status codes
// ---------------------------------------------------------------------------

describe("AppError status codes", () => {
	it("NOT_FOUND returns 404", () => {
		const err = new AppError("NOT_FOUND", "Board not found.");
		expect(err.status).toBe(404);
	});

	it("VALIDATION_ERROR returns 422", () => {
		const err = new AppError("VALIDATION_ERROR", "Bad input");
		expect(err.status).toBe(422);
	});

	it("DOMAIN_NOT_ALLOWED returns 403", () => {
		const err = new AppError("DOMAIN_NOT_ALLOWED", "Domain not permitted.");
		expect(err.status).toBe(403);
	});

	it("UNAUTHENTICATED returns 401", () => {
		expect(new AppError("UNAUTHENTICATED", "x").status).toBe(401);
	});

	it("FORBIDDEN returns 403", () => {
		expect(new AppError("FORBIDDEN", "x").status).toBe(403);
	});

	it("CONFLICT returns 409", () => {
		expect(new AppError("CONFLICT", "x").status).toBe(409);
	});

	it("INTERNAL_ERROR returns 500", () => {
		expect(new AppError("INTERNAL_ERROR", "x").status).toBe(500);
	});

	it("PAYLOAD_TOO_LARGE returns 413", () => {
		expect(new AppError("PAYLOAD_TOO_LARGE", "x").status).toBe(413);
	});

	it("UNSUPPORTED_MEDIA_TYPE returns 415", () => {
		expect(new AppError("UNSUPPORTED_MEDIA_TYPE", "x").status).toBe(415);
	});

	it("preserves code, message, and details", () => {
		const err = new AppError("NOT_FOUND", "missing", { field: "id" });
		expect(err.code).toBe("NOT_FOUND");
		expect(err.message).toBe("missing");
		expect(err.details).toEqual({ field: "id" });
	});
});

// ---------------------------------------------------------------------------
// errorHandler
// ---------------------------------------------------------------------------

function makeFakeContext(): { json: ReturnType<typeof vi.fn>; body: ReturnType<typeof vi.fn> } & unknown {
	return {
		json: vi.fn().mockReturnValue("RESP"),
		body: vi.fn().mockReturnValue("RESP"),
	};
}

describe("errorHandler", () => {
	let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

	beforeEach(() => {
		consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
	});

	afterEach(() => {
		consoleErrorSpy.mockRestore();
	});

	it("calls c.json with status 404 and structured body for AppError NOT_FOUND", () => {
		const c = makeFakeContext() as unknown as Context;
		errorHandler(new AppError("NOT_FOUND", "Board not found."), c);
		expect((c as { json: ReturnType<typeof vi.fn> }).json).toHaveBeenCalledWith(
			{ error: { code: "NOT_FOUND", message: "Board not found.", details: undefined } },
			404,
		);
	});

	it("calls c.json with status 500 and INTERNAL_ERROR body for generic Error", () => {
		const c = makeFakeContext() as unknown as Context;
		errorHandler(new Error("boom"), c);
		expect((c as { json: ReturnType<typeof vi.fn> }).json).toHaveBeenCalledWith(
			{ error: { code: "INTERNAL_ERROR", message: "Internal server error" } },
			500,
		);
	});

	it("logs unhandled errors to console.error", () => {
		const c = makeFakeContext() as unknown as Context;
		const err = new Error("boom");
		errorHandler(err, c);
		expect(consoleErrorSpy).toHaveBeenCalledWith("Unhandled error:", err);
	});
});

// ---------------------------------------------------------------------------
// responders: ok, created, noContent
// ---------------------------------------------------------------------------

describe("responders", () => {
	it("ok calls c.json with body and status 200", () => {
		const c = makeFakeContext() as unknown as Context;
		ok(c, { id: "1" });
		expect((c as { json: ReturnType<typeof vi.fn> }).json).toHaveBeenCalledWith({ id: "1" }, 200);
	});

	it("created calls c.json with body and status 201", () => {
		const c = makeFakeContext() as unknown as Context;
		created(c, { id: "1" });
		expect((c as { json: ReturnType<typeof vi.fn> }).json).toHaveBeenCalledWith({ id: "1" }, 201);
	});

	it("noContent calls c.body with null and status 204", () => {
		const c = makeFakeContext() as unknown as Context;
		noContent(c);
		expect((c as { body: ReturnType<typeof vi.fn> }).body).toHaveBeenCalledWith(null, 204);
	});
});

// ---------------------------------------------------------------------------
// validateId
// ---------------------------------------------------------------------------

describe("validateId", () => {
	it("throws AppError VALIDATION_ERROR with name when value is undefined", () => {
		expect(() => validateId(undefined, "boardId")).toThrow(AppError);

		try {
			validateId(undefined, "boardId");
		} catch (err) {
			expect((err as AppError).code).toBe("VALIDATION_ERROR");
			expect((err as AppError).message).toContain("boardId");
		}
	});

	it("returns the value unchanged for a valid string", () => {
		expect(validateId("abc", "boardId")).toBe("abc");
	});

	it("throws when value is empty string (falsy)", () => {
		expect(() => validateId("" as string | undefined, "boardId")).toThrow(AppError);
	});
});
