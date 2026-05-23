import { Hono } from "hono";
import { z } from "zod";
import {
	requireSession,
	loadBoardAccess,
	requireBoardAdmin,
} from "../auth/middleware.js";
import { zValidator, validateObjectId } from "../http/validate.js";
import { ok, created, noContent } from "../http/responders.js";
import type { AppVariables } from "../http/types.js";
import type { ContextBoard } from "../http/types.js";
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
	requireBoardAdmin,
	zValidator("json", z.object({ title: z.string().min(1).max(120) })),
	async (c) => {
		const board = c.get("board") as ContextBoard;
		const col = await createColumn(board._id, c.req.valid("json").title);
		return created(c, col);
	},
);

// PATCH /api/boards/:boardId/columns/reorder
// Defined before /:columnId so Hono matches "reorder" as a literal segment.
r.patch(
	"/reorder",
	requireBoardAdmin,
	zValidator(
		"json",
		z.object({ orderedIds: z.array(z.string()).min(1) }),
	),
	async (c) => {
		const board = c.get("board") as ContextBoard;
		const result = await reorderColumns(
			board._id,
			c.req.valid("json").orderedIds,
		);
		return ok(c, result);
	},
);

// PATCH /api/boards/:boardId/columns/:columnId
r.patch(
	"/:columnId",
	requireBoardAdmin,
	zValidator("json", z.object({ title: z.string().min(1).max(120) })),
	async (c) => {
		const board = c.get("board") as ContextBoard;
		const columnId = validateObjectId(c.req.param("columnId"), "columnId");
		const col = await renameColumn(
			board._id,
			columnId,
			c.req.valid("json").title,
		);
		return ok(c, col);
	},
);

// DELETE /api/boards/:boardId/columns/:columnId
r.delete("/:columnId", requireBoardAdmin, async (c) => {
	const board = c.get("board") as ContextBoard;
	const columnId = validateObjectId(c.req.param("columnId"), "columnId");
	await deleteColumn(board._id, columnId);
	return noContent(c);
});

export default r;
