import { ObjectId } from "mongodb";
import {
	cards as cardsColl,
	columns as columnsColl,
	attachments as attachmentsColl,
} from "../db/schemas/index.js";
import { withTransaction } from "../db/connection.js";
import { AppError } from "../http/error.js";
import {
	appendAfter,
	insertBetween,
	reorderToMatch,
} from "../ordering/fractional.js";
import { eventBus } from "../events/bus.js";
import { storage } from "../storage/index.js";

// ── Serialisation shapes ──────────────────────────────────────────────────────

export interface CardSummary {
	id: string;
	boardId: string;
	columnId: string;
	title: string;
	position: string;
	dueDate: Date | null;
	labelIds: string[];
	assigneeIds: string[];
	attachmentIds: string[];
	commentsCount: number;
	checklistsCount: number;
	createdAt: Date;
	updatedAt: Date;
}

export interface AttachmentMeta {
	id: string;
	filename: string;
	mimeType: string;
	sizeBytes: number;
	storageKey: string;
	uploadedBy: string;
	createdAt: Date;
}

export interface CommentDetail {
	id: string;
	authorId: string;
	body: string;
	createdAt: Date;
	updatedAt?: Date;
}

export interface ChecklistItemDetail {
	id: string;
	text: string;
	checked: boolean;
}

export interface ChecklistDetail {
	id: string;
	title: string;
	items: ChecklistItemDetail[];
}

export interface CardDetail extends CardSummary {
	description: string | null;
	comments: CommentDetail[];
	checklists: ChecklistDetail[];
	attachments: AttachmentMeta[];
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function toSummary(card: {
	_id: unknown;
	boardId: unknown;
	columnId: unknown;
	title: string;
	position: string;
	dueDate?: Date | null | undefined;
	labelIds?: unknown[];
	assigneeIds?: unknown[];
	attachmentIds?: unknown[];
	comments?: unknown[];
	checklists?: unknown[];
	createdAt?: Date;
	updatedAt?: Date;
}): CardSummary {
	return {
		id: String(card._id),
		boardId: String(card.boardId),
		columnId: String(card.columnId),
		title: card.title,
		position: card.position,
		dueDate: card.dueDate ?? null,
		labelIds: (card.labelIds ?? []).map(String),
		assigneeIds: (card.assigneeIds ?? []).map(String),
		attachmentIds: (card.attachmentIds ?? []).map(String),
		commentsCount: (card.comments ?? []).length,
		checklistsCount: (card.checklists ?? []).length,
		createdAt: card.createdAt ?? new Date(),
		updatedAt: card.updatedAt ?? new Date(),
	};
}

// ── createCard ────────────────────────────────────────────────────────────────

export async function createCard({
	boardId,
	columnId,
	title,
}: {
	boardId: ObjectId;
	columnId: string;
	title: string;
}): Promise<CardSummary> {
	// Verify the column exists and belongs to the board.
	const column = await columnsColl().findOne({
		_id: new ObjectId(columnId),
		boardId,
	});
	if (!column) {
		throw new AppError("NOT_FOUND", "Column not found.");
	}

	// Find the last card in the column to compute the new position.
	const lastCard = await cardsColl()
		.find({ columnId: column._id })
		.sort({ position: -1 })
		.limit(1)
		.next();
	const position = appendAfter(lastCard?.position ?? null);

	const now = new Date();
	const insert = await cardsColl().insertOne({
		_id: new ObjectId(),
		boardId,
		columnId: column._id,
		title,
		position,
		description: null,
		dueDate: null,
		labelIds: [],
		assigneeIds: [],
		attachmentIds: [],
		comments: [],
		checklists: [],
		createdAt: now,
		updatedAt: now,
	});

	const card = await cardsColl().findOne({ _id: insert.insertedId });
	if (!card) throw new AppError("INTERNAL_ERROR", "Card was created but could not be fetched.");
	const summary = toSummary(card);

	eventBus.emit({
		type: "card.created",
		boardId: String(boardId),
		payload: summary,
	});

	return summary;
}

// ── getCard ───────────────────────────────────────────────────────────────────

export async function getCard(
	boardId: ObjectId,
	cardId: string,
): Promise<CardDetail> {
	const cardObjId = new ObjectId(cardId);
	const card = await cardsColl().findOne({ _id: cardObjId, boardId });
	if (!card) {
		throw new AppError("NOT_FOUND", "Card not found.");
	}

	const attachments =
		card.attachmentIds && card.attachmentIds.length > 0
			? await attachmentsColl()
					.find({ _id: { $in: card.attachmentIds } })
					.toArray()
			: [];

	// Detect stale attachment IDs (attachment deleted out-of-band).
	if (attachments.length < (card.attachmentIds?.length ?? 0)) {
		const resolvedIds = new Set(attachments.map((a) => String(a._id)));
		const missingIds = (card.attachmentIds ?? [])
			.map(String)
			.filter((id) => !resolvedIds.has(id));

		console.warn(
			`[getCard] Card ${cardId} has ${missingIds.length} stale attachmentId(s); removing: ${missingIds.join(", ")}`,
		);

		await cardsColl().updateOne(
			{ _id: cardObjId },
			{
				$pullAll: {
					attachmentIds: missingIds.map((id) => new ObjectId(id)),
				},
			},
		);
	}

	return {
		...toSummary(card),
		description: card.description ?? null,
		comments: (card.comments ?? []).map((c) => ({
			id: String(c._id),
			authorId: String(c.authorId),
			body: c.body,
			createdAt: c.createdAt,
			...(c.updatedAt ? { updatedAt: c.updatedAt } : {}),
		})),
		checklists: (card.checklists ?? []).map((cl) => ({
			id: String(cl._id),
			title: cl.title,
			items: (cl.items ?? []).map((item) => ({
				id: String(item._id),
				text: item.text,
				checked: item.checked,
			})),
		})),
		attachments: attachments.map((a) => ({
			id: String(a._id),
			filename: a.filename,
			mimeType: a.mimeType,
			sizeBytes: a.sizeBytes,
			storageKey: a.storageKey,
			uploadedBy: String(a.uploadedBy),
			createdAt: a.createdAt,
		})),
	};
}

// ── updateCard ────────────────────────────────────────────────────────────────

export interface UpdateCardInput {
	title?: string | undefined;
	description?: string | null | undefined;
	dueDate?: string | null | undefined;
}

export async function updateCard(
	boardId: ObjectId,
	cardId: string,
	input: UpdateCardInput,
): Promise<CardSummary> {
	const patch: Record<string, unknown> = {};

	if (input.title !== undefined) patch.title = input.title;
	if (input.description !== undefined) patch.description = input.description;
	if (input.dueDate !== undefined) {
		// null means clear the due date; a string means set it.
		patch.dueDate = input.dueDate === null ? null : new Date(input.dueDate);
	}

	const card = await cardsColl().findOneAndUpdate(
		{ _id: new ObjectId(cardId), boardId },
		{ $set: patch },
		{ returnDocument: "after" },
	);

	if (!card) {
		throw new AppError("NOT_FOUND", "Card not found.");
	}

	const summary = toSummary(card);

	eventBus.emit({
		type: "card.updated",
		boardId: String(boardId),
		payload: summary,
	});

	return summary;
}

// ── moveCard ──────────────────────────────────────────────────────────────────

export async function moveCard(
	boardId: ObjectId,
	cardId: string,
	targetColumnId: string,
	position: number,
): Promise<CardSummary> {
	// Verify the card exists and belongs to the board.
	const card = await cardsColl().findOne({
		_id: new ObjectId(cardId),
		boardId,
	});
	if (!card) {
		throw new AppError("NOT_FOUND", "Card not found.");
	}

	// Verify the target column belongs to the board.
	const targetColumn = await columnsColl().findOne({
		_id: new ObjectId(targetColumnId),
		boardId,
	});
	if (!targetColumn) {
		throw new AppError("NOT_FOUND", "Target column not found.");
	}

	// Fetch target column's cards sorted by position, excluding the moving card.
	const targetCards = await cardsColl()
		.find({
			columnId: targetColumn._id,
			_id: { $ne: card._id },
		})
		.sort({ position: 1 })
		.toArray();

	// Clamp position to prevent out-of-range errors — appends if beyond length.
	const clampedPosition = Math.min(position, targetCards.length);

	const prev = clampedPosition > 0 ? targetCards[clampedPosition - 1] : null;
	const next =
		clampedPosition < targetCards.length ? targetCards[clampedPosition] : null;
	const newPosition = insertBetween(
		prev?.position ?? null,
		next?.position ?? null,
	);

	const fromColumnId = String(card.columnId);

	const updated = await cardsColl().findOneAndUpdate(
		{ _id: card._id },
		{ $set: { columnId: targetColumn._id, position: newPosition } },
		{ returnDocument: "after" },
	);

	if (!updated) {
		throw new AppError("INTERNAL_ERROR", "Failed to update card.");
	}

	const summary = toSummary(updated);

	eventBus.emit({
		type: "card.moved",
		boardId: String(boardId),
		payload: {
			id: summary.id,
			fromColumnId,
			toColumnId: String(targetColumn._id),
			position: clampedPosition,
		},
	});

	return summary;
}

// ── reorderCardsInColumn ──────────────────────────────────────────────────────

export async function reorderCardsInColumn(
	boardId: ObjectId,
	columnId: string,
	orderedIds: string[],
): Promise<{ orderedIds: string[] }> {
	// Verify the column belongs to the board.
	const column = await columnsColl().findOne({
		_id: new ObjectId(columnId),
		boardId,
	});
	if (!column) {
		throw new AppError("NOT_FOUND", "Column not found.");
	}

	const currentCards = await cardsColl()
		.find({ columnId: column._id })
		.sort({ position: 1 })
		.toArray();

	if (currentCards.length !== orderedIds.length) {
		throw new AppError(
			"VALIDATION_ERROR",
			`orderedIds must include every card in the column (got ${orderedIds.length}, expected ${currentCards.length})`,
		);
	}

	const currentIds = new Set(currentCards.map((c) => String(c._id)));
	for (const id of orderedIds) {
		if (!currentIds.has(id)) {
			throw new AppError(
				"VALIDATION_ERROR",
				`Card ID not found in column: ${id}`,
			);
		}
	}

	const updates = reorderToMatch(
		currentCards.map((c) => ({
			_id: String(c._id),
			position: c.position,
		})),
		orderedIds,
	);

	if (updates.length > 0) {
		await cardsColl().bulkWrite(
			updates.map((u) => ({
				updateOne: {
					filter: { _id: new ObjectId(u.id) },
					update: { $set: { position: u.position } },
				},
			})),
		);
	}

	eventBus.emit({
		type: "cards.reordered",
		boardId: String(boardId),
		payload: { columnId, orderedIds },
	});

	return { orderedIds };
}

// ── deleteCard ────────────────────────────────────────────────────────────────

export async function deleteCard(
	boardId: ObjectId,
	cardId: string,
): Promise<void> {
	const cardObjId = new ObjectId(cardId);

	// Fetch the card scoped to board; 404 if missing.
	const card = await cardsColl().findOne({ _id: cardObjId, boardId });
	if (!card) {
		throw new AppError("NOT_FOUND", "Card not found.");
	}

	const columnId = String(card.columnId);

	// Resolve attachment records so we can delete stored files after the
	// transaction commits (deleting files inside the transaction would risk
	// orphaning data on rollback).
	const attachmentsToDelete =
		card.attachmentIds && card.attachmentIds.length > 0
			? await attachmentsColl()
					.find({ _id: { $in: card.attachmentIds } })
					.toArray()
			: [];

	await withTransaction(async (session) => {
		// Remove attachment DB rows.
		if (attachmentsToDelete.length > 0) {
			await attachmentsColl().deleteMany(
				{ _id: { $in: attachmentsToDelete.map((a) => a._id) } },
				{ session },
			);
		}
		// Delete the card.
		await cardsColl().deleteOne({ _id: cardObjId }, { session });
	});

	// Delete stored files after the transaction has committed.
	for (const a of attachmentsToDelete) {
		try {
			await storage.delete(a.storageKey);
		} catch (err) {
			// Log and continue — DB row is gone, file may linger.
			console.error(
				`[deleteCard] Failed to delete storage file for attachment ${String(a._id)}:`,
				err,
			);
		}
	}

	eventBus.emit({
		type: "card.deleted",
		boardId: String(boardId),
		payload: { id: cardId, columnId },
	});
}
