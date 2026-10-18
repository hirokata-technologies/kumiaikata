import { Hono } from "hono";
import { z } from "zod";
import { requireSession, loadBoardAccess } from "../auth/middleware.js";
import { zValidator, validateId } from "../http/validate.js";
import { ok, noContent } from "../http/responders.js";
import type { AppVariables } from "@kata/http";
import { addCardAssignee, removeCardAssignee } from "../services/card-parts.js";

const r = new Hono<{ Variables: AppVariables }>();

r.use("*", requireSession, loadBoardAccess);

// POST /api/boards/:boardId/cards/:cardId/assignees
r.post(
	"/",
	zValidator("json", z.object({ userId: z.string() })),
	async (c) => {
		const board = c.get("board");
		const cardId = validateId(c.req.param("cardId"), "cardId");
		return ok(c, await addCardAssignee(board, cardId, c.req.valid("json").userId));
	},
);

// DELETE /api/boards/:boardId/cards/:cardId/assignees/:userId
r.delete(
	"/:userId",
	zValidator("param", z.object({ userId: z.string() })),
	async (c) => {
		const board = c.get("board");
		const cardId = validateId(c.req.param("cardId"), "cardId");
		await removeCardAssignee(board.id, cardId, c.req.valid("param").userId);
		return noContent(c);
	},
);

export default r;
