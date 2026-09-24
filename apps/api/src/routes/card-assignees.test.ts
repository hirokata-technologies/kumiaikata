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

	it("returns 401 when no session for DELETE", async () => {
		const res = await apiRequest(
			"DELETE",
			"/api/boards/fakeid/cards/fakecardid/assignees/fakeuserid",
		);
		expect(res.status).toBe(401);
	});

	it("returns 404 when card does not exist during DELETE", async () => {
		const user = await seedUser();
		const board = await seedPersonalBoard(user.id);
		setCurrentUser({ id: user.id, email: user.email });

		const res = await apiRequest(
			"DELETE",
			`/api/boards/${board.id}/cards/nonexistentcard/assignees/${user.id}`,
		);
		expect(res.status).toBe(404);
	});
});

// ── DELETE authorization tests ────────────────────────────────────────────────

describe("DELETE /api/boards/:boardId/cards/:cardId/assignees/:userId (authorization)", () => {
	it("returns 204 when any member removes another member as assignee", async () => {
		const admin = await seedUser();
		const member = await seedUser();
		const { board } = await seedTeamWithBoard({
			domain: "auth-del-team1.com",
			members: [
				{ userId: admin.id, role: "admin" },
				{ userId: member.id, role: "member" },
			],
		});
		const col = await seedColumn(board.id);
		const card = await seedCard(board.id, col.id);

		// Assign admin to the card
		setCurrentUser({ id: admin.id, email: admin.email });
		await apiRequest(
			"POST",
			`/api/boards/${board.id}/cards/${card.id}/assignees`,
			{ body: { userId: admin.id } },
		);

		// member removes admin — any board member may now manage assignees
		setCurrentUser({ id: member.id, email: member.email });
		const res = await apiRequest(
			"DELETE",
			`/api/boards/${board.id}/cards/${card.id}/assignees/${admin.id}`,
		);
		expect(res.status).toBe(204);
	});

	it("returns 204 when a team-member removes themselves", async () => {
		const admin = await seedUser();
		const member = await seedUser();
		const { board } = await seedTeamWithBoard({
			domain: "auth-del-team2.com",
			members: [
				{ userId: admin.id, role: "admin" },
				{ userId: member.id, role: "member" },
			],
		});
		const col = await seedColumn(board.id);
		const card = await seedCard(board.id, col.id);

		// Assign member to the card (as admin)
		setCurrentUser({ id: admin.id, email: admin.email });
		await apiRequest(
			"POST",
			`/api/boards/${board.id}/cards/${card.id}/assignees`,
			{ body: { userId: member.id } },
		);

		// member removes themselves
		setCurrentUser({ id: member.id, email: member.email });
		const res = await apiRequest(
			"DELETE",
			`/api/boards/${board.id}/cards/${card.id}/assignees/${member.id}`,
		);
		expect(res.status).toBe(204);
	});

	it("returns 204 when a team-admin removes another member", async () => {
		const admin = await seedUser();
		const member = await seedUser();
		const { board } = await seedTeamWithBoard({
			domain: "auth-del-team3.com",
			members: [
				{ userId: admin.id, role: "admin" },
				{ userId: member.id, role: "member" },
			],
		});
		const col = await seedColumn(board.id);
		const card = await seedCard(board.id, col.id);

		// Assign member to the card
		setCurrentUser({ id: admin.id, email: admin.email });
		await apiRequest(
			"POST",
			`/api/boards/${board.id}/cards/${card.id}/assignees`,
			{ body: { userId: member.id } },
		);

		// admin removes member
		const res = await apiRequest(
			"DELETE",
			`/api/boards/${board.id}/cards/${card.id}/assignees/${member.id}`,
		);
		expect(res.status).toBe(204);
	});
});

// ── Team board assignee tests ──────────────────────────────────────────────────

describe("POST /api/boards/:boardId/cards/:cardId/assignees (team board)", () => {
	it("returns 200 when assigning a team member to a team board card", async () => {
		const admin = await seedUser();
		const member = await seedUser();
		const { board } = await seedTeamWithBoard({
			domain: "assignee-team.com",
			members: [
				{ userId: admin.id, role: "admin" },
				{ userId: member.id, role: "member" },
			],
		});
		const col = await seedColumn(board.id);
		const card = await seedCard(board.id, col.id);
		setCurrentUser({ id: admin.id, email: admin.email });

		const res = await apiRequest(
			"POST",
			`/api/boards/${board.id}/cards/${card.id}/assignees`,
			{ body: { userId: member.id } },
		);
		expect(res.status).toBe(200);
		const body = await res.json() as { cardId: string; userId: string };
		expect(body.userId).toBe(member.id);
	});

	it("returns 422 when assigning a non-member to a team board card", async () => {
		const admin = await seedUser();
		const outsider = await seedUser();
		const { board } = await seedTeamWithBoard({
			domain: "assignee-team2.com",
			members: [{ userId: admin.id, role: "admin" }],
		});
		const col = await seedColumn(board.id);
		const card = await seedCard(board.id, col.id);
		setCurrentUser({ id: admin.id, email: admin.email });

		const res = await apiRequest(
			"POST",
			`/api/boards/${board.id}/cards/${card.id}/assignees`,
			{ body: { userId: outsider.id } },
		);
		expect(res.status).toBe(422);
		const body = await res.json() as { error: { message: string } };
		expect(body.error.message).toBe("User is not a member of this board's team.");
	});
});
