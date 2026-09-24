import { Hono } from "hono";
import { z } from "zod";
import { requireSession } from "../../auth/middleware.js";
import { loadTeamAccess } from "../../auth/team-access.js";
import type { KumiaiVariables } from "../../auth/team-access.js";
import { zValidator, validateId } from "../../http/validate.js";
import { ok, created, noContent } from "../../http/responders.js";
import { listPlans, getPlan, createPlan, updatePlan, deletePlan } from "../../services/kumiai/plans.js";

const titleField = z.string().min(1).max(200);
const bodyField = z.string().max(50000);
const statusField = z.enum(["todo", "in-progress", "done"]);
const approvalField = z.enum(["pending", "approved", "rejected"]);

const createSchema = z.object({
	requirementId: z.string().min(1),
	taskId: z.string().min(1).nullable().optional(),
	title: titleField,
	body: bodyField.optional(),
	status: statusField.optional(),
	approval: approvalField.optional(),
	approvedBy: z.string().min(1).nullable().optional(),
	approvedAt: z.string().datetime().nullable().optional(),
});

const updateSchema = z.object({
	requirementId: z.string().min(1).optional(),
	taskId: z.string().min(1).nullable().optional(),
	title: titleField.optional(),
	body: bodyField.optional(),
	status: statusField.optional(),
	approval: approvalField.optional(),
	approvedBy: z.string().min(1).nullable().optional(),
	approvedAt: z.string().datetime().nullable().optional(),
});

const r = new Hono<{ Variables: KumiaiVariables }>();

r.use("*", requireSession, loadTeamAccess);

// GET /api/kumiai/plans
r.get("/", async (c) => {
	const teamId = c.get("kumiaiTeamId");
	return ok(c, await listPlans(teamId));
});

// GET /api/kumiai/plans/:id
r.get("/:id", async (c) => {
	const teamId = c.get("kumiaiTeamId");
	const id = validateId(c.req.param("id"), "id");
	return ok(c, await getPlan(teamId, id));
});

// POST /api/kumiai/plans
r.post("/", zValidator("json", createSchema), async (c) => {
	const teamId = c.get("kumiaiTeamId");
	const input = c.req.valid("json");
	const plan = await createPlan(teamId, {
		requirementId: input.requirementId,
		title: input.title,
		...(input.taskId !== undefined && { taskId: input.taskId }),
		...(input.body !== undefined && { body: input.body }),
		...(input.status !== undefined && { status: input.status }),
		...(input.approval !== undefined && { approval: input.approval }),
		...(input.approvedBy !== undefined && { approvedBy: input.approvedBy }),
		...(input.approvedAt !== undefined && { approvedAt: input.approvedAt }),
	});
	return created(c, plan);
});

// PATCH /api/kumiai/plans/:id
r.patch("/:id", zValidator("json", updateSchema), async (c) => {
	const teamId = c.get("kumiaiTeamId");
	const id = validateId(c.req.param("id"), "id");
	const input = c.req.valid("json");
	const plan = await updatePlan(teamId, id, {
		...(input.requirementId !== undefined && { requirementId: input.requirementId }),
		...(input.taskId !== undefined && { taskId: input.taskId }),
		...(input.title !== undefined && { title: input.title }),
		...(input.body !== undefined && { body: input.body }),
		...(input.status !== undefined && { status: input.status }),
		...(input.approval !== undefined && { approval: input.approval }),
		...(input.approvedBy !== undefined && { approvedBy: input.approvedBy }),
		...(input.approvedAt !== undefined && { approvedAt: input.approvedAt }),
	});
	return ok(c, plan);
});

// DELETE /api/kumiai/plans/:id
r.delete("/:id", async (c) => {
	const teamId = c.get("kumiaiTeamId");
	const id = validateId(c.req.param("id"), "id");
	await deletePlan(teamId, id);
	return noContent(c);
});

export default r;
