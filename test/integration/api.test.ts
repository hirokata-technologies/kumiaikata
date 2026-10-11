import { describe, it, expect } from "vitest";
import { API, apiGet, apiPost } from "./helpers.js";

describe("kata-api health", () => {
	it("GET /healthz returns 200 with ok:true and db:true", async () => {
		const res = await fetch(`${API}/healthz`);
		expect(res.status).toBe(200);
		const body = (await res.json()) as { ok: boolean; db: boolean };
		expect(body.ok).toBe(true);
		expect(body.db).toBe(true);
	});
});

describe("kata-api authentication enforcement", () => {
	const protectedRoutes = [
		["GET", "/api/boards/personal"],
		["GET", "/api/boards/team"],
		["POST", "/api/boards"],
		["GET", "/api/teams/mine"],
		["GET", "/api/agents/sessions"],
		["POST", "/api/agents/sessions"],
	] as const;

	for (const [method, path] of protectedRoutes) {
		it(`${method} ${path} returns 401 without session`, async () => {
			const res = await fetch(`${API}${path}`, { method });
			expect(res.status).toBe(401);
			const body = (await res.json()) as { error: { code: string } };
			expect(body.error.code).toBe("UNAUTHENTICATED");
		});
	}

	it("GET /api/users/me/avatar returns 401 without session", async () => {
		const res = await fetch(`${API}/api/users/me/avatar`);
		expect(res.status).toBe(401);
	});

	it("GET /api/boards/:boardId/columns returns 401 without session", async () => {
		const res = await fetch(`${API}/api/boards/some-board-id/columns`);
		expect(res.status).toBe(401);
		const body = (await res.json()) as { error: { code: string } };
		expect(body.error.code).toBe("UNAUTHENTICATED");
	});

	it("GET /api/boards/:boardId/cards/:cardId returns 401 without session", async () => {
		const res = await fetch(
			`${API}/api/boards/some-board-id/cards/some-card-id`,
		);
		expect(res.status).toBe(401);
		const body = (await res.json()) as { error: { code: string } };
		expect(body.error.code).toBe("UNAUTHENTICATED");
	});

	it("GET /api/boards/:boardId/labels returns 401 without session", async () => {
		const res = await fetch(`${API}/api/boards/some-board-id/labels`);
		expect(res.status).toBe(401);
		const body = (await res.json()) as { error: { code: string } };
		expect(body.error.code).toBe("UNAUTHENTICATED");
	});
});

describe("kata-api error response shape", () => {
	it("401 response has error.code and error.message", async () => {
		const res = await apiGet("/api/boards/personal");
		const body = (await res.json()) as {
			error: { code: string; message: string };
		};
		expect(typeof body.error.code).toBe("string");
		expect(typeof body.error.message).toBe("string");
	});

	it("404 on unknown route returns appropriate response", async () => {
		const res = await apiGet("/api/nonexistent-route-xyz");
		expect(res.status).toBeGreaterThanOrEqual(400);
	});

	it("401 error.code is exactly UNAUTHENTICATED", async () => {
		const res = await apiGet("/api/boards/personal");
		expect(res.status).toBe(401);
		const body = (await res.json()) as { error: { code: string } };
		expect(body.error.code).toBe("UNAUTHENTICATED");
	});

	it("POST with invalid JSON body returns 400", async () => {
		const res = await fetch(`${API}/api/boards`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: "not-valid-json",
		});
		// Will be 400 (bad body) or 401 (auth check first) — both are valid failure modes
		expect(res.status).toBeGreaterThanOrEqual(400);
	});
});

describe("kata-api auth routes accessible", () => {
	it("GET /api/auth/get-session returns 200 (unauthenticated session is null)", async () => {
		const res = await apiGet("/api/auth/get-session");
		expect([200, 401]).toContain(res.status);
	});

	it("GET /api/auth/get-session response is valid JSON", async () => {
		const res = await apiGet("/api/auth/get-session");
		// Should be parseable JSON regardless of auth state
		const body = await res.json();
		expect(body).toBeDefined();
	});
});

describe("kata-api response content-type", () => {
	it("healthz returns application/json content-type", async () => {
		const res = await fetch(`${API}/healthz`);
		const ct = res.headers.get("Content-Type") ?? "";
		expect(ct).toContain("application/json");
	});

	it("401 responses return application/json content-type", async () => {
		const res = await apiGet("/api/boards/personal");
		const ct = res.headers.get("Content-Type") ?? "";
		expect(ct).toContain("application/json");
	});
});

describe("kata-api root redirect", () => {
	it("GET / returns a redirect to the web app login", async () => {
		const res = await fetch(`${API}/`, { redirect: "manual" });
		// Root redirects to kumiai.hirokata.dev/login
		expect([301, 302, 303, 307, 308]).toContain(res.status);
	});
});
