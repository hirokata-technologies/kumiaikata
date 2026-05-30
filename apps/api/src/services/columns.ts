import { eq, and, asc, desc, count } from "drizzle-orm";
import { db } from "@kata/db";
import { columns, cards } from "@kata/db";
import { newId } from "@kata/db";
import { AppError } from "@kata/http";
import { appendAfter, reorderToMatch } from "../ordering/fractional.js";
import { eventBus } from "@kata/events";

// ── Serialisation shape ───────────────────────────────────────────────────────

export interface ColumnSummary {
	id: string;
	boardId: string;
	title: string;
	position: string;
	createdAt: Date;
	updatedAt: Date;
}

function toSummary(col: {
	id: string;
	boardId: string;
	title: string;
	position: string;
	createdAt: Date;
	updatedAt: Date;
}): ColumnSummary {
	return {
		id: col.id,
		boardId: col.boardId,
		title: col.title,
		position: col.position,
		createdAt: col.createdAt,
		updatedAt: col.updatedAt,
	};
}

// ── createColumn ──────────────────────────────────────────────────────────────

export async function createColumn(
	boardId: string,
	title: string,
): Promise<ColumnSummary> {
	const [lastColumn] = await db.select({ position: columns.position })
		.from(columns)
		.where(eq(columns.boardId, boardId))
		.orderBy(desc(columns.position))
		.limit(1);
	const position = appendAfter(lastColumn?.position ?? null);

	const now = new Date();
	const [col] = await db.insert(columns).values({
		id: newId(),
		boardId,
		title,
		position,
		createdAt: now,
		updatedAt: now,
	}).returning();

	if (!col) throw new AppError("INTERNAL_ERROR", "Column was created but could not be fetched.");
	const summary = toSummary(col);

	eventBus.emit({
		type: "column.created",
		boardId,
		payload: summary,
	});

	return summary;
}

// ── renameColumn ──────────────────────────────────────────────────────────────

export async function renameColumn(
	boardId: string,
	columnId: string,
	title: string,
): Promise<ColumnSummary> {
	const [col] = await db.update(columns)
		.set({ title, updatedAt: new Date() })
		.where(and(eq(columns.id, columnId), eq(columns.boardId, boardId)))
		.returning();

	if (!col) {
		throw new AppError("NOT_FOUND", "Column not found.");
	}

	const summary = toSummary(col);

	eventBus.emit({
		type: "column.updated",
		boardId,
		payload: summary,
	});

	return summary;
}

// ── deleteColumn ──────────────────────────────────────────────────────────────

export async function deleteColumn(
	boardId: string,
	columnId: string,
): Promise<void> {
	const [{ value: cardCount } = { value: 0 }] = await db.select({ value: count() })
		.from(cards)
		.where(eq(cards.columnId, columnId));
	if (cardCount > 0) {
		throw new AppError("CONFLICT", "Column must be empty before deletion.");
	}

	const deleted = await db.delete(columns)
		.where(and(eq(columns.id, columnId), eq(columns.boardId, boardId)))
		.returning({ id: columns.id });
	if (deleted.length === 0) {
		throw new AppError("NOT_FOUND", "Column not found.");
	}

	eventBus.emit({
		type: "column.deleted",
		boardId,
		payload: { id: columnId },
	});
}

// ── reorderColumns ────────────────────────────────────────────────────────────

export async function reorderColumns(
	boardId: string,
	desiredIds: string[],
): Promise<{ orderedIds: string[] }> {
	const currentColumns = await db.select()
		.from(columns)
		.where(eq(columns.boardId, boardId))
		.orderBy(asc(columns.position));

	if (currentColumns.length !== desiredIds.length) {
		throw new AppError(
			"VALIDATION_ERROR",
			`orderedIds must include every column on the board (got ${desiredIds.length}, expected ${currentColumns.length})`,
		);
	}

	const currentIds = new Set(currentColumns.map((c) => c.id));
	for (const id of desiredIds) {
		if (!currentIds.has(id)) {
			throw new AppError(
				"VALIDATION_ERROR",
				`Column ID not found on board: ${id}`,
			);
		}
	}

	const updates = reorderToMatch(
		currentColumns.map((c) => ({
			_id: c.id,
			position: c.position,
		})),
		desiredIds,
	);

	if (updates.length > 0) {
		await db.transaction(async (tx) => {
			for (const u of updates) {
				await tx.update(columns)
					.set({ position: u.position })
					.where(eq(columns.id, u.id));
			}
		});
	}

	eventBus.emit({
		type: "columns.reordered",
		boardId,
		payload: { orderedIds: desiredIds },
	});

	return { orderedIds: desiredIds };
}
