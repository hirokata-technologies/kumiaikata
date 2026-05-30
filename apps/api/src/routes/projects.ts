import { Hono } from "hono";
import { z } from "zod";
import { requireSession, loadBoardAccess, requireBoardAdmin } from "../auth/middleware.js";
import { zValidator, validateId } from "../http/validate.js";
import { ok, created, noContent } from "../http/responders.js";
import type { AppVariables } from "@kata/http";
import { listProjects, createProject, updateProject, deleteProject } from "../services/projects.js";

const hexColor = z.string().regex(/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/, {
	message: "Color must be a valid CSS hex color (e.g. #fff or #e11d48).",
});
const nameField = z.string().min(1).max(50);

const r = new Hono<{ Variables: AppVariables }>();

r.use("*", requireSession, loadBoardAccess);

// GET /api/boards/:boardId/projects
r.get("/", async (c) => {
	const board = c.get("board");
	return ok(c, await listProjects(board.id));
});

// POST /api/boards/:boardId/projects
r.post(
	"/",
	requireBoardAdmin,
	zValidator("json", z.object({ name: nameField, color: hexColor })),
	async (c) => {
		const board = c.get("board");
		const project = await createProject(board.id, c.req.valid("json"));
		return created(c, project);
	},
);

// PATCH /api/boards/:boardId/projects/:projectId
r.patch(
	"/:projectId",
	requireBoardAdmin,
	zValidator(
		"json",
		z.object({ name: nameField.optional(), color: hexColor.optional() }),
	),
	async (c) => {
		const board = c.get("board");
		const projectId = validateId(c.req.param("projectId"), "projectId");
		const input = c.req.valid("json");
		const project = await updateProject(board.id, projectId, {
			...(input.name !== undefined && { name: input.name }),
			...(input.color !== undefined && { color: input.color }),
		});
		return ok(c, project);
	},
);

// DELETE /api/boards/:boardId/projects/:projectId
r.delete("/:projectId", requireBoardAdmin, async (c) => {
	const board = c.get("board");
	const projectId = validateId(c.req.param("projectId"), "projectId");
	await deleteProject(board.id, projectId);
	return noContent(c);
});

export default r;
