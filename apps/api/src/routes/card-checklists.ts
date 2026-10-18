import { Hono } from "hono";
import { z } from "zod";
import { requireSession, loadBoardAccess } from "../auth/middleware.js";
import { zValidator, validateId } from "../http/validate.js";
import { ok, created, noContent } from "../http/responders.js";
import type { AppVariables } from "@kata/http";
import {
	addChecklist,
	deleteChecklist,
	addChecklistItem,
	updateChecklistItem,
	deleteChecklistItem,
} from "../services/card-parts.js";

const r = new Hono<{ Variables: AppVariables }>();

r.use("*", requireSession, loadBoardAccess);

// POST /api/boards/:boardId/cards/:cardId/checklists
r.post(
	"/",
	zValidator("json", z.object({ title: z.string().min(1).max(200) })),
	async (c) => {
		const board = c.get("board");
		const cardId = validateId(c.req.param("cardId"), "cardId");
		return created(c, await addChecklist(board.id, cardId, c.req.valid("json").title));
	},
);

// DELETE /api/boards/:boardId/cards/:cardId/checklists/:checklistId
r.delete("/:checklistId", async (c) => {
	const board = c.get("board");
	const cardId = validateId(c.req.param("cardId"), "cardId");
	const checklistId = validateId(c.req.param("checklistId"), "checklistId");
	await deleteChecklist(board.id, cardId, checklistId);
	return noContent(c);
});

// POST /api/boards/:boardId/cards/:cardId/checklists/:checklistId/items
r.post(
	"/:checklistId/items",
	zValidator("json", z.object({ text: z.string().min(1).max(1000) })),
	async (c) => {
		const board = c.get("board");
		const cardId = validateId(c.req.param("cardId"), "cardId");
		const checklistId = validateId(c.req.param("checklistId"), "checklistId");
		return created(c, await addChecklistItem(board.id, cardId, checklistId, c.req.valid("json").text));
	},
);

// PATCH /api/boards/:boardId/cards/:cardId/checklists/:checklistId/items/:itemId
r.patch(
	"/:checklistId/items/:itemId",
	zValidator(
		"json",
		z.object({
			text: z.string().min(1).max(1000).optional(),
			checked: z.boolean().optional(),
		}),
	),
	async (c) => {
		const board = c.get("board");
		const cardId = validateId(c.req.param("cardId"), "cardId");
		const checklistId = validateId(c.req.param("checklistId"), "checklistId");
		const itemId = validateId(c.req.param("itemId"), "itemId");
		return ok(c, await updateChecklistItem(board.id, cardId, checklistId, itemId, c.req.valid("json")));
	},
);

// DELETE /api/boards/:boardId/cards/:cardId/checklists/:checklistId/items/:itemId
r.delete("/:checklistId/items/:itemId", async (c) => {
	const board = c.get("board");
	const cardId = validateId(c.req.param("cardId"), "cardId");
	const checklistId = validateId(c.req.param("checklistId"), "checklistId");
	const itemId = validateId(c.req.param("itemId"), "itemId");
	await deleteChecklistItem(board.id, cardId, checklistId, itemId);
	return noContent(c);
});

export default r;
