import { describe, it, expect, beforeEach } from "vitest";
import { mockBetterAuth, setCurrentUser } from "../../test/helpers/mock-session.js";
import { apiRequest } from "../../test/helpers/request.js";
import {
	seedUser,
	seedPersonalBoard,
	seedTeamWithBoard,
	seedColumn,
	seedCard,
} from "../../test/helpers/seed.js";

mockBetterAuth();

import app from "../app.js";

void app;

beforeEach(() => {
	setCurrentUser(null);
});

// ── POST /api/boards/:boardId/columns ─────────────────────────────────────────

describe("POST /api/boards/:boardId/columns", () => {
	it("returns 401 when no session", async () => {
		const res = await apiRequest("POST", "/api/boards/fakeid/columns", {
			body: { title: "Sprint 1" },
		});
		expect(res.status).toBe(401);
		const body = await res.json() as { error: { code: string } };
		expect(body.error.code).toBe("UNAUTHENTICATED");
	});

	it("returns 201 with created column when called by board admin", async () => {
		const user = await seedUser();
		const board = await seedPersonalBoard(user.id);
		setCurrentUser({ id: user.id, email: user.email });

		const res = await apiRequest("POST", `/api/boards/${board.id}/columns`, {
			body: { title: "Sprint 1" },
		});
		expect(res.status).toBe(201);

		const body = await res.json() as { title: string; boardId: string };
		expect(body.title).toBe("Sprint 1");
		expect(body.boardId).toBe(board.id);
	});

	it("returns 422 when title is empty", async () => {
		const user = await seedUser();
		const board = await seedPersonalBoard(user.id);
		setCurrentUser({ id: user.id, email: user.email });

		const res = await apiRequest("POST", `/api/boards/${board.id}/columns`, {
			body: { title: "" },
		});
		expect(res.status).toBe(422);
	});

	it("returns 201 when called by any team member", async () => {
		const admin = await seedUser();
		const member = await seedUser();
		const { board } = await seedTeamWithBoard({
			domain: "member-test.com",
			members: [
				{ userId: admin.id, role: "admin" },
				{ userId: member.id, role: "member" },
			],
		});

		setCurrentUser({ id: member.id, email: member.email });

		const res = await apiRequest("POST", `/api/boards/${board.id}/columns`, {
			body: { title: "Member Column" },
		});
		expect(res.status).toBe(201);
	});

	it("returns 404 when boardId does not exist", async () => {
		const user = await seedUser();
		setCurrentUser({ id: user.id, email: user.email });

		const res = await apiRequest("POST", "/api/boards/nonexistent-board-id/columns", {
			body: { title: "Ghost Column" },
		});
		expect(res.status).toBe(404);
	});
});

// ── PATCH /api/boards/:boardId/columns/reorder ────────────────────────────────

describe("PATCH /api/boards/:boardId/columns/reorder", () => {
	it("returns 200 with orderedIds — reorder handler runs (not :columnId match)", async () => {
		const user = await seedUser();
		const board = await seedPersonalBoard(user.id);
		const col1 = await seedColumn(board.id, { title: "A", position: "a0" });
		const col2 = await seedColumn(board.id, { title: "B", position: "a1" });
		setCurrentUser({ id: user.id, email: user.email });

		const res = await apiRequest(
			"PATCH",
			`/api/boards/${board.id}/columns/reorder`,
			{ body: { orderedIds: [col2.id, col1.id] } },
		);
		expect(res.status).toBe(200);

		const body = await res.json() as { orderedIds: string[] };
		// Confirm the reorder handler ran — body has orderedIds, not a columnId 422
		expect(Array.isArray(body.orderedIds)).toBe(true);
		expect(body.orderedIds).toEqual([col2.id, col1.id]);
	});

	it("returns 422 when orderedIds is empty", async () => {
		const user = await seedUser();
		const board = await seedPersonalBoard(user.id);
		setCurrentUser({ id: user.id, email: user.email });

		const res = await apiRequest(
			"PATCH",
			`/api/boards/${board.id}/columns/reorder`,
			{ body: { orderedIds: [] } },
		);
		expect(res.status).toBe(422);
	});
});

// ── PATCH /api/boards/:boardId/columns/:columnId ──────────────────────────────

describe("PATCH /api/boards/:boardId/columns/:columnId", () => {
	it("returns 200 with renamed column", async () => {
		const user = await seedUser();
		const board = await seedPersonalBoard(user.id);
		const col = await seedColumn(board.id, { title: "Old Name" });
		setCurrentUser({ id: user.id, email: user.email });

		const res = await apiRequest(
			"PATCH",
			`/api/boards/${board.id}/columns/${col.id}`,
			{ body: { title: "New Name" } },
		);
		expect(res.status).toBe(200);

		const body = await res.json() as { title: string };
		expect(body.title).toBe("New Name");
	});

	it("returns 422 when title is empty", async () => {
		const user = await seedUser();
		const board = await seedPersonalBoard(user.id);
		const col = await seedColumn(board.id);
		setCurrentUser({ id: user.id, email: user.email });

		const res = await apiRequest(
			"PATCH",
			`/api/boards/${board.id}/columns/${col.id}`,
			{ body: { title: "" } },
		);
		expect(res.status).toBe(422);
	});
});

// ── DELETE /api/boards/:boardId/columns/:columnId ─────────────────────────────

describe("DELETE /api/boards/:boardId/columns/:columnId", () => {
	it("returns 204 when column has no cards", async () => {
		const user = await seedUser();
		const board = await seedPersonalBoard(user.id);
		const col = await seedColumn(board.id);
		setCurrentUser({ id: user.id, email: user.email });

		const res = await apiRequest(
			"DELETE",
			`/api/boards/${board.id}/columns/${col.id}`,
		);
		expect(res.status).toBe(204);
	});

	it("returns 409 when column has cards", async () => {
		const user = await seedUser();
		const board = await seedPersonalBoard(user.id);
		const col = await seedColumn(board.id);
		await seedCard(board.id, col.id, { title: "Blocking Card" });
		setCurrentUser({ id: user.id, email: user.email });

		const res = await apiRequest(
			"DELETE",
			`/api/boards/${board.id}/columns/${col.id}`,
		);
		expect(res.status).toBe(409);
	});

	it("returns 404 when boardId does not exist", async () => {
		const user = await seedUser();
		setCurrentUser({ id: user.id, email: user.email });

		const res = await apiRequest(
			"DELETE",
			"/api/boards/nonexistent-board/columns/nonexistent-col",
		);
		expect(res.status).toBe(404);
	});
});
