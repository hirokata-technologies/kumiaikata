import { Hono } from "hono";
import { z } from "zod";
import { eq, and, sql } from "drizzle-orm";
import { db } from "../db/client.js";
import { requireSession, loadBoardAccess } from "../auth/middleware.js";
import { zValidator, validateId } from "../http/validate.js";
import { ok, noContent } from "../http/responders.js";
import type { AppVariables } from "../http/types.js";
import { cards, labels } from "../db/schema/index.js";
import { AppError } from "../http/error.js";
import { eventBus } from "../events/bus.js";

const r = new Hono<{ Variables: AppVariables }>();

r.use("*", requireSession, loadBoardAccess);

// POST /api/boards/:boardId/cards/:cardId/labels
r.post(
	"/",
	zValidator("json", z.object({ labelId: z.string() })),
	async (c) => {
		const board = c.get("board");
		const cardId = validateId(c.req.param("cardId"), "cardId");
		const { labelId: rawLabelId } = c.req.valid("json");
		const labelId = validateId(rawLabelId, "labelId");

		// Verify label belongs to this board.
		const [label] = await db
			.select()
			.from(labels)
			.where(and(eq(labels.id, labelId), eq(labels.boardId, board.id)))
			.limit(1);
		if (!label) {
			throw new AppError(
				"VALIDATION_ERROR",
				"Label does not belong to this board.",
			);
		}

		// Idempotent add: append only if the label isn't already in the array.
		const result = await db
			.update(cards)
			.set({
				labelIds: sql`CASE WHEN ${labelId} = ANY(${cards.labelIds}) THEN ${cards.labelIds} ELSE array_append(${cards.labelIds}, ${labelId}) END`,
			})
			.where(and(eq(cards.id, cardId), eq(cards.boardId, board.id)))
			.returning({ id: cards.id });

		if (result.length === 0) {
			throw new AppError("NOT_FOUND", "Card not found.");
		}

		eventBus.emit({
			type: "card.label.added",
			boardId: board.id,
			payload: { cardId, labelId },
		});

		return ok(c, { cardId, labelId });
	},
);

// DELETE /api/boards/:boardId/cards/:cardId/labels/:labelId
r.delete("/:labelId", async (c) => {
	const board = c.get("board");
	const cardId = validateId(c.req.param("cardId"), "cardId");
	const labelId = validateId(c.req.param("labelId"), "labelId");

	const result = await db
		.update(cards)
		.set({ labelIds: sql`array_remove(${cards.labelIds}, ${labelId})` })
		.where(and(eq(cards.id, cardId), eq(cards.boardId, board.id)))
		.returning({ id: cards.id });

	if (result.length === 0) {
		throw new AppError("NOT_FOUND", "Card not found.");
	}

	eventBus.emit({
		type: "card.label.removed",
		boardId: board.id,
		payload: { cardId, labelId },
	});

	return noContent(c);
});

export default r;
