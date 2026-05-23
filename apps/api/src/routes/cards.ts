import { Hono } from "hono";
import { z } from "zod";
import { requireSession, loadBoardAccess } from "../auth/middleware.js";
import { zValidator, validateObjectId } from "../http/validate.js";
import { ok, created, noContent } from "../http/responders.js";
import type { AppVariables, ContextBoard } from "../http/types.js";
import {
	createCard,
	getCard,
	updateCard,
	moveCard,
	reorderCardsInColumn,
	deleteCard,
} from "../services/cards.js";

const r = new Hono<{ Variables: AppVariables }>();

r.use("*", requireSession, loadBoardAccess);

// POST /api/boards/:boardId/columns/:columnId/cards
r.post(
	"/columns/:columnId/cards",
	zValidator("json", z.object({ title: z.string().min(1).max(500) })),
	async (c) => {
		const board = c.get("board") as ContextBoard;
		const columnId = validateObjectId(c.req.param("columnId"), "columnId");
		const card = await createCard({
			boardId: board._id,
			columnId,
			title: c.req.valid("json").title,
		});
		return created(c, card);
	},
);

// PATCH /api/boards/:boardId/columns/:columnId/cards/reorder
r.patch(
	"/columns/:columnId/cards/reorder",
	zValidator(
		"json",
		z.object({ orderedIds: z.array(z.string()).min(1) }),
	),
	async (c) => {
		const board = c.get("board") as ContextBoard;
		const columnId = validateObjectId(c.req.param("columnId"), "columnId");
		const result = await reorderCardsInColumn(
			board._id,
			columnId,
			c.req.valid("json").orderedIds,
		);
		return ok(c, result);
	},
);

// GET /api/boards/:boardId/cards/:cardId
r.get("/cards/:cardId", async (c) => {
	const board = c.get("board") as ContextBoard;
	const cardId = validateObjectId(c.req.param("cardId"), "cardId");
	const card = await getCard(board._id, cardId);
	return ok(c, card);
});

// PATCH /api/boards/:boardId/cards/:cardId/move
r.patch(
	"/cards/:cardId/move",
	zValidator(
		"json",
		z.object({
			targetColumnId: z.string(),
			position: z.number().int().min(0),
		}),
	),
	async (c) => {
		const board = c.get("board") as ContextBoard;
		const cardId = validateObjectId(c.req.param("cardId"), "cardId");
		const { targetColumnId, position } = c.req.valid("json");
		const targetColId = validateObjectId(targetColumnId, "targetColumnId");
		const card = await moveCard(
			board._id,
			cardId,
			targetColId,
			position,
		);
		return ok(c, card);
	},
);

// PATCH /api/boards/:boardId/cards/:cardId
r.patch(
	"/cards/:cardId",
	zValidator(
		"json",
		z.object({
			title: z.string().min(1).max(500).optional(),
			description: z.string().max(50000).nullable().optional(),
			dueDate: z.string().datetime().nullable().optional(),
		}),
	),
	async (c) => {
		const board = c.get("board") as ContextBoard;
		const cardId = validateObjectId(c.req.param("cardId"), "cardId");
		const card = await updateCard(
			board._id,
			cardId,
			c.req.valid("json"),
		);
		return ok(c, card);
	},
);

// DELETE /api/boards/:boardId/cards/:cardId
r.delete("/cards/:cardId", async (c) => {
	const board = c.get("board") as ContextBoard;
	const cardId = validateObjectId(c.req.param("cardId"), "cardId");
	await deleteCard(board._id, cardId);
	return noContent(c);
});

export default r;
