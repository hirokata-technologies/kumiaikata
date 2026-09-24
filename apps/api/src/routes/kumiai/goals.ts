import { Hono } from "hono";
import { z } from "zod";
import { requireSession } from "../../auth/middleware.js";
import { loadTeamAccess } from "../../auth/team-access.js";
import type { KumiaiVariables } from "../../auth/team-access.js";
import { zValidator, validateId } from "../../http/validate.js";
import { ok, created, noContent } from "../../http/responders.js";
import { listGoals, getGoal, createGoal, updateGoal, deleteGoal } from "../../services/kumiai/goals.js";

const titleField = z.string().min(1).max(200);
const bodyField = z.string().max(50000);
const statusField = z.enum(["todo", "in-progress", "done"]);
const priorityField = z.number().int().min(1).max(5);

const createSchema = z.object({
	title: titleField,
	body: bodyField.optional(),
	status: statusField.optional(),
	priority: priorityField.optional(),
});

const updateSchema = z.object({
	title: titleField.optional(),
	body: bodyField.optional(),
	status: statusField.optional(),
	priority: priorityField.optional(),
});

const r = new Hono<{ Variables: KumiaiVariables }>();

r.use("*", requireSession, loadTeamAccess);

// GET /api/kumiai/goals
r.get("/", async (c) => {
	const teamId = c.get("kumiaiTeamId");
	return ok(c, await listGoals(teamId));
});

// GET /api/kumiai/goals/:id
r.get("/:id", async (c) => {
	const teamId = c.get("kumiaiTeamId");
	const id = validateId(c.req.param("id"), "id");
	return ok(c, await getGoal(teamId, id));
});

// POST /api/kumiai/goals
r.post("/", zValidator("json", createSchema), async (c) => {
	const teamId = c.get("kumiaiTeamId");
	const input = c.req.valid("json");
	const goal = await createGoal(teamId, {
		title: input.title,
		...(input.body !== undefined && { body: input.body }),
		...(input.status !== undefined && { status: input.status }),
		...(input.priority !== undefined && { priority: input.priority }),
	});
	return created(c, goal);
});

// PATCH /api/kumiai/goals/:id
r.patch("/:id", zValidator("json", updateSchema), async (c) => {
	const teamId = c.get("kumiaiTeamId");
	const id = validateId(c.req.param("id"), "id");
	const input = c.req.valid("json");
	const goal = await updateGoal(teamId, id, {
		...(input.title !== undefined && { title: input.title }),
		...(input.body !== undefined && { body: input.body }),
		...(input.status !== undefined && { status: input.status }),
		...(input.priority !== undefined && { priority: input.priority }),
	});
	return ok(c, goal);
});

// DELETE /api/kumiai/goals/:id
r.delete("/:id", async (c) => {
	const teamId = c.get("kumiaiTeamId");
	const id = validateId(c.req.param("id"), "id");
	await deleteGoal(teamId, id);
	return noContent(c);
});

export default r;
