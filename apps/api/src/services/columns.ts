import { ObjectId } from "mongodb";
import {
	columns as columnsColl,
	cards as cardsColl,
} from "../db/schemas/index.js";
import { AppError } from "../http/error.js";
import { appendAfter, reorderToMatch } from "../ordering/fractional.js";
import { eventBus } from "../events/bus.js";

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
	_id: unknown;
	boardId: unknown;
	title: string;
	position: string;
	createdAt?: Date;
	updatedAt?: Date;
}): ColumnSummary {
	return {
		id: String(col._id),
		boardId: String(col.boardId),
		title: col.title,
		position: col.position,
		createdAt: col.createdAt ?? new Date(),
		updatedAt: col.updatedAt ?? new Date(),
	};
}

// ── createColumn ──────────────────────────────────────────────────────────────

export async function createColumn(
	boardId: ObjectId,
	title: string,
): Promise<ColumnSummary> {
	const lastColumn = await columnsColl()
		.find({ boardId })
		.sort({ position: -1 })
		.limit(1)
		.next();
	const position = appendAfter(lastColumn?.position ?? null);

	const now = new Date();
	const insert = await columnsColl().insertOne({
		boardId,
		title,
		position,
		createdAt: now,
		updatedAt: now,
	} as any);
	const doc = await columnsColl().findOne({ _id: insert.insertedId });
	if (!doc) throw new AppError("INTERNAL_ERROR", "Column was created but could not be fetched.");
	const summary = toSummary(doc);

	eventBus.emit({
		type: "column.created",
		boardId: String(boardId),
		payload: summary,
	});

	return summary;
}

// ── renameColumn ──────────────────────────────────────────────────────────────

export async function renameColumn(
	boardId: ObjectId,
	columnId: string,
	title: string,
): Promise<ColumnSummary> {
	const col = await columnsColl().findOneAndUpdate(
		{ _id: new ObjectId(columnId), boardId },
		{ $set: { title, updatedAt: new Date() } },
		{ returnDocument: "after" },
	);

	if (!col) {
		throw new AppError("NOT_FOUND", "Column not found.");
	}

	const summary = toSummary(col);

	eventBus.emit({
		type: "column.updated",
		boardId: String(boardId),
		payload: summary,
	});

	return summary;
}

// ── deleteColumn ──────────────────────────────────────────────────────────────

export async function deleteColumn(
	boardId: ObjectId,
	columnId: string,
): Promise<void> {
	const columnObjId = new ObjectId(columnId);
	const cardCount = await cardsColl().countDocuments({
		columnId: columnObjId,
	});
	if (cardCount > 0) {
		throw new AppError(
			"CONFLICT",
			"Column must be empty before deletion.",
		);
	}

	const result = await columnsColl().deleteOne({
		_id: columnObjId,
		boardId,
	});
	if (result.deletedCount === 0) {
		throw new AppError("NOT_FOUND", "Column not found.");
	}

	eventBus.emit({
		type: "column.deleted",
		boardId: String(boardId),
		payload: { id: columnId },
	});
}

// ── reorderColumns ────────────────────────────────────────────────────────────

export async function reorderColumns(
	boardId: ObjectId,
	desiredIds: string[],
): Promise<{ orderedIds: string[] }> {
	const currentColumns = await columnsColl()
		.find({ boardId })
		.sort({ position: 1 })
		.toArray();

	if (currentColumns.length !== desiredIds.length) {
		throw new AppError(
			"VALIDATION_ERROR",
			`orderedIds must include every column on the board (got ${desiredIds.length}, expected ${currentColumns.length})`,
		);
	}

	const currentIds = new Set(currentColumns.map((c) => String(c._id)));
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
			_id: String(c._id),
			position: c.position,
		})),
		desiredIds,
	);

	if (updates.length > 0) {
		await columnsColl().bulkWrite(
			updates.map((u) => ({
				updateOne: {
					filter: { _id: new ObjectId(u.id) },
					update: { $set: { position: u.position } },
				},
			})),
		);
	}

	eventBus.emit({
		type: "columns.reordered",
		boardId: String(boardId),
		payload: { orderedIds: desiredIds },
	});

	return { orderedIds: desiredIds };
}
