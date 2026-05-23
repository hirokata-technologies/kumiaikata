import { Hono } from "hono";
import { z } from "zod";
import { ObjectId } from "mongodb";
import { requireSession, loadBoardAccess } from "../auth/middleware.js";
import { zValidator, validateObjectId } from "../http/validate.js";
import { ok, noContent } from "../http/responders.js";
import type { AppVariables } from "../http/types.js";
import { cards, labels } from "../db/schemas/index.js";
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
		const cardId = new ObjectId(validateObjectId(c.req.param("cardId"), "cardId"));
		const { labelId: rawLabelId } = c.req.valid("json");
		const labelIdStr = validateObjectId(rawLabelId, "labelId");
		const labelObjId = new ObjectId(labelIdStr);

		// Verify label belongs to this board.
		const label = await labels().findOne({ _id: labelObjId, boardId: board._id });
		if (!label) {
			throw new AppError(
				"VALIDATION_ERROR",
				"Label does not belong to this board.",
			);
		}

		const result = await cards().updateOne(
			{ _id: cardId, boardId: board._id },
			{ $addToSet: { labelIds: label._id } },
		);

		if (result.matchedCount === 0) {
			throw new AppError("NOT_FOUND", "Card not found.");
		}

		eventBus.emit({
			type: "card.label.added",
			boardId: String(board._id),
			payload: { cardId: String(cardId), labelId: labelIdStr },
		});

		return ok(c, { cardId: String(cardId), labelId: labelIdStr });
	},
);

// DELETE /api/boards/:boardId/cards/:cardId/labels/:labelId
r.delete("/:labelId", async (c) => {
	const board = c.get("board");
	const cardId = new ObjectId(validateObjectId(c.req.param("cardId"), "cardId"));
	const labelIdStr = validateObjectId(c.req.param("labelId"), "labelId");
	const labelObjId = new ObjectId(labelIdStr);

	const result = await cards().updateOne(
		{ _id: cardId, boardId: board._id },
		{ $pull: { labelIds: labelObjId } },
	);

	if (result.matchedCount === 0) {
		throw new AppError("NOT_FOUND", "Card not found.");
	}

	eventBus.emit({
		type: "card.label.removed",
		boardId: String(board._id),
		payload: { cardId: String(cardId), labelId: labelIdStr },
	});

	return noContent(c);
});

export default r;
