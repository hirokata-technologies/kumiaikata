import { Hono } from "hono";
import { z } from "zod";
import { requireSession, loadBoardAccess } from "../auth/middleware.js";
import { zValidator, validateId } from "../http/validate.js";
import { ok, noContent } from "../http/responders.js";
import type { AppVariables } from "@kata/http";
import { addCardLabel, removeCardLabel } from "../services/card-parts.js";

const r = new Hono<{ Variables: AppVariables }>();

r.use("*", requireSession, loadBoardAccess);

// POST /api/boards/:boardId/cards/:cardId/labels
r.post(
	"/",
	zValidator("json", z.object({ labelId: z.string() })),
	async (c) => {
		const board = c.get("board");
		const cardId = validateId(c.req.param("cardId"), "cardId");
		const labelId = validateId(c.req.valid("json").labelId, "labelId");
		return ok(c, await addCardLabel(board.id, cardId, labelId));
	},
);

// DELETE /api/boards/:boardId/cards/:cardId/labels/:labelId
r.delete("/:labelId", async (c) => {
	const board = c.get("board");
	const cardId = validateId(c.req.param("cardId"), "cardId");
	const labelId = validateId(c.req.param("labelId"), "labelId");
	await removeCardLabel(board.id, cardId, labelId);
	return noContent(c);
});

export default r;
