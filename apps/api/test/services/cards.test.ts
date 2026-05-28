import { describe, it, expect, beforeEach, vi } from "vitest";
import { eq, and } from "drizzle-orm";

// Mock storage before any service imports to avoid disk/S3 I/O in tests.
vi.mock("../../src/storage/index.js", () => ({
	storage: {
		put: vi.fn().mockResolvedValue(undefined),
		get: vi.fn().mockResolvedValue(undefined),
		delete: vi.fn().mockResolvedValue(undefined),
	},
}));

import { db } from "../../src/db/client.js";
import { cards, attachments } from "../../src/db/schema/index.js";
import {
	truncateAll,
	seedUser,
	seedPersonalBoard,
	seedColumn,
	seedCard,
} from "../helpers/index.js";
import {
	createCard,
	getCard,
	updateCard,
	moveCard,
	deleteCard,
	reorderCardsInColumn,
} from "../../src/services/cards.js";
import { newId } from "../../src/db/ids.js";

beforeEach(() => truncateAll());

describe("createCard", () => {
	it("creates a card with empty arrays and returns the summary", async () => {
		const user = await seedUser();
		const board = await seedPersonalBoard(user.id);
		const col = await seedColumn(board.id);

		const summary = await createCard({ boardId: board.id, columnId: col.id, title: "My Task" });

		expect(summary.title).toBe("My Task");
		expect(summary.boardId).toBe(board.id);
		expect(summary.columnId).toBe(col.id);
		expect(summary.labelIds).toEqual([]);
		expect(summary.assigneeIds).toEqual([]);
		expect(summary.attachmentIds).toEqual([]);
		expect(summary.commentsCount).toBe(0);
		expect(summary.checklistsCount).toBe(0);
		expect(summary.position).toBeTruthy();
		expect(summary.createdAt).toBeInstanceOf(Date);
		expect(summary.updatedAt).toBeInstanceOf(Date);
	});

	it("throws NOT_FOUND when column does not belong to the board", async () => {
		const user = await seedUser();
		const board = await seedPersonalBoard(user.id);
		const otherUser = await seedUser();
		const otherBoard = await seedPersonalBoard(otherUser.id);
		const col = await seedColumn(otherBoard.id);

		await expect(
			createCard({ boardId: board.id, columnId: col.id, title: "X" }),
		).rejects.toMatchObject({ code: "NOT_FOUND", message: "Column not found." });
	});
});

describe("getCard", () => {
	it("returns a CardDetail with empty arrays for a fresh card", async () => {
		const user = await seedUser();
		const board = await seedPersonalBoard(user.id);
		const col = await seedColumn(board.id);
		const card = await seedCard(board.id, col.id, { title: "Fresh Card" });

		const detail = await getCard(board.id, card.id);

		expect(detail.id).toBe(card.id);
		expect(detail.title).toBe("Fresh Card");
		expect(detail.description).toBeNull();
		expect(detail.comments).toEqual([]);
		expect(detail.checklists).toEqual([]);
		expect(detail.attachments).toEqual([]);
		expect(detail.labelIds).toEqual([]);
	});

	it("throws NOT_FOUND when cardId does not match boardId", async () => {
		const user = await seedUser();
		const board = await seedPersonalBoard(user.id);
		const otherUser = await seedUser();
		const otherBoard = await seedPersonalBoard(otherUser.id);
		const col = await seedColumn(otherBoard.id);
		const card = await seedCard(otherBoard.id, col.id);

		await expect(getCard(board.id, card.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
	});

	it("cleans up stale attachmentIds and removes them from the card row (BUG-004 regression)", async () => {
		// BUG-004 anchor: getCard must remove stale attachment IDs that no longer
		// exist in the attachments table, and update the DB row accordingly.
		const user = await seedUser();
		const board = await seedPersonalBoard(user.id);
		const col = await seedColumn(board.id);
		const card = await seedCard(board.id, col.id);

		// Manually patch the card row with stale attachment IDs
		const staleId1 = newId();
		const staleId2 = newId();
		await db
			.update(cards)
			.set({ attachmentIds: [staleId1, staleId2] })
			.where(eq(cards.id, card.id));

		// getCard should detect the stale IDs and clean them up
		const detail = await getCard(board.id, card.id);
		expect(detail.attachmentIds).toEqual([]);
		expect(detail.attachments).toEqual([]);

		// Verify the DB row was updated to reflect the cleanup
		const [updatedRow] = await db
			.select({ attachmentIds: cards.attachmentIds })
			.from(cards)
			.where(eq(cards.id, card.id));
		expect(updatedRow!.attachmentIds).toEqual([]);
	});
});

describe("updateCard", () => {
	it("updates the title and returns the summary", async () => {
		const user = await seedUser();
		const board = await seedPersonalBoard(user.id);
		const col = await seedColumn(board.id);
		const card = await seedCard(board.id, col.id);

		const summary = await updateCard(board.id, card.id, { title: "Updated" });
		expect(summary.title).toBe("Updated");
	});

	it("accepts dueDate as an ISO string and returns a Date instance", async () => {
		const user = await seedUser();
		const board = await seedPersonalBoard(user.id);
		const col = await seedColumn(board.id);
		const card = await seedCard(board.id, col.id);

		const isoDate = "2026-12-31T00:00:00.000Z";
		const summary = await updateCard(board.id, card.id, { dueDate: isoDate });

		expect(summary.dueDate).toBeInstanceOf(Date);
		expect(summary.dueDate!.toISOString()).toBe(isoDate);
	});

	it("accepts dueDate: null to clear the due date", async () => {
		const user = await seedUser();
		const board = await seedPersonalBoard(user.id);
		const col = await seedColumn(board.id);
		const card = await seedCard(board.id, col.id);

		// Set a due date first
		await updateCard(board.id, card.id, { dueDate: "2026-12-31T00:00:00.000Z" });
		// Then clear it
		const summary = await updateCard(board.id, card.id, { dueDate: null });
		expect(summary.dueDate).toBeNull();
	});

	it("throws NOT_FOUND when card does not exist", async () => {
		const user = await seedUser();
		const board = await seedPersonalBoard(user.id);

		await expect(
			updateCard(board.id, "nonexistent-card", { title: "X" }),
		).rejects.toMatchObject({ code: "NOT_FOUND" });
	});
});

describe("moveCard", () => {
	it("moves a card to a target column and inserts between existing cards", async () => {
		const user = await seedUser();
		const board = await seedPersonalBoard(user.id);
		const colA = await seedColumn(board.id, { title: "A", position: "a0" });
		const colB = await seedColumn(board.id, { title: "B", position: "a1" });

		// Seed two cards in column B at distinct positions
		const cardB1 = await seedCard(board.id, colB.id, { title: "B1", position: "a0" });
		const cardB2 = await seedCard(board.id, colB.id, { title: "B2", position: "a1" });

		// Seed card in column A to move
		const cardA = await seedCard(board.id, colA.id, { title: "A1", position: "a0" });

		// Move cardA to colB at index 1 (between cardB1 and cardB2)
		const result = await moveCard(board.id, cardA.id, colB.id, 1);

		expect(result.columnId).toBe(colB.id);

		// The moved card's position must be between B1 and B2
		const movedPos = result.position;
		expect(movedPos > cardB1.position).toBe(true);
		expect(movedPos < cardB2.position).toBe(true);
	});

	it("clamps position beyond the target column length to the end", async () => {
		const user = await seedUser();
		const board = await seedPersonalBoard(user.id);
		const colA = await seedColumn(board.id, { title: "A", position: "a0" });
		const colB = await seedColumn(board.id, { title: "B", position: "a1" });

		const cardB1 = await seedCard(board.id, colB.id, { title: "B1", position: "a0" });
		const cardA = await seedCard(board.id, colA.id, { title: "A1", position: "a0" });

		// Request position 999 — should clamp to end of colB (after cardB1)
		const result = await moveCard(board.id, cardA.id, colB.id, 999);

		expect(result.columnId).toBe(colB.id);
		expect(result.position > cardB1.position).toBe(true);
	});
});

describe("deleteCard", () => {
	it("deletes a card and its attachment rows from the database", async () => {
		const user = await seedUser();
		const board = await seedPersonalBoard(user.id);
		const col = await seedColumn(board.id);
		const card = await seedCard(board.id, col.id);

		// Insert an attachment row referencing the card
		const attachmentId = newId();
		const now = new Date();
		await db.insert(attachments).values({
			id: attachmentId,
			cardId: card.id,
			boardId: board.id,
			filename: "file.png",
			mimeType: "image/png",
			sizeBytes: 1024,
			storageKey: `cards/${card.id}/file.png`,
			uploadedBy: user.id,
			createdAt: now,
		});

		// Patch card's attachmentIds to reference the attachment
		await db
			.update(cards)
			.set({ attachmentIds: [attachmentId] })
			.where(eq(cards.id, card.id));

		await deleteCard(board.id, card.id);

		// Card row must be gone
		const [cardRow] = await db.select().from(cards).where(eq(cards.id, card.id));
		expect(cardRow).toBeUndefined();

		// Attachment row must be gone
		const [attachmentRow] = await db
			.select()
			.from(attachments)
			.where(eq(attachments.id, attachmentId));
		expect(attachmentRow).toBeUndefined();
	});

	it("deletes a card with no attachments without error", async () => {
		const user = await seedUser();
		const board = await seedPersonalBoard(user.id);
		const col = await seedColumn(board.id);
		const card = await seedCard(board.id, col.id);

		await expect(deleteCard(board.id, card.id)).resolves.toBeUndefined();

		const [cardRow] = await db.select().from(cards).where(eq(cards.id, card.id));
		expect(cardRow).toBeUndefined();
	});

	it("throws NOT_FOUND when card does not exist", async () => {
		const user = await seedUser();
		const board = await seedPersonalBoard(user.id);

		await expect(deleteCard(board.id, "nonexistent")).rejects.toMatchObject({
			code: "NOT_FOUND",
		});
	});
});

describe("reorderCardsInColumn", () => {
	it("throws VALIDATION_ERROR when orderedIds length does not match column cards", async () => {
		const user = await seedUser();
		const board = await seedPersonalBoard(user.id);
		const col = await seedColumn(board.id);
		const c1 = await seedCard(board.id, col.id, { position: "a0" });
		const c2 = await seedCard(board.id, col.id, { position: "a1" });
		await seedCard(board.id, col.id, { position: "a2" });

		// Only supply 2 of the 3 cards
		await expect(
			reorderCardsInColumn(board.id, col.id, [c1.id, c2.id]),
		).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
	});

	it("reorders cards to the desired order and persists to DB", async () => {
		const user = await seedUser();
		const board = await seedPersonalBoard(user.id);
		const col = await seedColumn(board.id);

		const c1 = await seedCard(board.id, col.id, { title: "Card 1", position: "a0" });
		const c2 = await seedCard(board.id, col.id, { title: "Card 2", position: "a1" });
		const c3 = await seedCard(board.id, col.id, { title: "Card 3", position: "a2" });

		// Reorder to [c3, c1, c2]
		const result = await reorderCardsInColumn(board.id, col.id, [c3.id, c1.id, c2.id]);
		expect(result.orderedIds).toEqual([c3.id, c1.id, c2.id]);

		// Verify DB reflects the new order
		const ordered = await db
			.select({ id: cards.id })
			.from(cards)
			.where(and(eq(cards.columnId, col.id), eq(cards.boardId, board.id)))
			.orderBy(cards.position);

		expect(ordered.map((r) => r.id)).toEqual([c3.id, c1.id, c2.id]);
	});
});
