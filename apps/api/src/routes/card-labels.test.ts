import { describe, it, expect, beforeEach } from "vitest";
import { eq, and } from "drizzle-orm";
import { db } from "../db/client.js";
import { cards } from "../db/schema/index.js";
import { mockBetterAuth, setCurrentUser } from "../../test/helpers/mock-session.js";
import { apiRequest } from "../../test/helpers/request.js";
import {
	seedUser,
	seedPersonalBoard,
	seedColumn,
	seedCard,
	seedLabel,
} from "../../test/helpers/seed.js";

mockBetterAuth();

import app from "../app.js";

void app;

beforeEach(() => {
	setCurrentUser(null);
});

// ── POST /api/boards/:boardId/cards/:cardId/labels ────────────────────────────

describe("POST /api/boards/:boardId/cards/:cardId/labels", () => {
	it("returns 401 when no session", async () => {
		const res = await apiRequest(
			"POST",
			"/api/boards/fakeid/cards/fakecardid/labels",
			{ body: { labelId: "fakelabelid" } },
		);
		expect(res.status).toBe(401);
		const body = await res.json() as { error: { code: string } };
		expect(body.error.code).toBe("UNAUTHENTICATED");
	});

	it("returns 200 when label is added to card", async () => {
		const user = await seedUser();
		const board = await seedPersonalBoard(user.id);
		const col = await seedColumn(board.id);
		const card = await seedCard(board.id, col.id);
		const label = await seedLabel(board.id, { name: "Bug", color: "#e11d48" });
		setCurrentUser({ id: user.id, email: user.email });

		const res = await apiRequest(
			"POST",
			`/api/boards/${board.id}/cards/${card.id}/labels`,
			{ body: { labelId: label.id } },
		);
		expect(res.status).toBe(200);

		const body = await res.json() as { cardId: string; labelId: string };
		expect(body.cardId).toBe(card.id);
		expect(body.labelId).toBe(label.id);
	});

	it("is idempotent — adding same label twice leaves exactly one entry in labelIds", async () => {
		const user = await seedUser();
		const board = await seedPersonalBoard(user.id);
		const col = await seedColumn(board.id);
		const card = await seedCard(board.id, col.id);
		const label = await seedLabel(board.id, { name: "Feature", color: "#0ea5e9" });
		setCurrentUser({ id: user.id, email: user.email });

		// Add label first time
		await apiRequest(
			"POST",
			`/api/boards/${board.id}/cards/${card.id}/labels`,
			{ body: { labelId: label.id } },
		);

		// Add label second time (idempotent)
		const res = await apiRequest(
			"POST",
			`/api/boards/${board.id}/cards/${card.id}/labels`,
			{ body: { labelId: label.id } },
		);
		expect(res.status).toBe(200);

		// Verify via DB read that label appears exactly once
		const [row] = await db
			.select({ labelIds: cards.labelIds })
			.from(cards)
			.where(and(eq(cards.id, card.id), eq(cards.boardId, board.id)));
		const occurrences = (row?.labelIds ?? []).filter((id) => id === label.id).length;
		expect(occurrences).toBe(1);
	});

	it("returns 422 when labelId is from a different board", async () => {
		const user = await seedUser();
		const board = await seedPersonalBoard(user.id);
		const col = await seedColumn(board.id);
		const card = await seedCard(board.id, col.id);

		// Create a second board and its label
		const otherUser = await seedUser();
		const otherBoard = await seedPersonalBoard(otherUser.id);
		const otherLabel = await seedLabel(otherBoard.id, { name: "Other", color: "#6366f1" });

		setCurrentUser({ id: user.id, email: user.email });

		const res = await apiRequest(
			"POST",
			`/api/boards/${board.id}/cards/${card.id}/labels`,
			{ body: { labelId: otherLabel.id } },
		);
		expect(res.status).toBe(422);

		const body = await res.json() as { error: { message: string } };
		expect(body.error.message).toBe("Label does not belong to this board.");
	});


	it("returns 404 when card does not exist", async () => {
		const user = await seedUser();
		const board = await seedPersonalBoard(user.id);
		const label = await seedLabel(board.id);
		setCurrentUser({ id: user.id, email: user.email });

		const res = await apiRequest(
			"POST",
			`/api/boards/${board.id}/cards/nonexistentcard/labels`,
			{ body: { labelId: label.id } },
		);
		expect(res.status).toBe(404);
	});
});

// ── DELETE /api/boards/:boardId/cards/:cardId/labels/:labelId ─────────────────

describe("DELETE /api/boards/:boardId/cards/:cardId/labels/:labelId", () => {
	it("returns 204 when label is removed from card", async () => {
		const user = await seedUser();
		const board = await seedPersonalBoard(user.id);
		const col = await seedColumn(board.id);
		const card = await seedCard(board.id, col.id);
		const label = await seedLabel(board.id);
		setCurrentUser({ id: user.id, email: user.email });

		// Add label first
		await apiRequest(
			"POST",
			`/api/boards/${board.id}/cards/${card.id}/labels`,
			{ body: { labelId: label.id } },
		);

		// Remove label
		const res = await apiRequest(
			"DELETE",
			`/api/boards/${board.id}/cards/${card.id}/labels/${label.id}`,
		);
		expect(res.status).toBe(204);

		// Verify label is gone from card
		const [row] = await db
			.select({ labelIds: cards.labelIds })
			.from(cards)
			.where(eq(cards.id, card.id));
		expect(row?.labelIds ?? []).not.toContain(label.id);
	});


	it("returns 404 when card does not exist", async () => {
		const user = await seedUser();
		const board = await seedPersonalBoard(user.id);
		const label = await seedLabel(board.id);
		setCurrentUser({ id: user.id, email: user.email });

		const res = await apiRequest(
			"DELETE",
			`/api/boards/${board.id}/cards/nonexistentcard/labels/${label.id}`,
		);
		expect(res.status).toBe(404);
	});
});

// ── GET /api/boards/:boardId/cards/:cardId/labels ─────────────────────────────

describe("GET /api/boards/:boardId/cards/:cardId/labels — via card detail", () => {
	it("card detail includes labelIds array", async () => {
		const user = await seedUser();
		const board = await seedPersonalBoard(user.id);
		const col = await seedColumn(board.id);
		const card = await seedCard(board.id, col.id);
		const label = await seedLabel(board.id, { name: "Critical" });
		setCurrentUser({ id: user.id, email: user.email });

		await apiRequest(
			"POST",
			`/api/boards/${board.id}/cards/${card.id}/labels`,
			{ body: { labelId: label.id } },
		);

		const res = await apiRequest(
			"GET",
			`/api/boards/${board.id}/cards/${card.id}`,
		);
		expect(res.status).toBe(200);

		const body = await res.json() as { labelIds: string[] };
		expect(body.labelIds).toContain(label.id);
	});
});
