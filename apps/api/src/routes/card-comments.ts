import { Hono } from "hono";
import { z } from "zod";
import { requireSession, loadBoardAccess } from "../auth/middleware.js";
import { zValidator, validateId } from "../http/validate.js";
import { ok, created, noContent } from "../http/responders.js";
import type { AppVariables } from "@kata/http";
import { addCardComment, updateCardComment, deleteCardComment } from "../services/card-parts.js";

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
		return created(c, await addCardComment(board.id, cardId, user.id, c.req.valid("json").body));
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
		return ok(c, await updateCardComment(board.id, cardId, commentId, user.id, c.req.valid("json").body));
	},
);

// DELETE /api/boards/:boardId/cards/:cardId/comments/:commentId
r.delete("/:commentId", async (c) => {
	const board = c.get("board");
	const cardId = validateId(c.req.param("cardId"), "cardId");
	const commentId = validateId(c.req.param("commentId"), "commentId");
	await deleteCardComment(board.id, cardId, commentId);
	return noContent(c);
});

export default r;
