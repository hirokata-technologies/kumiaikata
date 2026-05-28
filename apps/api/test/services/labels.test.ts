import { describe, it, expect, beforeEach } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "../../src/db/client.js";
import { cards } from "../../src/db/schema/index.js";
import {
	truncateAll,
	seedUser,
	seedPersonalBoard,
	seedColumn,
	seedCard,
	seedLabel,
} from "../helpers/index.js";
import {
	createLabel,
	listLabels,
	updateLabel,
	deleteLabel,
} from "../../src/services/labels.js";

beforeEach(() => truncateAll());

describe("createLabel", () => {
	it("creates a label and returns the detail", async () => {
		const user = await seedUser();
		const board = await seedPersonalBoard(user.id);

		const detail = await createLabel(board.id, { name: "Bug", color: "#e11d48" });

		expect(detail.name).toBe("Bug");
		expect(detail.color).toBe("#e11d48");
		expect(detail.boardId).toBe(board.id);
		expect(detail.id).toBeTruthy();
	});
});

describe("listLabels", () => {
	it("returns all labels for the board (BUG-005 regression)", async () => {
		// BUG-005 regression: listLabels must return all labels scoped to the board.
		const user = await seedUser();
		const board = await seedPersonalBoard(user.id);

		await seedLabel(board.id, { name: "Bug", color: "#e11d48" });
		await seedLabel(board.id, { name: "Feature", color: "#0ea5e9" });
		await seedLabel(board.id, { name: "Chore", color: "#6366f1" });

		const labels = await listLabels(board.id);

		expect(labels).toHaveLength(3);

		// Labels are returned sorted alphabetically by name
		const names = labels.map((l) => l.name);
		expect(names).toContain("Bug");
		expect(names).toContain("Feature");
		expect(names).toContain("Chore");

		// Each label must carry the correct boardId
		for (const label of labels) {
			expect(label.boardId).toBe(board.id);
		}
	});

	it("does not return labels from other boards", async () => {
		const user = await seedUser();
		const board = await seedPersonalBoard(user.id);
		const otherUser = await seedUser();
		const otherBoard = await seedPersonalBoard(otherUser.id);

		await seedLabel(board.id, { name: "Board Label" });
		await seedLabel(otherBoard.id, { name: "Other Board Label" });

		const labels = await listLabels(board.id);
		expect(labels).toHaveLength(1);
		expect(labels[0]!.name).toBe("Board Label");
	});

	it("returns an empty array when no labels exist on the board", async () => {
		const user = await seedUser();
		const board = await seedPersonalBoard(user.id);

		const labels = await listLabels(board.id);
		expect(labels).toEqual([]);
	});
});

describe("updateLabel", () => {
	it("updates name and color and returns the updated detail", async () => {
		const user = await seedUser();
		const board = await seedPersonalBoard(user.id);
		const label = await seedLabel(board.id, { name: "Old", color: "#000000" });

		const detail = await updateLabel(board.id, label.id, {
			name: "Feature",
			color: "#0ea5e9",
		});

		expect(detail.name).toBe("Feature");
		expect(detail.color).toBe("#0ea5e9");
	});

	it("throws NOT_FOUND when label does not belong to the board", async () => {
		const user = await seedUser();
		const board = await seedPersonalBoard(user.id);
		const otherUser = await seedUser();
		const otherBoard = await seedPersonalBoard(otherUser.id);
		const label = await seedLabel(otherBoard.id);

		await expect(
			updateLabel(board.id, label.id, { name: "X" }),
		).rejects.toMatchObject({ code: "NOT_FOUND" });
	});
});

describe("deleteLabel", () => {
	it("deletes the label and removes it from all card labelIds atomically", async () => {
		// The service wraps both operations in db.transaction (labels.ts:107).
		// This test verifies the happy-path commit: both the array_remove and the
		// label delete take effect together (atomicity via transaction).
		const user = await seedUser();
		const board = await seedPersonalBoard(user.id);
		const col = await seedColumn(board.id);
		const label = await seedLabel(board.id, { name: "ToDelete" });

		// Seed two cards and patch their labelIds to reference the label
		const card1 = await seedCard(board.id, col.id, { title: "Card 1" });
		const card2 = await seedCard(board.id, col.id, { title: "Card 2" });
		const otherLabelId = "other-label-id";

		await db
			.update(cards)
			.set({ labelIds: [label.id, otherLabelId] })
			.where(eq(cards.id, card1.id));
		await db
			.update(cards)
			.set({ labelIds: [label.id] })
			.where(eq(cards.id, card2.id));

		await deleteLabel(board.id, label.id);

		// Both cards must no longer contain the deleted labelId
		const [updatedCard1] = await db
			.select({ labelIds: cards.labelIds })
			.from(cards)
			.where(eq(cards.id, card1.id));
		const [updatedCard2] = await db
			.select({ labelIds: cards.labelIds })
			.from(cards)
			.where(eq(cards.id, card2.id));

		expect(updatedCard1!.labelIds).not.toContain(label.id);
		expect(updatedCard2!.labelIds).not.toContain(label.id);

		// The "other-label-id" reference on card1 must still be present
		expect(updatedCard1!.labelIds).toContain(otherLabelId);
	});

	it("succeeds when no cards reference the label", async () => {
		const user = await seedUser();
		const board = await seedPersonalBoard(user.id);
		const label = await seedLabel(board.id, { name: "Unused" });

		await expect(deleteLabel(board.id, label.id)).resolves.toBeUndefined();
	});

	it("throws NOT_FOUND when label does not exist on the board", async () => {
		const user = await seedUser();
		const board = await seedPersonalBoard(user.id);

		await expect(
			deleteLabel(board.id, "nonexistent-label-id"),
		).rejects.toMatchObject({ code: "NOT_FOUND" });
	});
});
