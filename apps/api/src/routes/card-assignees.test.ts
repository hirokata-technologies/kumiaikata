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

// eslint-disable-next-line import/first
import app from "../app.js";

void app;

beforeEach(() => {
	setCurrentUser(null);
});

// ── POST /api/boards/:boardId/cards/:cardId/assignees ─────────────────────────

describe("POST /api/boards/:boardId/cards/:cardId/assignees", () => {
	it("returns 401 when no session", async () => {
		const res = await apiRequest(
			"POST",
			"/api/boards/fakeid/cards/fakecardid/assignees",
			{ body: { userId: "fakeuserid" } },
		);
		expect(res.status).toBe(401);
		const body = await res.json() as { error: { code: string } };
		expect(body.error.code).toBe("UNAUTHENTICATED");
	});

	it("returns 200 when assigning the owner to a personal board card", async () => {
		const user = await seedUser();
		const board = await seedPersonalBoard(user.id);
		const col = await seedColumn(board.id);
		const card = await seedCard(board.id, col.id);
		setCurrentUser({ id: user.id, email: user.email });

		const res = await apiRequest(
			"POST",
			`/api/boards/${board.id}/cards/${card.id}/assignees`,
			{ body: { userId: user.id } },
		);
		expect(res.status).toBe(200);

		const body = await res.json() as { cardId: string; userId: string };
		expect(body.cardId).toBe(card.id);
		expect(body.userId).toBe(user.id);
	});

	it("returns 422 when assigning a different user to a personal board card", async () => {
		const owner = await seedUser();
		const other = await seedUser();
		const board = await seedPersonalBoard(owner.id);
		const col = await seedColumn(board.id);
		const card = await seedCard(board.id, col.id);
		setCurrentUser({ id: owner.id, email: owner.email });

		const res = await apiRequest(
			"POST",
			`/api/boards/${board.id}/cards/${card.id}/assignees`,
			{ body: { userId: other.id } },
		);
		expect(res.status).toBe(422);

		const body = await res.json() as { error: { message: string } };
		expect(body.error.message).toBe("Only the board owner may be assigned on a personal board.");
	});
});

// ── DELETE /api/boards/:boardId/cards/:cardId/assignees/:userId ───────────────

describe("DELETE /api/boards/:boardId/cards/:cardId/assignees/:userId", () => {
	it("returns 204 when assignee is removed", async () => {
		const user = await seedUser();
		const board = await seedPersonalBoard(user.id);
		const col = await seedColumn(board.id);
		const card = await seedCard(board.id, col.id);
		setCurrentUser({ id: user.id, email: user.email });

		// Assign first
		await apiRequest(
			"POST",
			`/api/boards/${board.id}/cards/${card.id}/assignees`,
			{ body: { userId: user.id } },
		);

		// Remove assignee
		const res = await apiRequest(
			"DELETE",
			`/api/boards/${board.id}/cards/${card.id}/assignees/${user.id}`,
		);
		expect(res.status).toBe(204);
	});
});
