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

// ── Removed startup behaviour ──────────────────────────────────────────────────

describe("single-origin app", () => {
	it("does not serve a root redirect (SvelteKit owns every non-/api path)", async () => {
		const res = await apiRequest("GET", "/");
		expect(res.status).toBe(404);
	});

	it("does not answer CORS preflights (the API is same-origin only)", async () => {
		const res = await apiRequest("OPTIONS", "/api/boards", {
			headers: {
				Origin: "https://example.com",
				"Access-Control-Request-Method": "GET",
			},
		});
		expect(res.headers.get("access-control-allow-origin")).toBeNull();
	});
});
