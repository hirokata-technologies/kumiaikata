import { describe, it, expect } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "../../src/db/client.js";
import { columns } from "../../src/db/schema/index.js";
import {
	seedUser,
	seedPersonalBoard,
	seedColumn,
	seedCard,
} from "../helpers/index.js";
import {
	createColumn,
	renameColumn,
	deleteColumn,
	reorderColumns,
} from "../../src/services/columns.js";

describe("createColumn", () => {
	it("creates a column and returns the summary", async () => {
		const user = await seedUser();
		const board = await seedPersonalBoard(user.id);

		const summary = await createColumn(board.id, "To Do");

		expect(summary.title).toBe("To Do");
		expect(summary.boardId).toBe(board.id);
		expect(summary.position).toBeTruthy();
		expect(summary.id).toBeTruthy();
		expect(summary.createdAt).toBeInstanceOf(Date);
		expect(summary.updatedAt).toBeInstanceOf(Date);

		// Confirm DB row exists
		const [row] = await db.select().from(columns).where(eq(columns.id, summary.id));
		expect(row).toBeDefined();
		expect(row!.title).toBe("To Do");
	});

	it("appends after the last column when multiple columns exist (BUG-010 regression)", async () => {
		const user = await seedUser();
		const board = await seedPersonalBoard(user.id);

		const first = await createColumn(board.id, "First");
		const second = await createColumn(board.id, "Second");
		const third = await createColumn(board.id, "Third");

		// Positions must sort ascending in insertion order (BUG-010 anchor:
		// createColumn uses desc(columns.position) to find the last position,
		// then appendAfter — which must return a key strictly after the last one)
		expect(first.position < second.position).toBe(true);
		expect(second.position < third.position).toBe(true);
	});
});

describe("renameColumn", () => {
	it("renames a column and updates updatedAt", async () => {
		const user = await seedUser();
		const board = await seedPersonalBoard(user.id);
		const col = await seedColumn(board.id, { title: "Old Title" });

		const beforeRename = Date.now();
		const summary = await renameColumn(board.id, col.id, "In Progress");

		expect(summary.title).toBe("In Progress");
		expect(summary.updatedAt).toBeInstanceOf(Date);
		// updatedAt is written by Drizzle as UTC ISO (toISOString), so it correctly
		// reflects wall-clock time. Avoid comparing against createdAt which is written
		// by the raw-pg seed helper and suffers a local-time / UTC mismatch on non-UTC hosts.
		expect(summary.updatedAt.getTime()).toBeGreaterThanOrEqual(beforeRename - 1_000);
		expect(summary.updatedAt.getTime()).toBeLessThanOrEqual(Date.now() + 1_000);
	});

	it("throws NOT_FOUND when columnId does not belong to the board", async () => {
		const user = await seedUser();
		const board = await seedPersonalBoard(user.id);
		const otherUser = await seedUser();
		const otherBoard = await seedPersonalBoard(otherUser.id);
		const col = await seedColumn(otherBoard.id, { title: "Column" });

		await expect(renameColumn(board.id, col.id, "X")).rejects.toMatchObject({
			code: "NOT_FOUND",
		});
	});
});

describe("deleteColumn", () => {
	it("deletes an empty column without error", async () => {
		const user = await seedUser();
		const board = await seedPersonalBoard(user.id);
		const col = await seedColumn(board.id);

		await expect(deleteColumn(board.id, col.id)).resolves.toBeUndefined();

		const [row] = await db.select().from(columns).where(eq(columns.id, col.id));
		expect(row).toBeUndefined();
	});

	it("throws CONFLICT when column has cards", async () => {
		const user = await seedUser();
		const board = await seedPersonalBoard(user.id);
		const col = await seedColumn(board.id);
		await seedCard(board.id, col.id);

		await expect(deleteColumn(board.id, col.id)).rejects.toMatchObject({
			code: "CONFLICT",
			message: "Column must be empty before deletion.",
		});
	});

	it("throws NOT_FOUND when column does not exist", async () => {
		const user = await seedUser();
		const board = await seedPersonalBoard(user.id);

		await expect(deleteColumn(board.id, "nonexistent-col-id")).rejects.toMatchObject({
			code: "NOT_FOUND",
		});
	});
});

describe("reorderColumns", () => {
	it("reorders columns to the desired order (BUG-010 regression)", async () => {
		// BUG-010: reorderColumns must use asc(columns.position) when fetching
		// current columns so that reorderToMatch computes correct new positions.
		// This test confirms that after reorder, a SELECT ... ORDER BY position ASC
		// returns columns in the desired order [C, A, B].
		const user = await seedUser();
		const board = await seedPersonalBoard(user.id);

		const colA = await createColumn(board.id, "A");
		const colB = await createColumn(board.id, "B");
		const colC = await createColumn(board.id, "C");

		// Reorder to [C, A, B]
		const result = await reorderColumns(board.id, [colC.id, colA.id, colB.id]);
		expect(result.orderedIds).toEqual([colC.id, colA.id, colB.id]);

		// Verify the DB reflects the new order by selecting ORDER BY position ASC
		const ordered = await db
			.select({ id: columns.id })
			.from(columns)
			.where(eq(columns.boardId, board.id))
			.orderBy(columns.position);

		const ids = ordered.map((r) => r.id);
		expect(ids).toEqual([colC.id, colA.id, colB.id]);
	});

	it("throws VALIDATION_ERROR when desiredIds length does not match column count", async () => {
		const user = await seedUser();
		const board = await seedPersonalBoard(user.id);
		await createColumn(board.id, "A");
		await createColumn(board.id, "B");
		await createColumn(board.id, "C");

		// Supply only 2 IDs instead of 3
		await expect(
			reorderColumns(board.id, ["some-id", "another-id"]),
		).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
	});

	it("throws VALIDATION_ERROR when a desiredId is not on the board", async () => {
		const user = await seedUser();
		const board = await seedPersonalBoard(user.id);
		const colA = await createColumn(board.id, "A");
		await createColumn(board.id, "B");

		// Pass a random ID that doesn't exist on this board (count matches at 2)
		await expect(
			reorderColumns(board.id, [colA.id, "nonexistent-column-id"]),
		).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
	});
});

describe("listColumns (via createColumn position ordering)", () => {
	it("returns columns in ascending position order after multiple creates", async () => {
		const user = await seedUser();
		const board = await seedPersonalBoard(user.id);

		const c1 = await createColumn(board.id, "Col 1");
		const c2 = await createColumn(board.id, "Col 2");
		const c3 = await createColumn(board.id, "Col 3");

		const rows = await db
			.select({ id: columns.id, position: columns.position })
			.from(columns)
			.where(eq(columns.boardId, board.id))
			.orderBy(columns.position);

		expect(rows.map((r) => r.id)).toEqual([c1.id, c2.id, c3.id]);
	});
});
