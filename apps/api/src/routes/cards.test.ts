import { describe, it, expect, beforeEach } from "vitest";
import { mockBetterAuth, setCurrentUser } from "../../test/helpers/mock-session.js";
import { apiRequest } from "../../test/helpers/request.js";
import {
	seedUser,
	seedPersonalBoard,
	seedColumn,
	seedCard,
} from "../../test/helpers/seed.js";

mockBetterAuth();

import app from "../app.js";

void app;

beforeEach(() => {
	setCurrentUser(null);
});

// ── POST /api/boards/:boardId/columns/:columnId/cards ─────────────────────────

describe("POST /api/boards/:boardId/columns/:columnId/cards", () => {
	it("returns 401 when no session", async () => {
		const res = await apiRequest(
			"POST",
			"/api/boards/fakeid/columns/fakecol/cards",
			{ body: { title: "Task" } },
		);
		expect(res.status).toBe(401);
		const body = await res.json() as { error: { code: string } };
		expect(body.error.code).toBe("UNAUTHENTICATED");
	});

	it("returns 201 with card summary on success", async () => {
		const user = await seedUser();
		const board = await seedPersonalBoard(user.id);
		const col = await seedColumn(board.id);
		setCurrentUser({ id: user.id, email: user.email });

		const res = await apiRequest(
			"POST",
			`/api/boards/${board.id}/columns/${col.id}/cards`,
			{ body: { title: "Fix login bug" } },
		);
		expect(res.status).toBe(201);

		const body = await res.json() as {
			title: string;
			boardId: string;
			columnId: string;
		};
		expect(body.title).toBe("Fix login bug");
		expect(body.boardId).toBe(board.id);
		expect(body.columnId).toBe(col.id);
	});

	it("returns 422 when title is empty", async () => {
		const user = await seedUser();
		const board = await seedPersonalBoard(user.id);
		const col = await seedColumn(board.id);
		setCurrentUser({ id: user.id, email: user.email });

		const res = await apiRequest(
			"POST",
			`/api/boards/${board.id}/columns/${col.id}/cards`,
			{ body: { title: "" } },
		);
		expect(res.status).toBe(422);
	});
});

// ── GET /api/boards/:boardId/cards/:cardId ────────────────────────────────────

describe("GET /api/boards/:boardId/cards/:cardId", () => {
	it("returns 401 when no session", async () => {
		const res = await apiRequest("GET", "/api/boards/fakeid/cards/fakecardid");
		expect(res.status).toBe(401);
	});

	it("returns 200 with full card detail", async () => {
		const user = await seedUser();
		const board = await seedPersonalBoard(user.id);
		const col = await seedColumn(board.id);
		const card = await seedCard(board.id, col.id, { title: "My Task" });
		setCurrentUser({ id: user.id, email: user.email });

		const res = await apiRequest(
			"GET",
			`/api/boards/${board.id}/cards/${card.id}`,
		);
		expect(res.status).toBe(200);

		const body = await res.json() as {
			id: string;
			title: string;
			comments: unknown[];
			checklists: unknown[];
		};
		expect(body.id).toBe(card.id);
		expect(body.title).toBe("My Task");
		expect(Array.isArray(body.comments)).toBe(true);
		expect(Array.isArray(body.checklists)).toBe(true);
	});

	it("returns 404 for a non-existent card", async () => {
		const user = await seedUser();
		const board = await seedPersonalBoard(user.id);
		setCurrentUser({ id: user.id, email: user.email });

		const res = await apiRequest(
			"GET",
			`/api/boards/${board.id}/cards/nonexistent-card`,
		);
		expect(res.status).toBe(404);
	});
});

// ── PATCH /api/boards/:boardId/cards/:cardId ──────────────────────────────────

describe("PATCH /api/boards/:boardId/cards/:cardId", () => {
	it("returns 200 with updated card", async () => {
		const user = await seedUser();
		const board = await seedPersonalBoard(user.id);
		const col = await seedColumn(board.id);
		const card = await seedCard(board.id, col.id, { title: "Old Title" });
		setCurrentUser({ id: user.id, email: user.email });

		const res = await apiRequest(
			"PATCH",
			`/api/boards/${board.id}/cards/${card.id}`,
			{ body: { title: "New Title" } },
		);
		expect(res.status).toBe(200);

		const body = await res.json() as { title: string };
		expect(body.title).toBe("New Title");
	});

	it("returns 422 when title exceeds 500 characters", async () => {
		const user = await seedUser();
		const board = await seedPersonalBoard(user.id);
		const col = await seedColumn(board.id);
		const card = await seedCard(board.id, col.id);
		setCurrentUser({ id: user.id, email: user.email });

		const res = await apiRequest(
			"PATCH",
			`/api/boards/${board.id}/cards/${card.id}`,
			{ body: { title: "x".repeat(501) } },
		);
		expect(res.status).toBe(422);
	});
});

// ── PATCH /api/boards/:boardId/cards/:cardId/move ─────────────────────────────

describe("PATCH /api/boards/:boardId/cards/:cardId/move", () => {
	it("returns 200 and card is in target column", async () => {
		const user = await seedUser();
		const board = await seedPersonalBoard(user.id);
		const col1 = await seedColumn(board.id, { title: "Source", position: "a0" });
		const col2 = await seedColumn(board.id, { title: "Target", position: "a1" });
		const card = await seedCard(board.id, col1.id, { title: "Moveable" });
		setCurrentUser({ id: user.id, email: user.email });

		const res = await apiRequest(
			"PATCH",
			`/api/boards/${board.id}/cards/${card.id}/move`,
			{ body: { targetColumnId: col2.id, position: 0 } },
		);
		expect(res.status).toBe(200);

		const body = await res.json() as { columnId: string };
		expect(body.columnId).toBe(col2.id);
	});
});

// ── DELETE /api/boards/:boardId/cards/:cardId ─────────────────────────────────

describe("DELETE /api/boards/:boardId/cards/:cardId", () => {
	it("returns 204 and card no longer exists", async () => {
		const user = await seedUser();
		const board = await seedPersonalBoard(user.id);
		const col = await seedColumn(board.id);
		const card = await seedCard(board.id, col.id);
		setCurrentUser({ id: user.id, email: user.email });

		const deleteRes = await apiRequest(
			"DELETE",
			`/api/boards/${board.id}/cards/${card.id}`,
		);
		expect(deleteRes.status).toBe(204);

		// Subsequent GET should return 404
		const getRes = await apiRequest(
			"GET",
			`/api/boards/${board.id}/cards/${card.id}`,
		);
		expect(getRes.status).toBe(404);
	});
});
