import { Hono } from "hono";
import { z } from "zod";
import { requireSession, loadBoardAccess } from "../auth/middleware.js";
import { zValidator, validateId } from "../http/validate.js";
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
		const columnId = validateId(c.req.param("columnId"), "columnId");
		const card = await createCard({
			boardId: board.id,
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
		const columnId = validateId(c.req.param("columnId"), "columnId");
		const result = await reorderCardsInColumn(
			board.id,
			columnId,
			c.req.valid("json").orderedIds,
		);
		return ok(c, result);
	},
);

// GET /api/boards/:boardId/cards/:cardId
r.get("/cards/:cardId", async (c) => {
	const board = c.get("board") as ContextBoard;
	const cardId = validateId(c.req.param("cardId"), "cardId");
	const card = await getCard(board.id, cardId);
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
		const cardId = validateId(c.req.param("cardId"), "cardId");
		const { targetColumnId, position } = c.req.valid("json");
		const card = await moveCard(
			board.id,
			cardId,
			targetColumnId,
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
			projectId: z.string().nullable().optional(),
		}),
	),
	async (c) => {
		const board = c.get("board") as ContextBoard;
		const cardId = validateId(c.req.param("cardId"), "cardId");
		const card = await updateCard(
			board.id,
			cardId,
			c.req.valid("json"),
		);
		return ok(c, card);
	},
);

// DELETE /api/boards/:boardId/cards/:cardId
r.delete("/cards/:cardId", async (c) => {
	const board = c.get("board") as ContextBoard;
	const cardId = validateId(c.req.param("cardId"), "cardId");
	await deleteCard(board.id, cardId);
	return noContent(c);
});

export default r;
