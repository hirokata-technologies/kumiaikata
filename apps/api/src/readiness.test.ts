import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { pool } from "@kata/db";
import { auth } from "./auth/better-auth.js";
import { mockBetterAuth } from "../test/helpers/mock-session.js";
import { apiRequest } from "../test/helpers/request.js";
import { isReady, markNotReady, markReady } from "./readiness.js";

mockBetterAuth();

const STARTING_UP = {
	error: {
		code: "SERVICE_UNAVAILABLE",
		message: "Service is starting up. Try again shortly.",
	},
};

describe("readiness gate", () => {
	describe("while not ready", () => {
		beforeEach(() => {
			markNotReady();
		});

		afterEach(() => {
			vi.restoreAllMocks();
		});

		it("still answers /healthz", async () => {
			const res = await apiRequest("GET", "/healthz");
			expect(res.status).toBe(200);
			expect(await res.json()).toEqual({ ok: true, db: true });
		});

		it.each([
			["GET", "/"],
			["GET", "/api/boards"],
			["POST", "/api/auth/sign-in/social"],
			["GET", "/api/kumiai/anything"],
			["GET", "/no/such/route"],
			["GET", "/healthz/"],
		])("returns 503 for %s %s", async (method, path) => {
			const res = await apiRequest(method, path);
			expect(res.status).toBe(503);
			expect(res.headers.get("retry-after")).toBeTruthy();
			expect(await res.json()).toEqual(STARTING_UP);
		});

		it("answers /healthz with 503 { ok: false, db: false } when the database is down", async () => {
			vi.spyOn(pool, "query").mockRejectedValueOnce(new Error("db down"));
			const res = await apiRequest("GET", "/healthz");
			expect(res.status).toBe(503);
			expect(await res.json()).toEqual({ ok: false, db: false });
		});

		it.each(["POST", "PUT", "PATCH", "DELETE", "HEAD"])(
			"returns 503 for %s on a non-health route",
			async (method) => {
				const res = await apiRequest(method, "/api/boards");
				expect(res.status).toBe(503);
				expect(res.headers.get("retry-after")).toBeTruthy();
			},
		);

		it("does not run the auth handler, session lookup or database for a gated request", async () => {
			const querySpy = vi.spyOn(pool, "query");
			vi.mocked(auth.api.getSession).mockClear();
			vi.mocked(auth.handler).mockClear();

			await apiRequest("GET", "/api/boards");
			await apiRequest("POST", "/api/auth/sign-in/social");

			expect(auth.api.getSession).not.toHaveBeenCalled();
			expect(auth.handler).not.toHaveBeenCalled();
			expect(querySpy).not.toHaveBeenCalled();
		});

		it("keeps CORS headers on the 503", async () => {
			const res = await apiRequest("GET", "/api/boards", {
				headers: { origin: "http://localhost:3000" },
			});
			expect(res.status).toBe(503);
			expect(res.headers.get("access-control-allow-credentials")).toBe("true");
			expect(res.headers.get("access-control-allow-origin")).toBeTruthy();
		});

		// Accepted behavior (BUG-035): hono/cors answers an OPTIONS preflight
		// itself, before the readiness gate runs, so a preflight is NOT gated.
		// The gate sits after CORS on purpose so real 503s keep CORS headers.
		it("answers a CORS preflight from the CORS middleware, not the gate, and still gates the real request after it", async () => {
			const origin = "http://localhost:3000";
			const preflight = await apiRequest("OPTIONS", "/api/boards", {
				headers: {
					origin,
					"access-control-request-method": "GET",
				},
			});
			expect(preflight.status).toBe(204);
			expect(preflight.status).not.toBe(503);
			expect(preflight.headers.get("access-control-allow-origin")).toBe(origin);
			expect(preflight.headers.get("access-control-allow-credentials")).toBe(
				"true",
			);
			expect(preflight.headers.get("access-control-allow-methods")).toBeTruthy();
			expect(preflight.headers.get("retry-after")).toBeNull();

			const real = await apiRequest("GET", "/api/boards", {
				headers: { origin },
			});
			expect(real.status).toBe(503);
			expect(real.headers.get("retry-after")).toBeTruthy();
			expect(real.headers.get("access-control-allow-origin")).toBe(origin);
			expect(await real.json()).toEqual(STARTING_UP);
		});
	});

	it("starts NOT ready in a freshly loaded module", async () => {
		vi.resetModules();
		const fresh = await import("./readiness.js");
		expect(fresh.isReady()).toBe(false);
	});

	it("serves non-health routes normally once marked ready", async () => {
		markNotReady();
		expect((await apiRequest("GET", "/")).status).toBe(503);

		markReady();
		expect(isReady()).toBe(true);
		const res = await apiRequest("GET", "/");
		expect(res.status).toBe(302);
	});

	it("lets an unauthenticated API request reach its handler once ready (401, not 503)", async () => {
		markReady();
		const res = await apiRequest("GET", "/api/boards");
		expect(res.status).toBe(401);
	});
});
