import { describe, it, expect, beforeEach } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "../db/client.js";
import { cards } from "../db/schema/index.js";
import { mockBetterAuth, setCurrentUser } from "../../test/helpers/mock-session.js";
import { apiRequest } from "../../test/helpers/request.js";
import {
	seedUser,
	seedPersonalBoard,
	seedColumn,
	seedCard,
} from "../../test/helpers/seed.js";
import { newId } from "../db/ids.js";
import type { Checklist } from "../db/schema/cards.js";

mockBetterAuth();

// eslint-disable-next-line import/first
import app from "../app.js";

void app;

beforeEach(() => {
	setCurrentUser(null);
});

// ── POST /api/boards/:boardId/cards/:cardId/checklists ────────────────────────

describe("POST /api/boards/:boardId/cards/:cardId/checklists", () => {
	it("returns 401 when no session", async () => {
		const res = await apiRequest(
			"POST",
			"/api/boards/fakeid/cards/fakecardid/checklists",
			{ body: { title: "My Checklist" } },
		);
		expect(res.status).toBe(401);
		const body = await res.json() as { error: { code: string } };
		expect(body.error.code).toBe("UNAUTHENTICATED");
	});

	it("returns 201 with checklist payload on success", async () => {
		const user = await seedUser();
		const board = await seedPersonalBoard(user.id);
		const col = await seedColumn(board.id);
		const card = await seedCard(board.id, col.id);
		setCurrentUser({ id: user.id, email: user.email });

		const res = await apiRequest(
			"POST",
			`/api/boards/${board.id}/cards/${card.id}/checklists`,
			{ body: { title: "Acceptance Criteria" } },
		);
		expect(res.status).toBe(201);

		const payload = await res.json() as {
			id: string;
			title: string;
			items: unknown[];
		};
		expect(payload.title).toBe("Acceptance Criteria");
		expect(Array.isArray(payload.items)).toBe(true);
		expect(payload.items).toHaveLength(0);
	});

	it("returns 422 when title is empty", async () => {
		const user = await seedUser();
		const board = await seedPersonalBoard(user.id);
		const col = await seedColumn(board.id);
		const card = await seedCard(board.id, col.id);
		setCurrentUser({ id: user.id, email: user.email });

		const res = await apiRequest(
			"POST",
			`/api/boards/${board.id}/cards/${card.id}/checklists`,
			{ body: { title: "" } },
		);
		expect(res.status).toBe(422);
	});

	it("returns 409 when card already has 50 checklists (BUG-009 regression)", async () => {
		const user = await seedUser();
		const board = await seedPersonalBoard(user.id);
		const col = await seedColumn(board.id);
		const card = await seedCard(board.id, col.id);

		// Directly set 50 checklists on the card via Drizzle
		const preloadedChecklists: Checklist[] = Array.from({ length: 50 }, (_, i) => ({
			id: newId(),
			title: `Checklist ${i + 1}`,
			items: [],
		}));

		await db
			.update(cards)
			.set({ checklists: preloadedChecklists })
			.where(eq(cards.id, card.id));

		setCurrentUser({ id: user.id, email: user.email });

		const res = await apiRequest(
			"POST",
			`/api/boards/${board.id}/cards/${card.id}/checklists`,
			{ body: { title: "Overflow Checklist" } },
		);
		expect(res.status).toBe(409);

		const body = await res.json() as { error: { message: string } };
		expect(body.error.message).toBe("Checklist limit reached.");
	});

	it("returns 404 when card does not exist", async () => {
		const user = await seedUser();
		const board = await seedPersonalBoard(user.id);
		setCurrentUser({ id: user.id, email: user.email });

		const fakeCardId = newId();
		const res = await apiRequest(
			"POST",
			`/api/boards/${board.id}/cards/${fakeCardId}/checklists`,
			{ body: { title: "Ghost Checklist" } },
		);
		expect(res.status).toBe(404);
	});

	it("returns 403 when user has no access to the board", async () => {
		const owner = await seedUser();
		const board = await seedPersonalBoard(owner.id);
		const col = await seedColumn(board.id);
		const card = await seedCard(board.id, col.id);

		const stranger = await seedUser();
		setCurrentUser({ id: stranger.id, email: stranger.email });

		const res = await apiRequest(
			"POST",
			`/api/boards/${board.id}/cards/${card.id}/checklists`,
			{ body: { title: "Sneaky Checklist" } },
		);
		expect(res.status).toBe(403);
	});
});

// ── DELETE /api/boards/:boardId/cards/:cardId/checklists/:checklistId ─────────

describe("DELETE /api/boards/:boardId/cards/:cardId/checklists/:checklistId", () => {
	it("returns 401 when no session", async () => {
		const res = await apiRequest(
			"DELETE",
			`/api/boards/fakeid/cards/fakecardid/checklists/${newId()}`,
		);
		expect(res.status).toBe(401);
	});

	it("returns 204 and removes the checklist on success", async () => {
		const user = await seedUser();
		const board = await seedPersonalBoard(user.id);
		const col = await seedColumn(board.id);
		const card = await seedCard(board.id, col.id);
		setCurrentUser({ id: user.id, email: user.email });

		// Create a checklist first
		const createRes = await apiRequest(
			"POST",
			`/api/boards/${board.id}/cards/${card.id}/checklists`,
			{ body: { title: "To Delete" } },
		);
		expect(createRes.status).toBe(201);
		const { id: checklistId } = await createRes.json() as { id: string };

		// Now delete it
		const deleteRes = await apiRequest(
			"DELETE",
			`/api/boards/${board.id}/cards/${card.id}/checklists/${checklistId}`,
		);
		expect(deleteRes.status).toBe(204);

		// Verify it's gone in the DB
		const [row] = await db
			.select({ checklists: cards.checklists })
			.from(cards)
			.where(eq(cards.id, card.id));
		expect(row?.checklists ?? []).toHaveLength(0);
	});

	it("returns 404 when checklist does not exist", async () => {
		const user = await seedUser();
		const board = await seedPersonalBoard(user.id);
		const col = await seedColumn(board.id);
		const card = await seedCard(board.id, col.id);
		setCurrentUser({ id: user.id, email: user.email });

		const res = await apiRequest(
			"DELETE",
			`/api/boards/${board.id}/cards/${card.id}/checklists/${newId()}`,
		);
		expect(res.status).toBe(404);
		const body = await res.json() as { error: { message: string } };
		expect(body.error.message).toBe("Checklist not found.");
	});

	it("returns 404 when card does not exist", async () => {
		const user = await seedUser();
		const board = await seedPersonalBoard(user.id);
		setCurrentUser({ id: user.id, email: user.email });

		const res = await apiRequest(
			"DELETE",
			`/api/boards/${board.id}/cards/${newId()}/checklists/${newId()}`,
		);
		expect(res.status).toBe(404);
	});
});

// ── POST /api/boards/:boardId/cards/:cardId/checklists/:checklistId/items ─────

describe("POST /api/boards/:boardId/cards/:cardId/checklists/:checklistId/items", () => {
	it("returns 401 when no session", async () => {
		const res = await apiRequest(
			"POST",
			`/api/boards/fakeid/cards/fakecardid/checklists/${newId()}/items`,
			{ body: { text: "Do something" } },
		);
		expect(res.status).toBe(401);
	});

	it("returns 201 with item payload on success", async () => {
		const user = await seedUser();
		const board = await seedPersonalBoard(user.id);
		const col = await seedColumn(board.id);
		const card = await seedCard(board.id, col.id);
		setCurrentUser({ id: user.id, email: user.email });

		// Create checklist
		const clRes = await apiRequest(
			"POST",
			`/api/boards/${board.id}/cards/${card.id}/checklists`,
			{ body: { title: "Steps" } },
		);
		const { id: checklistId } = await clRes.json() as { id: string };

		// Add item
		const itemRes = await apiRequest(
			"POST",
			`/api/boards/${board.id}/cards/${card.id}/checklists/${checklistId}/items`,
			{ body: { text: "Step one" } },
		);
		expect(itemRes.status).toBe(201);
		const item = await itemRes.json() as { id: string; text: string; checked: boolean };
		expect(item.text).toBe("Step one");
		expect(item.checked).toBe(false);
		expect(typeof item.id).toBe("string");
	});

	it("returns 422 when text is empty", async () => {
		const user = await seedUser();
		const board = await seedPersonalBoard(user.id);
		const col = await seedColumn(board.id);
		const card = await seedCard(board.id, col.id);
		setCurrentUser({ id: user.id, email: user.email });

		const clRes = await apiRequest(
			"POST",
			`/api/boards/${board.id}/cards/${card.id}/checklists`,
			{ body: { title: "Steps" } },
		);
		const { id: checklistId } = await clRes.json() as { id: string };

		const itemRes = await apiRequest(
			"POST",
			`/api/boards/${board.id}/cards/${card.id}/checklists/${checklistId}/items`,
			{ body: { text: "" } },
		);
		expect(itemRes.status).toBe(422);
	});

	it("returns 404 when checklist does not exist", async () => {
		const user = await seedUser();
		const board = await seedPersonalBoard(user.id);
		const col = await seedColumn(board.id);
		const card = await seedCard(board.id, col.id);
		setCurrentUser({ id: user.id, email: user.email });

		const res = await apiRequest(
			"POST",
			`/api/boards/${board.id}/cards/${card.id}/checklists/${newId()}/items`,
			{ body: { text: "Orphan item" } },
		);
		expect(res.status).toBe(404);
	});

	it("returns 404 when card does not exist", async () => {
		const user = await seedUser();
		const board = await seedPersonalBoard(user.id);
		setCurrentUser({ id: user.id, email: user.email });

		const res = await apiRequest(
			"POST",
			`/api/boards/${board.id}/cards/${newId()}/checklists/${newId()}/items`,
			{ body: { text: "Orphan item" } },
		);
		expect(res.status).toBe(404);
	});
});

// ── PATCH /api/boards/:boardId/cards/:cardId/checklists/:checklistId/items/:itemId ──

describe("PATCH /api/boards/:boardId/cards/:cardId/checklists/:checklistId/items/:itemId", () => {
	it("returns 401 when no session", async () => {
		const res = await apiRequest(
			"PATCH",
			`/api/boards/fakeid/cards/fakecardid/checklists/${newId()}/items/${newId()}`,
			{ body: { checked: true } },
		);
		expect(res.status).toBe(401);
	});

	it("returns 200 and updates item text and checked status", async () => {
		const user = await seedUser();
		const board = await seedPersonalBoard(user.id);
		const col = await seedColumn(board.id);
		const card = await seedCard(board.id, col.id);
		setCurrentUser({ id: user.id, email: user.email });

		// Create checklist and item
		const clRes = await apiRequest(
			"POST",
			`/api/boards/${board.id}/cards/${card.id}/checklists`,
			{ body: { title: "Tasks" } },
		);
		const { id: checklistId } = await clRes.json() as { id: string };

		const itemRes = await apiRequest(
			"POST",
			`/api/boards/${board.id}/cards/${card.id}/checklists/${checklistId}/items`,
			{ body: { text: "Original text" } },
		);
		const { id: itemId } = await itemRes.json() as { id: string };

		// Patch the item
		const patchRes = await apiRequest(
			"PATCH",
			`/api/boards/${board.id}/cards/${card.id}/checklists/${checklistId}/items/${itemId}`,
			{ body: { text: "Updated text", checked: true } },
		);
		expect(patchRes.status).toBe(200);
		const updated = await patchRes.json() as { id: string; text: string; checked: boolean };
		expect(updated.text).toBe("Updated text");
		expect(updated.checked).toBe(true);
	});

	it("returns 200 and updates only checked without changing text", async () => {
		const user = await seedUser();
		const board = await seedPersonalBoard(user.id);
		const col = await seedColumn(board.id);
		const card = await seedCard(board.id, col.id);
		setCurrentUser({ id: user.id, email: user.email });

		const clRes = await apiRequest(
			"POST",
			`/api/boards/${board.id}/cards/${card.id}/checklists`,
			{ body: { title: "Tasks" } },
		);
		const { id: checklistId } = await clRes.json() as { id: string };

		const itemRes = await apiRequest(
			"POST",
			`/api/boards/${board.id}/cards/${card.id}/checklists/${checklistId}/items`,
			{ body: { text: "Keep this text" } },
		);
		const { id: itemId } = await itemRes.json() as { id: string };

		const patchRes = await apiRequest(
			"PATCH",
			`/api/boards/${board.id}/cards/${card.id}/checklists/${checklistId}/items/${itemId}`,
			{ body: { checked: true } },
		);
		expect(patchRes.status).toBe(200);
		const updated = await patchRes.json() as { id: string; text: string; checked: boolean };
		expect(updated.text).toBe("Keep this text");
		expect(updated.checked).toBe(true);
	});

	it("returns 404 when item does not exist", async () => {
		const user = await seedUser();
		const board = await seedPersonalBoard(user.id);
		const col = await seedColumn(board.id);
		const card = await seedCard(board.id, col.id);
		setCurrentUser({ id: user.id, email: user.email });

		const clRes = await apiRequest(
			"POST",
			`/api/boards/${board.id}/cards/${card.id}/checklists`,
			{ body: { title: "Tasks" } },
		);
		const { id: checklistId } = await clRes.json() as { id: string };

		const res = await apiRequest(
			"PATCH",
			`/api/boards/${board.id}/cards/${card.id}/checklists/${checklistId}/items/${newId()}`,
			{ body: { checked: true } },
		);
		expect(res.status).toBe(404);
		const body = await res.json() as { error: { message: string } };
		expect(body.error.message).toBe("Checklist item not found.");
	});

	it("returns 404 when checklist does not exist", async () => {
		const user = await seedUser();
		const board = await seedPersonalBoard(user.id);
		const col = await seedColumn(board.id);
		const card = await seedCard(board.id, col.id);
		setCurrentUser({ id: user.id, email: user.email });

		const res = await apiRequest(
			"PATCH",
			`/api/boards/${board.id}/cards/${card.id}/checklists/${newId()}/items/${newId()}`,
			{ body: { checked: true } },
		);
		expect(res.status).toBe(404);
		const body = await res.json() as { error: { message: string } };
		expect(body.error.message).toBe("Checklist not found.");
	});

	it("returns 404 when card does not exist", async () => {
		const user = await seedUser();
		const board = await seedPersonalBoard(user.id);
		setCurrentUser({ id: user.id, email: user.email });

		const res = await apiRequest(
			"PATCH",
			`/api/boards/${board.id}/cards/${newId()}/checklists/${newId()}/items/${newId()}`,
			{ body: { checked: true } },
		);
		expect(res.status).toBe(404);
	});
});

// ── DELETE /api/boards/:boardId/cards/:cardId/checklists/:checklistId/items/:itemId ──

describe("DELETE /api/boards/:boardId/cards/:cardId/checklists/:checklistId/items/:itemId", () => {
	it("returns 401 when no session", async () => {
		const res = await apiRequest(
			"DELETE",
			`/api/boards/fakeid/cards/fakecardid/checklists/${newId()}/items/${newId()}`,
		);
		expect(res.status).toBe(401);
	});

	it("returns 204 and removes the item on success", async () => {
		const user = await seedUser();
		const board = await seedPersonalBoard(user.id);
		const col = await seedColumn(board.id);
		const card = await seedCard(board.id, col.id);
		setCurrentUser({ id: user.id, email: user.email });

		// Create checklist and item
		const clRes = await apiRequest(
			"POST",
			`/api/boards/${board.id}/cards/${card.id}/checklists`,
			{ body: { title: "Checklist" } },
		);
		const { id: checklistId } = await clRes.json() as { id: string };

		const itemRes = await apiRequest(
			"POST",
			`/api/boards/${board.id}/cards/${card.id}/checklists/${checklistId}/items`,
			{ body: { text: "Delete me" } },
		);
		const { id: itemId } = await itemRes.json() as { id: string };

		// Delete the item
		const deleteRes = await apiRequest(
			"DELETE",
			`/api/boards/${board.id}/cards/${card.id}/checklists/${checklistId}/items/${itemId}`,
		);
		expect(deleteRes.status).toBe(204);

		// Verify item is gone
		const [row] = await db
			.select({ checklists: cards.checklists })
			.from(cards)
			.where(eq(cards.id, card.id));
		const cl = (row?.checklists ?? []).find((c) => c.id === checklistId);
		expect(cl?.items ?? []).toHaveLength(0);
	});

	it("returns 404 when item does not exist", async () => {
		const user = await seedUser();
		const board = await seedPersonalBoard(user.id);
		const col = await seedColumn(board.id);
		const card = await seedCard(board.id, col.id);
		setCurrentUser({ id: user.id, email: user.email });

		const clRes = await apiRequest(
			"POST",
			`/api/boards/${board.id}/cards/${card.id}/checklists`,
			{ body: { title: "Checklist" } },
		);
		const { id: checklistId } = await clRes.json() as { id: string };

		const res = await apiRequest(
			"DELETE",
			`/api/boards/${board.id}/cards/${card.id}/checklists/${checklistId}/items/${newId()}`,
		);
		expect(res.status).toBe(404);
		const body = await res.json() as { error: { message: string } };
		expect(body.error.message).toBe("Checklist item not found.");
	});

	it("returns 404 when checklist does not exist", async () => {
		const user = await seedUser();
		const board = await seedPersonalBoard(user.id);
		const col = await seedColumn(board.id);
		const card = await seedCard(board.id, col.id);
		setCurrentUser({ id: user.id, email: user.email });

		const res = await apiRequest(
			"DELETE",
			`/api/boards/${board.id}/cards/${card.id}/checklists/${newId()}/items/${newId()}`,
		);
		expect(res.status).toBe(404);
		const body = await res.json() as { error: { message: string } };
		expect(body.error.message).toBe("Checklist not found.");
	});

	it("returns 404 when card does not exist", async () => {
		const user = await seedUser();
		const board = await seedPersonalBoard(user.id);
		setCurrentUser({ id: user.id, email: user.email });

		const res = await apiRequest(
			"DELETE",
			`/api/boards/${board.id}/cards/${newId()}/checklists/${newId()}/items/${newId()}`,
		);
		expect(res.status).toBe(404);
	});
});
