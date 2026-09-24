import { Hono } from "hono";
import { z } from "zod";
import { requireSession } from "../../auth/middleware.js";
import { loadTeamAccess } from "../../auth/team-access.js";
import type { KumiaiVariables } from "../../auth/team-access.js";
import { zValidator, validateId } from "../../http/validate.js";
import { ok, created, noContent } from "../../http/responders.js";
import { listTasks, getTask, createTask, updateTask, deleteTask } from "../../services/kumiai/tasks.js";

const titleField = z.string().min(1).max(200);
const bodyField = z.string().max(50000);
const objectiveField = z.string().max(50000);
const statusField = z.enum(["todo", "in-progress", "done", "failed", "blocked", "waived"]);
const priorityField = z.number().int().min(1).max(5);

const createSchema = z.object({
	requirementId: z.string().min(1),
	planId: z.string().min(1).nullable().optional(),
	title: titleField,
	objective: objectiveField.optional(),
	body: bodyField.optional(),
	status: statusField.optional(),
	priority: priorityField.optional(),
});

const updateSchema = z.object({
	requirementId: z.string().min(1).optional(),
	planId: z.string().min(1).nullable().optional(),
	title: titleField.optional(),
	objective: objectiveField.optional(),
	body: bodyField.optional(),
	status: statusField.optional(),
	priority: priorityField.optional(),
});

const r = new Hono<{ Variables: KumiaiVariables }>();

r.use("*", requireSession, loadTeamAccess);

// GET /api/kumiai/tasks
r.get("/", async (c) => {
	const teamId = c.get("kumiaiTeamId");
	return ok(c, await listTasks(teamId));
});

// GET /api/kumiai/tasks/:id
r.get("/:id", async (c) => {
	const teamId = c.get("kumiaiTeamId");
	const id = validateId(c.req.param("id"), "id");
	return ok(c, await getTask(teamId, id));
});

// POST /api/kumiai/tasks
r.post("/", zValidator("json", createSchema), async (c) => {
	const teamId = c.get("kumiaiTeamId");
	const input = c.req.valid("json");
	const task = await createTask(teamId, {
		requirementId: input.requirementId,
		title: input.title,
		...(input.planId !== undefined && { planId: input.planId }),
		...(input.objective !== undefined && { objective: input.objective }),
		...(input.body !== undefined && { body: input.body }),
		...(input.status !== undefined && { status: input.status }),
		...(input.priority !== undefined && { priority: input.priority }),
	});
	return created(c, task);
});

// PATCH /api/kumiai/tasks/:id
r.patch("/:id", zValidator("json", updateSchema), async (c) => {
	const teamId = c.get("kumiaiTeamId");
	const id = validateId(c.req.param("id"), "id");
	const input = c.req.valid("json");
	const task = await updateTask(teamId, id, {
		...(input.requirementId !== undefined && { requirementId: input.requirementId }),
		...(input.planId !== undefined && { planId: input.planId }),
		...(input.title !== undefined && { title: input.title }),
		...(input.objective !== undefined && { objective: input.objective }),
		...(input.body !== undefined && { body: input.body }),
		...(input.status !== undefined && { status: input.status }),
		...(input.priority !== undefined && { priority: input.priority }),
	});
	return ok(c, task);
});

// DELETE /api/kumiai/tasks/:id
r.delete("/:id", async (c) => {
	const teamId = c.get("kumiaiTeamId");
	const id = validateId(c.req.param("id"), "id");
	await deleteTask(teamId, id);
	return noContent(c);
});

export default r;
