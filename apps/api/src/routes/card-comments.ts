import { Hono } from "hono";
import { z } from "zod";
import { ObjectId } from "mongodb";
import { requireSession, loadBoardAccess } from "../auth/middleware.js";
import { zValidator, validateObjectId } from "../http/validate.js";
import { ok, created, noContent } from "../http/responders.js";
import type { AppVariables } from "../http/types.js";
import { cards } from "../db/schemas/index.js";
import { AppError } from "../http/error.js";
import { eventBus } from "../events/bus.js";

const bodyField = z.string().min(1).max(10000);

const r = new Hono<{ Variables: AppVariables }>();

r.use("*", requireSession, loadBoardAccess);

// POST /api/boards/:boardId/cards/:cardId/comments
r.post(
	"/",
	zValidator("json", z.object({ body: bodyField })),
	async (c) => {
		const board = c.get("board");
		const user = c.get("user");
		const cardId = new ObjectId(validateObjectId(c.req.param("cardId"), "cardId"));

		const comment = {
			_id: new ObjectId(),
			authorId: user.id as unknown as ObjectId,
			body: c.req.valid("json").body,
			createdAt: new Date(),
		};

		const result = await cards().updateOne(
			{ _id: cardId, boardId: board._id },
			{ $push: { comments: comment } },
		);

		if (result.matchedCount === 0) {
			throw new AppError("NOT_FOUND", "Card not found.");
		}

		const payload = {
			id: String(comment._id),
			authorId: String(comment.authorId),
			body: comment.body,
			createdAt: comment.createdAt,
		};

		eventBus.emit({
			type: "card.comment.created",
			boardId: String(board._id),
			payload: { cardId: String(cardId), comment: payload },
		});

		return created(c, payload);
	},
);

// PATCH /api/boards/:boardId/cards/:cardId/comments/:commentId
r.patch(
	"/:commentId",
	zValidator("json", z.object({ body: bodyField })),
	async (c) => {
		const board = c.get("board");
		const user = c.get("user");
		const cardId = new ObjectId(validateObjectId(c.req.param("cardId"), "cardId"));
		const commentObjId = new ObjectId(validateObjectId(c.req.param("commentId"), "commentId"));

		// Check whether the card+comment exists at all so we can distinguish
		// a 404 (card or comment missing) from a 403 (wrong author).
		const exists = await cards().findOne(
			{ _id: cardId, boardId: board._id, "comments._id": commentObjId },
			{ projection: { _id: 1 } },
		);
		if (!exists) {
			throw new AppError("NOT_FOUND", "Card or comment not found.");
		}

		const updatedAt = new Date();
		const updated = await cards().findOneAndUpdate(
			{
				_id: cardId,
				boardId: board._id,
				"comments._id": commentObjId,
				"comments.authorId": user.id,
			},
			{
				$set: {
					"comments.$.body": c.req.valid("json").body,
					"comments.$.updatedAt": updatedAt,
				},
			},
			{
				returnDocument: "after",
				projection: { comments: { $elemMatch: { _id: commentObjId } } },
			},
		);

		if (!updated) {
			throw new AppError("FORBIDDEN", "Only the author may edit this comment.");
		}

		const comment = updated.comments?.[0];
		if (!comment) {
			throw new AppError("NOT_FOUND", "Comment not found.");
		}

		const payload = {
			id: String(comment._id),
			authorId: String(comment.authorId),
			body: comment.body,
			createdAt: comment.createdAt,
			...(comment.updatedAt && { updatedAt: comment.updatedAt }),
		};

		eventBus.emit({
			type: "card.comment.updated",
			boardId: String(board._id),
			payload: { cardId: String(cardId), comment: payload },
		});

		return ok(c, payload);
	},
);

// DELETE /api/boards/:boardId/cards/:cardId/comments/:commentId
r.delete("/:commentId", async (c) => {
	const board = c.get("board");
	const user = c.get("user");
	const access = c.get("access");
	const cardId = new ObjectId(validateObjectId(c.req.param("cardId"), "cardId"));
	const commentObjId = new ObjectId(validateObjectId(c.req.param("commentId"), "commentId"));

	const card = await cards().findOne(
		{ _id: cardId, boardId: board._id },
		{ projection: { comments: { $elemMatch: { _id: commentObjId } } } },
	);
	if (!card) {
		throw new AppError("NOT_FOUND", "Card not found.");
	}

	const comment = card.comments?.[0];
	if (!comment) {
		throw new AppError("NOT_FOUND", "Comment not found.");
	}

	const isAuthor = String(comment.authorId) === String(user.id);
	const isAdmin =
		access.kind === "team-admin" || access.kind === "personal-owner";

	if (!isAuthor && !isAdmin) {
		throw new AppError(
			"FORBIDDEN",
			"Only the comment author or a board admin may delete this comment.",
		);
	}

	await cards().updateOne(
		{ _id: cardId },
		{ $pull: { comments: { _id: commentObjId } } },
	);

	eventBus.emit({
		type: "card.comment.deleted",
		boardId: String(board._id),
		payload: { cardId: String(cardId), commentId: String(commentObjId) },
	});

	return noContent(c);
});

export default r;
