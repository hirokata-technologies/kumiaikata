import { Hono } from "hono";
import { z } from "zod";
import { ObjectId } from "mongodb";
import { requireSession, loadBoardAccess } from "../auth/middleware.js";
import { zValidator, validateObjectId } from "../http/validate.js";
import { ok, noContent } from "../http/responders.js";
import type { AppVariables } from "../http/types.js";
import { cards, teamMembers } from "../db/schemas/index.js";
import { AppError } from "../http/error.js";
import { eventBus } from "../events/bus.js";

const r = new Hono<{ Variables: AppVariables }>();

r.use("*", requireSession, loadBoardAccess);

// POST /api/boards/:boardId/cards/:cardId/assignees
r.post(
	"/",
	zValidator("json", z.object({ userId: z.string() })),
	async (c) => {
		const board = c.get("board");
		const cardId = new ObjectId(validateObjectId(c.req.param("cardId"), "cardId"));
		const { userId } = c.req.valid("json");

		// Validate assignee belongs to the board's team or is the personal board owner.
		if (board.kind === "team") {
			const isMember = await teamMembers().findOne(
				{ teamId: board.teamId!, userId: userId as unknown as ObjectId },
				{ projection: { _id: 1 } },
			);
			if (!isMember) {
				throw new AppError(
					"VALIDATION_ERROR",
					"User is not a member of this board's team.",
				);
			}
		} else {
			// Personal board: only the owner may be assigned.
			if (String(board.ownerId) !== userId) {
				throw new AppError(
					"VALIDATION_ERROR",
					"Only the board owner may be assigned on a personal board.",
				);
			}
		}

		const result = await cards().updateOne(
			{ _id: cardId, boardId: board._id },
			{ $addToSet: { assigneeIds: userId as unknown as ObjectId } },
		);

		if (result.matchedCount === 0) {
			throw new AppError("NOT_FOUND", "Card not found.");
		}

		eventBus.emit({
			type: "card.assignee.added",
			boardId: String(board._id),
			payload: { cardId: String(cardId), userId },
		});

		return ok(c, { cardId: String(cardId), userId });
	},
);

// DELETE /api/boards/:boardId/cards/:cardId/assignees/:userId
r.delete("/:userId", async (c) => {
	const board = c.get("board");
	const cardId = new ObjectId(validateObjectId(c.req.param("cardId"), "cardId"));
	const userId = c.req.param("userId");

	const result = await cards().updateOne(
		{ _id: cardId, boardId: board._id },
		{ $pull: { assigneeIds: userId as unknown as ObjectId } },
	);

	if (result.matchedCount === 0) {
		throw new AppError("NOT_FOUND", "Card not found.");
	}

	eventBus.emit({
		type: "card.assignee.removed",
		boardId: String(board._id),
		payload: { cardId: String(cardId), userId },
	});

	return noContent(c);
});

export default r;
