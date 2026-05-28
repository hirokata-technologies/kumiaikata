import { Hono } from "hono";
import { z } from "zod";
import { eq, and } from "drizzle-orm";
import { db } from "../db/client.js";
import { newId } from "../db/ids.js";
import { requireSession, loadBoardAccess } from "../auth/middleware.js";
import { zValidator, validateId } from "../http/validate.js";
import { ok, created, noContent } from "../http/responders.js";
import type { AppVariables } from "../http/types.js";
import { cards } from "../db/schema/index.js";
import type { Comment } from "../db/schema/cards.js";
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
		const cardId = validateId(c.req.param("cardId"), "cardId");
		const now = new Date();

		const comment: Comment = {
			id: newId(),
			authorId: user.id,
			body: c.req.valid("json").body,
			createdAt: now.toISOString(),
		};

		await db.transaction(async (tx) => {
			const [card] = await tx
				.select({ comments: cards.comments })
				.from(cards)
				.where(and(eq(cards.id, cardId), eq(cards.boardId, board.id)))
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

		const payload = {
			id: comment.id,
			authorId: comment.authorId,
			body: comment.body,
			createdAt: comment.createdAt,
		};

		eventBus.emit({
			type: "card.comment.created",
			boardId: board.id,
			payload: { cardId, comment: payload },
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
		const cardId = validateId(c.req.param("cardId"), "cardId");
		const commentId = validateId(c.req.param("commentId"), "commentId");
		const now = new Date();
		const newBody = c.req.valid("json").body;

		let updatedComment: Comment | undefined;

		await db.transaction(async (tx) => {
			const [card] = await tx
				.select({ comments: cards.comments })
				.from(cards)
				.where(and(eq(cards.id, cardId), eq(cards.boardId, board.id)))
				.limit(1)
				.for("update");
			if (!card) {
				throw new AppError("NOT_FOUND", "Card or comment not found.");
			}

			const idx = (card.comments ?? []).findIndex((c) => c.id === commentId);
			if (idx === -1) {
				throw new AppError("NOT_FOUND", "Card or comment not found.");
			}

			const comment = card.comments![idx];
			if (!comment) {
				throw new AppError("NOT_FOUND", "Card or comment not found.");
			}
			if (comment.authorId !== user.id) {
				throw new AppError("FORBIDDEN", "Only the author may edit this comment.");
			}

			const updated: Comment = {
				id: comment.id,
				authorId: comment.authorId,
				body: newBody,
				createdAt: comment.createdAt,
				updatedAt: now.toISOString(),
			};
			const next = [...card.comments!];
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

		const payload = {
			id: updatedComment!.id,
			authorId: updatedComment!.authorId,
			body: updatedComment!.body,
			createdAt: updatedComment!.createdAt,
			...(updatedComment!.updatedAt && { updatedAt: updatedComment!.updatedAt }),
		};

		eventBus.emit({
			type: "card.comment.updated",
			boardId: board.id,
			payload: { cardId, comment: payload },
		});

		return ok(c, payload);
	},
);

// DELETE /api/boards/:boardId/cards/:cardId/comments/:commentId
r.delete("/:commentId", async (c) => {
	const board = c.get("board");
	const user = c.get("user");
	const access = c.get("access");
	const cardId = validateId(c.req.param("cardId"), "cardId");
	const commentId = validateId(c.req.param("commentId"), "commentId");

	await db.transaction(async (tx) => {
		const [card] = await tx
			.select({ comments: cards.comments })
			.from(cards)
			.where(and(eq(cards.id, cardId), eq(cards.boardId, board.id)))
			.limit(1)
			.for("update");
		if (!card) {
			throw new AppError("NOT_FOUND", "Card not found.");
		}

		const comment = (card.comments ?? []).find((c) => c.id === commentId);
		if (!comment) {
			throw new AppError("NOT_FOUND", "Comment not found.");
		}

		const isAuthor = comment.authorId === user.id;
		const isAdmin =
			access.kind === "team-admin" || access.kind === "personal-owner";

		if (!isAuthor && !isAdmin) {
			throw new AppError(
				"FORBIDDEN",
				"Only the comment author or a board admin may delete this comment.",
			);
		}

		const next = (card.comments ?? []).filter((c) => c.id !== commentId);
		const rows = await tx
			.update(cards)
			.set({ comments: next })
			.where(eq(cards.id, cardId))
			.returning({ id: cards.id });
		if (rows.length === 0) {
			throw new AppError("NOT_FOUND", "Card not found.");
		}
	});

	eventBus.emit({
		type: "card.comment.deleted",
		boardId: board.id,
		payload: { cardId, commentId },
	});

	return noContent(c);
});

export default r;
