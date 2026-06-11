import { Hono } from "hono";
import { z } from "zod";
import {
	requireSession,
	loadBoardAccess,
} from "../auth/middleware.js";
import { zValidator, validateId } from "../http/validate.js";
import { ok, created, noContent } from "../http/responders.js";
import type { AppVariables, ContextBoard } from "@kata/http";
import {
	createColumn,
	renameColumn,
	deleteColumn,
	reorderColumns,
} from "../services/columns.js";

const r = new Hono<{ Variables: AppVariables }>();

r.use("*", requireSession, loadBoardAccess);

// POST /api/boards/:boardId/columns
r.post(
	"/",
	zValidator("json", z.object({ title: z.string().min(1).max(120) })),
	async (c) => {
		const board = c.get("board") as ContextBoard;
		const col = await createColumn(board.id, c.req.valid("json").title);
		return created(c, col);
	},
);

// PATCH /api/boards/:boardId/columns/reorder
// Defined before /:columnId so Hono matches "reorder" as a literal segment.
r.patch(
	"/reorder",
	zValidator(
		"json",
		z.object({ orderedIds: z.array(z.string()).min(1) }),
	),
	async (c) => {
		const board = c.get("board") as ContextBoard;
		const result = await reorderColumns(
			board.id,
			c.req.valid("json").orderedIds,
		);
		return ok(c, result);
	},
);

// PATCH /api/boards/:boardId/columns/:columnId
r.patch(
	"/:columnId",
	zValidator("json", z.object({ title: z.string().min(1).max(120) })),
	async (c) => {
		const board = c.get("board") as ContextBoard;
		const columnId = validateId(c.req.param("columnId"), "columnId");
		const col = await renameColumn(
			board.id,
			columnId,
			c.req.valid("json").title,
		);
		return ok(c, col);
	},
);

// DELETE /api/boards/:boardId/columns/:columnId
r.delete("/:columnId", async (c) => {
	const board = c.get("board") as ContextBoard;
	const columnId = validateId(c.req.param("columnId"), "columnId");
	await deleteColumn(board.id, columnId);
	return noContent(c);
});

export default r;
