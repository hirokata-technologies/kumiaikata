import { describe, it, expect, beforeEach } from "vitest";
import { mockBetterAuth, setCurrentUser } from "../test/helpers/mock-session.js";
import { apiRequest } from "../test/helpers/request.js";

mockBetterAuth();

import app from "./app.js";

void app;

beforeEach(() => {
	setCurrentUser(null);
});

// ── GET /healthz ───────────────────────────────────────────────────────────────

describe("GET /healthz", () => {
	it("returns 200 with { ok: true, db: true } when database is reachable", async () => {
		const res = await apiRequest("GET", "/healthz");
		expect(res.status).toBe(200);

		const body = await res.json() as { ok: boolean; db: boolean };
		expect(body.ok).toBe(true);
		expect(body.db).toBe(true);
	});
});

// ── GET / ──────────────────────────────────────────────────────────────────────

describe("GET /", () => {
	it("redirects to the login page when no error param is present", async () => {
		const res = await apiRequest("GET", "/");
		// Hono returns 302 by default for c.redirect()
		expect(res.status).toBe(302);

		const location = res.headers.get("location");
		expect(location).toBe("https://kata.hirokata.dev/login");
	});

	it("redirects to login with sanitized error param when ?error=access_denied", async () => {
		const res = await apiRequest("GET", "/?error=access_denied");
		expect(res.status).toBe(302);

		const location = res.headers.get("location");
		expect(location).toBe("https://kata.hirokata.dev/login?error=access_denied");
	});

	it("sanitizes error param by stripping non-word characters", async () => {
		// Inject a param with special characters; sanitization keeps only word chars and hyphens
		const res = await apiRequest("GET", "/?error=bad%3Cinput%3E");
		expect(res.status).toBe(302);

		const location = res.headers.get("location");
		// Special chars stripped → "badinput"
		expect(location).toContain("error=badinput");
	});
});
