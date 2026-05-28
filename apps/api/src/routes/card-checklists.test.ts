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
});
