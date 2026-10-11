import { eq, and, desc, asc, inArray, ne } from "drizzle-orm";
import { db } from "@kata/db";
import { cards, columns, attachments } from "@kata/db";
import { newId } from "@kata/db";
import { AppError } from "@kata/http";
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
	projectId: string | null;
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
	id: string;
	boardId: string;
	columnId: string;
	title: string;
	position: string;
	dueDate?: Date | null;
	labelIds?: string[] | null;
	assigneeIds?: string[] | null;
	attachmentIds?: string[] | null;
	comments?: unknown[] | null;
	checklists?: unknown[] | null;
	projectId?: string | null;
	createdAt: Date;
	updatedAt: Date;
}): CardSummary {
	return {
		id: card.id,
		boardId: card.boardId,
		columnId: card.columnId,
		title: card.title,
		position: card.position,
		dueDate: card.dueDate ?? null,
		labelIds: card.labelIds ?? [],
		assigneeIds: card.assigneeIds ?? [],
		attachmentIds: card.attachmentIds ?? [],
		commentsCount: (card.comments ?? []).length,
		checklistsCount: (card.checklists ?? []).length,
		projectId: card.projectId ?? null,
		createdAt: card.createdAt,
		updatedAt: card.updatedAt,
	};
}

// ── createCard ────────────────────────────────────────────────────────────────

export async function createCard({
	boardId,
	columnId,
	title,
}: {
	boardId: string;
	columnId: string;
	title: string;
}): Promise<CardSummary> {
	// Lock the column row for the duration of the position-read + insert so that
	// concurrent createCard calls on the same column serialize here. Without this
	// lock, two concurrent requests both read the same lastCard.position and call
	// appendAfter() with the same argument, producing duplicate fractional keys.
	const [card] = await db.transaction(async (tx) => {
		const [column] = await tx.select()
			.from(columns)
			.where(and(eq(columns.id, columnId), eq(columns.boardId, boardId)))
			.for("update")
			.limit(1);
		if (!column) {
			throw new AppError("NOT_FOUND", "Column not found.");
		}

		const [lastCard] = await tx.select({ position: cards.position })
			.from(cards)
			.where(eq(cards.columnId, column.id))
			.orderBy(desc(cards.position))
			.limit(1);
		const position = appendAfter(lastCard?.position ?? null);

		const now = new Date();
		return tx.insert(cards).values({
			id: newId(),
			boardId,
			columnId: column.id,
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
		}).returning();
	});

	if (!card) throw new AppError("INTERNAL_ERROR", "Card was created but could not be fetched.");
	const summary = toSummary(card);

	eventBus.emit({
		type: "card.created",
		boardId,
		payload: summary,
	});

	return summary;
}

// ── getCard ───────────────────────────────────────────────────────────────────

export async function getCard(
	boardId: string,
	cardId: string,
): Promise<CardDetail> {
	// Run the stale-ID cleanup inside a transaction with a row lock so that
	// concurrent callers serialize on this card and cannot produce a lost update
	// on attachment_ids.
	const card = await db.transaction(async (tx) => {
		const [row] = await tx.select()
			.from(cards)
			.where(and(eq(cards.id, cardId), eq(cards.boardId, boardId)))
			.for("update")
			.limit(1);
		if (!row) {
			throw new AppError("NOT_FOUND", "Card not found.");
		}

		if (row.attachmentIds && row.attachmentIds.length > 0) {
			const attachmentRows = await tx.select({ id: attachments.id })
				.from(attachments)
				.where(inArray(attachments.id, row.attachmentIds));

			if (attachmentRows.length < row.attachmentIds.length) {
				const resolvedIds = new Set(attachmentRows.map((a) => a.id));
				const missingIds = row.attachmentIds.filter((id) => !resolvedIds.has(id));

				console.warn(
					`[getCard] Card ${cardId} has ${missingIds.length} stale attachmentId(s); removing: ${missingIds.join(", ")}`,
				);

				const filteredIds = row.attachmentIds.filter((id) => resolvedIds.has(id));
				const [updated] = await tx.update(cards)
					.set({ attachmentIds: filteredIds })
					.where(eq(cards.id, cardId))
					.returning();
				if (updated) return updated;
			}
		}

		return row;
	});

	// Fetch full attachment metadata outside the transaction — this is a
	// read-only query and does not need to participate in the lock.
	const attachmentRows =
		card.attachmentIds && card.attachmentIds.length > 0
			? await db.select()
					.from(attachments)
					.where(inArray(attachments.id, card.attachmentIds))
			: [];

	return {
		...toSummary(card),
		description: card.description ?? null,
		comments: (card.comments ?? []).map((c) => ({
			id: c.id,
			authorId: c.authorId,
			body: c.body,
			createdAt: new Date(c.createdAt),
			...(c.updatedAt ? { updatedAt: new Date(c.updatedAt) } : {}),
		})),
		checklists: (card.checklists ?? []).map((cl) => ({
			id: cl.id,
			title: cl.title,
			items: (cl.items ?? []).map((item) => ({
				id: item.id,
				text: item.text,
				checked: item.checked,
			})),
		})),
		attachments: attachmentRows.map((a) => ({
			id: a.id,
			filename: a.filename,
			mimeType: a.mimeType,
			sizeBytes: a.sizeBytes,
			storageKey: a.storageKey,
			uploadedBy: a.uploadedBy,
			createdAt: a.createdAt,
		})),
	};
}

// ── updateCard ────────────────────────────────────────────────────────────────

export interface UpdateCardInput {
	title?: string | undefined;
	description?: string | null | undefined;
	dueDate?: string | null | undefined;
	projectId?: string | null | undefined;
}

export async function updateCard(
	boardId: string,
	cardId: string,
	input: UpdateCardInput,
): Promise<CardSummary> {
	const patch: Partial<{
		title: string;
		description: string | null;
		dueDate: Date | null;
		projectId: string | null;
		updatedAt: Date;
	}> = { updatedAt: new Date() };

	if (input.title !== undefined) patch.title = input.title;
	if (input.description !== undefined) patch.description = input.description;
	if (input.dueDate !== undefined) {
		// null means clear the due date; a string means set it.
		patch.dueDate = input.dueDate === null ? null : new Date(input.dueDate);
	}
	if (input.projectId !== undefined) patch.projectId = input.projectId;

	const [card] = await db.update(cards)
		.set(patch)
		.where(and(eq(cards.id, cardId), eq(cards.boardId, boardId)))
		.returning();

	if (!card) {
		throw new AppError("NOT_FOUND", "Card not found.");
	}

	const summary = toSummary(card);

	eventBus.emit({
		type: "card.updated",
		boardId,
		payload: summary,
	});

	return summary;
}

// ── moveCard ──────────────────────────────────────────────────────────────────

export async function moveCard(
	boardId: string,
	cardId: string,
	targetColumnId: string,
	position: number,
): Promise<CardSummary> {
	// Verify the card exists and belongs to the board.
	const [card] = await db.select()
		.from(cards)
		.where(and(eq(cards.id, cardId), eq(cards.boardId, boardId)))
		.limit(1);
	if (!card) {
		throw new AppError("NOT_FOUND", "Card not found.");
	}

	// Verify the target column belongs to the board.
	const [targetColumn] = await db.select()
		.from(columns)
		.where(and(eq(columns.id, targetColumnId), eq(columns.boardId, boardId)))
		.limit(1);
	if (!targetColumn) {
		throw new AppError("NOT_FOUND", "Target column not found.");
	}

	// Fetch target column's cards sorted by position, excluding the moving card.
	const targetCards = await db.select()
		.from(cards)
		.where(and(eq(cards.columnId, targetColumn.id), ne(cards.id, card.id)))
		.orderBy(asc(cards.position));

	// Clamp position to prevent out-of-range errors — appends if beyond length.
	const clampedPosition = Math.min(position, targetCards.length);

	const prev = clampedPosition > 0 ? targetCards[clampedPosition - 1] : null;
	const next = clampedPosition < targetCards.length ? targetCards[clampedPosition] : null;
	const newPosition = insertBetween(
		prev?.position ?? null,
		next?.position ?? null,
	);

	const fromColumnId = card.columnId;

	const [updated] = await db.update(cards)
		.set({ columnId: targetColumn.id, position: newPosition, updatedAt: new Date() })
		.where(eq(cards.id, card.id))
		.returning();

	if (!updated) {
		throw new AppError("INTERNAL_ERROR", "Failed to update card.");
	}

	const summary = toSummary(updated);

	eventBus.emit({
		type: "card.moved",
		boardId,
		payload: {
			id: summary.id,
			fromColumnId,
			toColumnId: targetColumn.id,
			position: clampedPosition,
		},
	});

	return summary;
}

// ── reorderCardsInColumn ──────────────────────────────────────────────────────

export async function reorderCardsInColumn(
	boardId: string,
	columnId: string,
	orderedIds: string[],
): Promise<{ orderedIds: string[] }> {
	// Verify the column belongs to the board.
	const [column] = await db.select()
		.from(columns)
		.where(and(eq(columns.id, columnId), eq(columns.boardId, boardId)))
		.limit(1);
	if (!column) {
		throw new AppError("NOT_FOUND", "Column not found.");
	}

	const currentCards = await db.select()
		.from(cards)
		.where(eq(cards.columnId, column.id))
		.orderBy(asc(cards.position));

	if (currentCards.length !== orderedIds.length) {
		throw new AppError(
			"VALIDATION_ERROR",
			`orderedIds must include every card in the column (got ${orderedIds.length}, expected ${currentCards.length})`,
		);
	}

	const currentIds = new Set(currentCards.map((c) => c.id));
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
			_id: c.id,
			position: c.position,
		})),
		orderedIds,
	);

	if (updates.length > 0) {
		await db.transaction(async (tx) => {
			for (const u of updates) {
				await tx.update(cards)
					.set({ position: u.position })
					.where(eq(cards.id, u.id));
			}
		});
	}

	eventBus.emit({
		type: "cards.reordered",
		boardId,
		payload: { columnId, orderedIds },
	});

	return { orderedIds };
}

// ── deleteCard ────────────────────────────────────────────────────────────────

export async function deleteCard(
	boardId: string,
	cardId: string,
): Promise<void> {
	// Fetch the card scoped to board; 404 if missing.
	const [card] = await db.select()
		.from(cards)
		.where(and(eq(cards.id, cardId), eq(cards.boardId, boardId)))
		.limit(1);
	if (!card) {
		throw new AppError("NOT_FOUND", "Card not found.");
	}

	const columnId = card.columnId;

	// Resolve attachment records so we can delete stored files after the
	// transaction commits (deleting files inside the transaction would risk
	// orphaning data on rollback).
	const attachmentsToDelete =
		card.attachmentIds && card.attachmentIds.length > 0
			? await db.select()
					.from(attachments)
					.where(inArray(attachments.id, card.attachmentIds))
			: [];

	await db.transaction(async (tx) => {
		// Remove attachment DB rows.
		if (attachmentsToDelete.length > 0) {
			await tx.delete(attachments)
				.where(inArray(attachments.id, attachmentsToDelete.map((a) => a.id)));
		}
		// Delete the card.
		await tx.delete(cards).where(eq(cards.id, cardId));
	});

	// Delete stored files after the transaction has committed.
	for (const a of attachmentsToDelete) {
		try {
			await storage.delete(a.storageKey);
		} catch (err) {
			// Log and continue — DB row is gone, file may linger.
			console.error(
				`[deleteCard] Failed to delete storage file for attachment ${a.id}:`,
				err,
			);
		}
	}

	eventBus.emit({
		type: "card.deleted",
		boardId,
		payload: { id: cardId, columnId },
	});
}
