import { describe, it, expect } from "vitest";
import { RELAY } from "./helpers.js";

describe("kata-relay-service health", () => {
	it("GET /healthz returns 200 with ok:true", async () => {
		const res = await fetch(`${RELAY}/healthz`);
		expect(res.status).toBe(200);
		const body = (await res.json()) as { ok: boolean };
		expect(body.ok).toBe(true);
	});

	it("healthz response is valid JSON", async () => {
		const res = await fetch(`${RELAY}/healthz`);
		const body = await res.json();
		expect(body).toBeDefined();
	});

	it("healthz returns application/json content-type", async () => {
		const res = await fetch(`${RELAY}/healthz`);
		const ct = res.headers.get("Content-Type") ?? "";
		expect(ct).toContain("application/json");
	});
});

describe("kata-relay-service SSE authentication enforcement", () => {
	it("GET /api/boards/:boardId/events returns 401 without session", async () => {
		const res = await fetch(`${RELAY}/api/boards/some-board-id/events`);
		expect(res.status).toBe(401);
		const body = (await res.json()) as { error: { code: string } };
		expect(body.error.code).toBe("UNAUTHENTICATED");
	});

	it("401 response has proper error shape with code and message", async () => {
		const res = await fetch(`${RELAY}/api/boards/some-board-id/events`);
		const body = (await res.json()) as {
			error: { code: string; message: string };
		};
		expect(typeof body.error.code).toBe("string");
		expect(typeof body.error.message).toBe("string");
	});

	it("different boardId values all return 401 without session", async () => {
		const boardIds = ["board-1", "00000000-0000-0000-0000-000000000000", "xyz"];
		for (const boardId of boardIds) {
			const res = await fetch(`${RELAY}/api/boards/${boardId}/events`);
			expect(res.status).toBe(401);
		}
	});
});

describe("kata-relay-service CORS", () => {
	it("includes CORS headers for allowed origin", async () => {
		const res = await fetch(`${RELAY}/healthz`, {
			headers: { Origin: "http://localhost:3000" },
		});
		const origin = res.headers.get("Access-Control-Allow-Origin");
		expect(origin).toBeTruthy();
	});

	it("CORS credentials are supported (Access-Control-Allow-Credentials)", async () => {
		const res = await fetch(`${RELAY}/healthz`, {
			headers: { Origin: "http://localhost:3000" },
		});
		const credentials = res.headers.get("Access-Control-Allow-Credentials");
		expect(credentials).toBe("true");
	});

	it("OPTIONS preflight on SSE endpoint returns 200 or 204", async () => {
		const res = await fetch(`${RELAY}/api/boards/some-board-id/events`, {
			method: "OPTIONS",
			headers: {
				Origin: "http://localhost:3000",
				"Access-Control-Request-Method": "GET",
			},
		});
		expect([200, 204]).toContain(res.status);
	});
});

describe("kata-relay-service unknown routes", () => {
	it("GET /api/nonexistent returns 4xx", async () => {
		const res = await fetch(`${RELAY}/api/nonexistent-route-xyz`);
		expect(res.status).toBeGreaterThanOrEqual(400);
	});
});
