import { eq, and, asc, sql } from "drizzle-orm";
import { db, newId } from "@kata/db";
import { cards, labels } from "@kata/db";
import { AppError } from "@kata/http";
import { eventBus } from "@kata/events";

// ── Serialisation shape ───────────────────────────────────────────────────────

export interface LabelDetail {
	id: string;
	boardId: string;
	name: string;
	color: string;
}

// ── listLabels ────────────────────────────────────────────────────────────────

export async function listLabels(boardId: string): Promise<LabelDetail[]> {
	const rows = await db
		.select()
		.from(labels)
		.where(eq(labels.boardId, boardId))
		.orderBy(asc(labels.name));
	return rows.map((l) => ({
		id: l.id,
		boardId: l.boardId,
		name: l.name,
		color: l.color,
	}));
}

// ── createLabel ───────────────────────────────────────────────────────────────

export async function createLabel(
	boardId: string,
	input: { name: string; color: string },
): Promise<LabelDetail> {
	const [label] = await db
		.insert(labels)
		.values({ id: newId(), boardId, name: input.name, color: input.color })
		.returning();

	if (!label) {
		throw new AppError("INTERNAL_ERROR", "Label was created but could not be fetched.");
	}

	const detail: LabelDetail = {
		id: label.id,
		boardId: label.boardId,
		name: label.name,
		color: label.color,
	};

	eventBus.emit({
		type: "label.created",
		boardId,
		payload: detail,
	});

	return detail;
}

// ── updateLabel ───────────────────────────────────────────────────────────────

export async function updateLabel(
	boardId: string,
	labelId: string,
	input: { name?: string; color?: string },
): Promise<LabelDetail> {
	const patch: Partial<{ name: string; color: string }> = {};
	if (input.name !== undefined) patch.name = input.name;
	if (input.color !== undefined) patch.color = input.color;

	const [label] = await db
		.update(labels)
		.set(patch)
		.where(and(eq(labels.id, labelId), eq(labels.boardId, boardId)))
		.returning();

	if (!label) {
		throw new AppError("NOT_FOUND", "Label not found.");
	}

	const detail: LabelDetail = {
		id: label.id,
		boardId: label.boardId,
		name: label.name,
		color: label.color,
	};

	eventBus.emit({
		type: "label.updated",
		boardId,
		payload: detail,
	});

	return detail;
}

// ── deleteLabel ───────────────────────────────────────────────────────────────

export async function deleteLabel(
	boardId: string,
	labelId: string,
): Promise<void> {
	await db.transaction(async (tx) => {
		// Pull the label from every card on the board that references it.
		await tx
			.update(cards)
			.set({ labelIds: sql`array_remove(${cards.labelIds}, ${labelId})` })
			.where(
				and(
					eq(cards.boardId, boardId),
					sql`${labelId} = ANY(${cards.labelIds})`,
				),
			);

		// Delete the label.
		const deleted = await tx
			.delete(labels)
			.where(and(eq(labels.id, labelId), eq(labels.boardId, boardId)))
			.returning({ id: labels.id });

		if (deleted.length === 0) {
			throw new AppError("NOT_FOUND", "Label not found.");
		}
	});

	eventBus.emit({
		type: "label.deleted",
		boardId,
		payload: { id: labelId, boardId },
	});
}
