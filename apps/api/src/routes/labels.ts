import { Hono } from "hono";
import { z } from "zod";
import { requireSession, loadBoardAccess, requireBoardAdmin } from "../auth/middleware.js";
import { zValidator, validateId } from "../http/validate.js";
import { ok, created, noContent } from "../http/responders.js";
import type { AppVariables } from "../http/types.js";
import { createLabel, updateLabel, deleteLabel } from "../services/labels.js";

const hexColor = z.string().regex(/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/, {
	message: "Color must be a valid CSS hex color (e.g. #fff or #e11d48).",
});
const nameField = z.string().min(1).max(50);

const r = new Hono<{ Variables: AppVariables }>();

r.use("*", requireSession, loadBoardAccess);

// POST /api/boards/:boardId/labels
r.post(
	"/",
	requireBoardAdmin,
	zValidator("json", z.object({ name: nameField, color: hexColor })),
	async (c) => {
		const board = c.get("board");
		const label = await createLabel(board.id, c.req.valid("json"));
		return created(c, label);
	},
);

// PATCH /api/boards/:boardId/labels/:labelId
r.patch(
	"/:labelId",
	requireBoardAdmin,
	zValidator(
		"json",
		z.object({ name: nameField.optional(), color: hexColor.optional() }),
	),
	async (c) => {
		const board = c.get("board");
		const labelId = validateId(c.req.param("labelId"), "labelId");
		const input = c.req.valid("json");
		const label = await updateLabel(board.id, labelId, {
			...(input.name !== undefined && { name: input.name }),
			...(input.color !== undefined && { color: input.color }),
		});
		return ok(c, label);
	},
);

// DELETE /api/boards/:boardId/labels/:labelId
r.delete("/:labelId", requireBoardAdmin, async (c) => {
	const board = c.get("board");
	const labelId = validateId(c.req.param("labelId"), "labelId");
	await deleteLabel(board.id, labelId);
	return noContent(c);
});

export default r;
