import { eq, and, sql } from "drizzle-orm";
import { db, newId, cards, labels, teamMembers } from "@kata/db";
import type { Checklist, ChecklistItem, Comment } from "@kata/db";
import { AppError } from "@kata/http";
import type { ContextBoard } from "@kata/http";
import { eventBus } from "../events/bus.js";

/**
 * The parts of a card stored inline on its row — labels, assignees, comments and
 * checklists. Shared by the REST routes (routes/card-*.ts) and the MCP board tools
 * (mcp/tools/boards.ts). Callers have already checked board access; every function
 * scopes the card to `board.id` and emits the board's SSE event.
 */

// ── Labels ────────────────────────────────────────────────────────────────────

export async function addCardLabel(
	boardId: string,
	cardId: string,
	labelId: string,
): Promise<{ cardId: string; labelId: string }> {
	// Verify label belongs to this board.
	const [label] = await db
		.select()
		.from(labels)
		.where(and(eq(labels.id, labelId), eq(labels.boardId, boardId)))
		.limit(1);
	if (!label) {
		throw new AppError("VALIDATION_ERROR", "Label does not belong to this board.");
	}

	// Idempotent add: append only if the label isn't already in the array.
	const result = await db
		.update(cards)
		.set({
			labelIds: sql`CASE WHEN ${labelId} = ANY(${cards.labelIds}) THEN ${cards.labelIds} ELSE array_append(${cards.labelIds}, ${labelId}) END`,
		})
		.where(and(eq(cards.id, cardId), eq(cards.boardId, boardId)))
		.returning({ id: cards.id });

	if (result.length === 0) {
		throw new AppError("NOT_FOUND", "Card not found.");
	}

	eventBus.emit({ type: "card.label.added", boardId, payload: { cardId, labelId } });
	return { cardId, labelId };
}

export async function removeCardLabel(boardId: string, cardId: string, labelId: string): Promise<void> {
	const result = await db
		.update(cards)
		.set({ labelIds: sql`array_remove(${cards.labelIds}, ${labelId})` })
		.where(and(eq(cards.id, cardId), eq(cards.boardId, boardId)))
		.returning({ id: cards.id });

	if (result.length === 0) {
		throw new AppError("NOT_FOUND", "Card not found.");
	}

	eventBus.emit({ type: "card.label.removed", boardId, payload: { cardId, labelId } });
}

// ── Assignees ─────────────────────────────────────────────────────────────────

export async function addCardAssignee(
	board: ContextBoard,
	cardId: string,
	userId: string,
): Promise<{ cardId: string; userId: string }> {
	// Validate assignee belongs to the board's team or is the personal board owner.
	if (board.kind === "team") {
		const [isMember] = await db
			.select({ id: teamMembers.id })
			.from(teamMembers)
			.where(and(eq(teamMembers.teamId, board.teamId!), eq(teamMembers.userId, userId)))
			.limit(1);
		if (!isMember) {
			throw new AppError("VALIDATION_ERROR", "User is not a member of this board's team.");
		}
	} else if (board.ownerId !== userId) {
		// Personal board: only the owner may be assigned.
		throw new AppError("VALIDATION_ERROR", "Only the board owner may be assigned on a personal board.");
	}

	// Idempotent add: append only if the user isn't already in the array.
	const result = await db
		.update(cards)
		.set({
			assigneeIds: sql`CASE WHEN ${userId} = ANY(${cards.assigneeIds}) THEN ${cards.assigneeIds} ELSE array_append(${cards.assigneeIds}, ${userId}) END`,
		})
		.where(and(eq(cards.id, cardId), eq(cards.boardId, board.id)))
		.returning({ id: cards.id });

	if (result.length === 0) {
		throw new AppError("NOT_FOUND", "Card not found.");
	}

	eventBus.emit({ type: "card.assignee.added", boardId: board.id, payload: { cardId, userId } });
	return { cardId, userId };
}

export async function removeCardAssignee(boardId: string, cardId: string, userId: string): Promise<void> {
	// Fetch current state first so we know whether the user is actually assigned.
	// Emitting card.assignee.removed for a userId not in the array would send
	// phantom events that desync SSE clients.
	const [current] = await db
		.select({ id: cards.id, assigneeIds: cards.assigneeIds })
		.from(cards)
		.where(and(eq(cards.id, cardId), eq(cards.boardId, boardId)))
		.limit(1);

	if (!current) {
		throw new AppError("NOT_FOUND", "Card not found.");
	}

	if (!current.assigneeIds.includes(userId)) {
		return; // idempotent — userId was not assigned, no event
	}

	await db
		.update(cards)
		.set({ assigneeIds: sql`array_remove(${cards.assigneeIds}, ${userId})` })
		.where(eq(cards.id, cardId));

	eventBus.emit({ type: "card.assignee.removed", boardId, payload: { cardId, userId } });
}

// ── Comments ──────────────────────────────────────────────────────────────────

export interface CommentPayload {
	id: string;
	authorId: string;
	body: string;
	createdAt: string;
	updatedAt?: string;
}

export async function addCardComment(
	boardId: string,
	cardId: string,
	authorId: string,
	body: string,
): Promise<CommentPayload> {
	const now = new Date();
	const comment: Comment = { id: newId(), authorId, body, createdAt: now.toISOString() };

	await db.transaction(async (tx) => {
		const [card] = await tx
			.select({ comments: cards.comments })
			.from(cards)
			.where(and(eq(cards.id, cardId), eq(cards.boardId, boardId)))
			.limit(1)
			.for("update");
		if (!card) {
			throw new AppError("NOT_FOUND", "Card not found.");
		}

		if ((card.comments ?? []).length >= 500) {
			throw new AppError("CONFLICT", "Comment limit reached.");
		}
		const next = [...(card.comments ?? []), comment];
		const rows = await tx
			.update(cards)
			.set({ comments: next, updatedAt: now })
			.where(eq(cards.id, cardId))
			.returning({ id: cards.id });
		if (rows.length === 0) {
			throw new AppError("NOT_FOUND", "Card not found.");
		}
	});

	const payload: CommentPayload = {
		id: comment.id,
		authorId: comment.authorId,
		body: comment.body,
		createdAt: comment.createdAt,
	};

	eventBus.emit({ type: "card.comment.created", boardId, payload: { cardId, comment: payload } });
	return payload;
}

/** Edit a comment. Only its author may (FORBIDDEN otherwise). */
export async function updateCardComment(
	boardId: string,
	cardId: string,
	commentId: string,
	editorId: string,
	body: string,
): Promise<CommentPayload> {
	const now = new Date();
	let updatedComment: Comment | undefined;

	await db.transaction(async (tx) => {
		const [card] = await tx
			.select({ comments: cards.comments })
			.from(cards)
			.where(and(eq(cards.id, cardId), eq(cards.boardId, boardId)))
			.limit(1)
			.for("update");
		if (!card) {
			throw new AppError("NOT_FOUND", "Card or comment not found.");
		}

		const comments = card.comments ?? [];
		const idx = comments.findIndex((cm) => cm.id === commentId);
		const comment = comments[idx];
		if (idx === -1 || !comment) {
			throw new AppError("NOT_FOUND", "Card or comment not found.");
		}
		if (comment.authorId !== editorId) {
			throw new AppError("FORBIDDEN", "Only the author may edit this comment.");
		}

		const updated: Comment = {
			id: comment.id,
			authorId: comment.authorId,
			body,
			createdAt: comment.createdAt,
			updatedAt: now.toISOString(),
		};
		const next = [...comments];
		next[idx] = updated;
		updatedComment = updated;

		const rows = await tx
			.update(cards)
			.set({ comments: next, updatedAt: now })
			.where(eq(cards.id, cardId))
			.returning({ id: cards.id });
		if (rows.length === 0) {
			throw new AppError("NOT_FOUND", "Card not found.");
		}
	});

	const payload: CommentPayload = {
		id: updatedComment!.id,
		authorId: updatedComment!.authorId,
		body: updatedComment!.body,
		createdAt: updatedComment!.createdAt,
		...(updatedComment!.updatedAt && { updatedAt: updatedComment!.updatedAt }),
	};

	eventBus.emit({ type: "card.comment.updated", boardId, payload: { cardId, comment: payload } });
	return payload;
}

/** Delete a comment. Any board member may. */
export async function deleteCardComment(boardId: string, cardId: string, commentId: string): Promise<void> {
	await db.transaction(async (tx) => {
		const [card] = await tx
			.select({ comments: cards.comments })
			.from(cards)
			.where(and(eq(cards.id, cardId), eq(cards.boardId, boardId)))
			.limit(1)
			.for("update");
		if (!card) {
			throw new AppError("NOT_FOUND", "Card not found.");
		}

		const comment = (card.comments ?? []).find((cm) => cm.id === commentId);
		if (!comment) {
			throw new AppError("NOT_FOUND", "Comment not found.");
		}

		const next = (card.comments ?? []).filter((cm) => cm.id !== commentId);
		const rows = await tx
			.update(cards)
			.set({ comments: next })
			.where(eq(cards.id, cardId))
			.returning({ id: cards.id });
		if (rows.length === 0) {
			throw new AppError("NOT_FOUND", "Card not found.");
		}
	});

	eventBus.emit({ type: "card.comment.deleted", boardId, payload: { cardId, commentId } });
}

// ── Checklists ────────────────────────────────────────────────────────────────

export interface ChecklistItemPayload {
	id: string;
	text: string;
	checked: boolean;
}

export async function addChecklist(
	boardId: string,
	cardId: string,
	title: string,
): Promise<{ id: string; title: string; items: [] }> {
	const checklist: Checklist = { id: newId(), title, items: [] };

	await db.transaction(async (tx) => {
		const [card] = await tx
			.select({ checklists: cards.checklists })
			.from(cards)
			.where(and(eq(cards.id, cardId), eq(cards.boardId, boardId)))
			.limit(1)
			.for("update");
		if (!card) {
			throw new AppError("NOT_FOUND", "Card not found.");
		}

		if ((card.checklists ?? []).length >= 50) {
			throw new AppError("CONFLICT", "Checklist limit reached.");
		}
		const next = [...(card.checklists ?? []), checklist];
		const rows = await tx
			.update(cards)
			.set({ checklists: next })
			.where(eq(cards.id, cardId))
			.returning({ id: cards.id });
		if (rows.length === 0) {
			throw new AppError("NOT_FOUND", "Card not found.");
		}
	});

	const payload = { id: checklist.id, title: checklist.title, items: [] as [] };

	eventBus.emit({ type: "card.checklist.created", boardId, payload: { cardId, checklist: payload } });
	return payload;
}

export async function deleteChecklist(boardId: string, cardId: string, checklistId: string): Promise<void> {
	await db.transaction(async (tx) => {
		const [card] = await tx
			.select({ checklists: cards.checklists })
			.from(cards)
			.where(and(eq(cards.id, cardId), eq(cards.boardId, boardId)))
			.limit(1)
			.for("update");
		if (!card) {
			throw new AppError("NOT_FOUND", "Card not found.");
		}

		const exists = (card.checklists ?? []).some((cl) => cl.id === checklistId);
		if (!exists) {
			throw new AppError("NOT_FOUND", "Checklist not found.");
		}

		const next = (card.checklists ?? []).filter((cl) => cl.id !== checklistId);
		const rows = await tx
			.update(cards)
			.set({ checklists: next })
			.where(eq(cards.id, cardId))
			.returning({ id: cards.id });
		if (rows.length === 0) {
			throw new AppError("NOT_FOUND", "Card not found.");
		}
	});

	eventBus.emit({ type: "card.checklist.deleted", boardId, payload: { cardId, checklistId } });
}

export async function addChecklistItem(
	boardId: string,
	cardId: string,
	checklistId: string,
	text: string,
): Promise<ChecklistItemPayload> {
	const newItem: ChecklistItem = { id: newId(), text, checked: false };

	await db.transaction(async (tx) => {
		const [card] = await tx
			.select({ checklists: cards.checklists })
			.from(cards)
			.where(and(eq(cards.id, cardId), eq(cards.boardId, boardId)))
			.limit(1)
			.for("update");
		if (!card) {
			throw new AppError("NOT_FOUND", "Card or checklist not found.");
		}

		const checklists = card.checklists ?? [];
		const clIdx = checklists.findIndex((cl) => cl.id === checklistId);
		const checklist = checklists[clIdx];
		if (clIdx === -1 || !checklist) {
			throw new AppError("NOT_FOUND", "Card or checklist not found.");
		}

		if ((checklist.items ?? []).length >= 200) {
			throw new AppError("CONFLICT", "Checklist item limit reached.");
		}
		const targetItems = [...(checklist.items ?? []), newItem];
		const next: Checklist[] = checklists.map((cl, i) => (i === clIdx ? { ...cl, items: targetItems } : cl));
		const rows = await tx
			.update(cards)
			.set({ checklists: next })
			.where(eq(cards.id, cardId))
			.returning({ id: cards.id });
		if (rows.length === 0) {
			throw new AppError("NOT_FOUND", "Card not found.");
		}
	});

	const payload: ChecklistItemPayload = { id: newItem.id, text: newItem.text, checked: newItem.checked };

	eventBus.emit({ type: "card.checklist.updated", boardId, payload: { cardId, checklistId, item: payload } });
	return payload;
}

export async function updateChecklistItem(
	boardId: string,
	cardId: string,
	checklistId: string,
	itemId: string,
	input: { text?: string | undefined; checked?: boolean | undefined },
): Promise<ChecklistItemPayload> {
	let updatedItem: ChecklistItem | undefined;

	await db.transaction(async (tx) => {
		const [card] = await tx
			.select({ checklists: cards.checklists })
			.from(cards)
			.where(and(eq(cards.id, cardId), eq(cards.boardId, boardId)))
			.limit(1)
			.for("update");
		if (!card) {
			throw new AppError("NOT_FOUND", "Card not found.");
		}

		const checklists = card.checklists ?? [];
		const clIdx = checklists.findIndex((cl) => cl.id === checklistId);
		const checklist = checklists[clIdx];
		if (clIdx === -1 || !checklist) {
			throw new AppError("NOT_FOUND", "Checklist not found.");
		}
		const items = checklist.items ?? [];
		const itemIdx = items.findIndex((i) => i.id === itemId);
		const item = items[itemIdx];
		if (itemIdx === -1 || !item) {
			throw new AppError("NOT_FOUND", "Checklist item not found.");
		}

		const patched: ChecklistItem = {
			id: item.id,
			text: input.text !== undefined ? input.text : item.text,
			checked: input.checked !== undefined ? input.checked : item.checked,
		};
		updatedItem = patched;

		const newItems = [...items];
		newItems[itemIdx] = patched;
		const next: Checklist[] = checklists.map((cl, i) => (i === clIdx ? { ...cl, items: newItems } : cl));
		const rows = await tx
			.update(cards)
			.set({ checklists: next })
			.where(eq(cards.id, cardId))
			.returning({ id: cards.id });
		if (rows.length === 0) {
			throw new AppError("NOT_FOUND", "Card not found.");
		}
	});

	const payload: ChecklistItemPayload = {
		id: updatedItem!.id,
		text: updatedItem!.text,
		checked: updatedItem!.checked,
	};

	eventBus.emit({ type: "card.checklist.updated", boardId, payload: { cardId, checklistId, item: payload } });
	return payload;
}

export async function deleteChecklistItem(
	boardId: string,
	cardId: string,
	checklistId: string,
	itemId: string,
): Promise<void> {
	await db.transaction(async (tx) => {
		const [card] = await tx
			.select({ checklists: cards.checklists })
			.from(cards)
			.where(and(eq(cards.id, cardId), eq(cards.boardId, boardId)))
			.limit(1)
			.for("update");

		if (!card) {
			throw new AppError("NOT_FOUND", "Card not found.");
		}

		const checklists = card.checklists ?? [];
		const clIdx = checklists.findIndex((cl) => cl.id === checklistId);
		const checklist = checklists[clIdx];
		if (clIdx === -1 || !checklist) {
			throw new AppError("NOT_FOUND", "Checklist not found.");
		}
		const items = checklist.items ?? [];
		if (!items.some((i) => i.id === itemId)) {
			throw new AppError("NOT_FOUND", "Checklist item not found.");
		}

		const newItems = items.filter((i) => i.id !== itemId);
		const next: Checklist[] = checklists.map((cl, i) => (i === clIdx ? { ...cl, items: newItems } : cl));
		const rows = await tx
			.update(cards)
			.set({ checklists: next })
			.where(eq(cards.id, cardId))
			.returning({ id: cards.id });
		if (rows.length === 0) {
			throw new AppError("NOT_FOUND", "Card not found.");
		}
	});

	eventBus.emit({ type: "card.checklist.updated", boardId, payload: { cardId, checklistId, itemId } });
}
