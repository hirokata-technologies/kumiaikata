import { Hono } from "hono";
import { z } from "zod";
import { requireSession } from "../../auth/middleware.js";
import { loadTeamAccess } from "../../auth/team-access.js";
import type { KumiaiVariables } from "../../auth/team-access.js";
import { zValidator, validateId } from "../../http/validate.js";
import { ok, created, noContent } from "../../http/responders.js";
import { AppError } from "@kata/http";
import {
	listProjects,
	getProject,
	createProject,
	updateProject,
	deleteProject,
	type ProjectStatus,
} from "../../services/kumiai/projects.js";

const titleField = z.string().min(1).max(200);
const bodyField = z.string().max(50000);
const statusField = z.enum(["backlog", "todo", "in-progress", "blocked", "done"]);
const priorityField = z.enum(["urgent", "high", "medium", "low"]);

const targetWindowSchema = z
	.object({
		kind: z.enum(["week", "month", "quarter"]),
		label: z.string().min(1).max(100),
		year: z.number().int(),
		number: z.number().int(),
	})
	.nullable();

function blockedReasonInvalid(status: string | undefined, blockedReason: string | null | undefined): boolean {
	return status === "blocked" && (!blockedReason || blockedReason.trim().length === 0);
}

const createSchema = z
	.object({
		goalId: z.string().min(1),
		title: titleField,
		body: bodyField.optional(),
		ordinal: z.number().int().nullable().optional(),
		status: statusField.optional(),
		priority: priorityField.optional(),
		impact: z.number().int().min(1).max(100).optional(),
		effort: z.number().int().min(1).max(10).optional(),
		targetWindow: targetWindowSchema.optional(),
		blockedReason: z.string().max(2000).nullable().optional(),
	})
	.superRefine((val, ctx) => {
		if (blockedReasonInvalid(val.status ?? "backlog", val.blockedReason)) {
			ctx.addIssue({
				code: "custom",
				path: ["blockedReason"],
				message: "blockedReason is required and must be non-empty when status is 'blocked'.",
			});
		}
	});

const updateSchema = z
	.object({
		goalId: z.string().min(1).optional(),
		title: titleField.optional(),
		body: bodyField.optional(),
		ordinal: z.number().int().nullable().optional(),
		status: statusField.optional(),
		priority: priorityField.optional(),
		impact: z.number().int().min(1).max(100).optional(),
		effort: z.number().int().min(1).max(10).optional(),
		targetWindow: targetWindowSchema.optional(),
		blockedReason: z.string().max(2000).nullable().optional(),
	})
	.superRefine((val, ctx) => {
		// Only the case fully expressed within this request — status explicitly
		// 'blocked' and blockedReason explicitly emptied — is knowable at parse
		// time. The "stays blocked, reason cleared without re-sending status"
		// case needs the row's current state, and is caught server-side by
		// updateProject().
		if (val.status === "blocked" && val.blockedReason !== undefined && blockedReasonInvalid(val.status, val.blockedReason)) {
			ctx.addIssue({
				code: "custom",
				path: ["blockedReason"],
				message: "blockedReason is required and must be non-empty when status is 'blocked'.",
			});
		}
	});

function parseStatusQuery(raw: string | undefined): ProjectStatus | undefined {
	if (raw === undefined) return undefined;
	const parsed = statusField.safeParse(raw);
	if (!parsed.success) {
		throw new AppError("VALIDATION_ERROR", "status must be one of backlog, todo, in-progress, blocked, done.");
	}
	return parsed.data;
}

const r = new Hono<{ Variables: KumiaiVariables }>();

r.use("*", requireSession, loadTeamAccess);

// GET /api/kumiai/projects?goalId=&status=
r.get("/", async (c) => {
	const teamId = c.get("kumiaiTeamId");
	const goalId = c.req.query("goalId");
	const status = parseStatusQuery(c.req.query("status"));
	return ok(
		c,
		await listProjects(teamId, {
			...(goalId !== undefined && { goalId }),
			...(status !== undefined && { status }),
		}),
	);
});

// GET /api/kumiai/projects/:id
r.get("/:id", async (c) => {
	const teamId = c.get("kumiaiTeamId");
	const id = validateId(c.req.param("id"), "id");
	return ok(c, await getProject(teamId, id));
});

// POST /api/kumiai/projects
r.post("/", zValidator("json", createSchema), async (c) => {
	const teamId = c.get("kumiaiTeamId");
	const input = c.req.valid("json");
	const project = await createProject(teamId, {
		goalId: input.goalId,
		title: input.title,
		...(input.body !== undefined && { body: input.body }),
		...(input.ordinal !== undefined && { ordinal: input.ordinal }),
		...(input.status !== undefined && { status: input.status }),
		...(input.priority !== undefined && { priority: input.priority }),
		...(input.impact !== undefined && { impact: input.impact }),
		...(input.effort !== undefined && { effort: input.effort }),
		...(input.targetWindow !== undefined && { targetWindow: input.targetWindow }),
		...(input.blockedReason !== undefined && { blockedReason: input.blockedReason }),
	});
	return created(c, project);
});

// PATCH /api/kumiai/projects/:id
r.patch("/:id", zValidator("json", updateSchema), async (c) => {
	const teamId = c.get("kumiaiTeamId");
	const id = validateId(c.req.param("id"), "id");
	const input = c.req.valid("json");
	const project = await updateProject(teamId, id, {
		...(input.goalId !== undefined && { goalId: input.goalId }),
		...(input.title !== undefined && { title: input.title }),
		...(input.body !== undefined && { body: input.body }),
		...(input.ordinal !== undefined && { ordinal: input.ordinal }),
		...(input.status !== undefined && { status: input.status }),
		...(input.priority !== undefined && { priority: input.priority }),
		...(input.impact !== undefined && { impact: input.impact }),
		...(input.effort !== undefined && { effort: input.effort }),
		...(input.targetWindow !== undefined && { targetWindow: input.targetWindow }),
		...(input.blockedReason !== undefined && { blockedReason: input.blockedReason }),
	});
	return ok(c, project);
});

// DELETE /api/kumiai/projects/:id
r.delete("/:id", async (c) => {
	const teamId = c.get("kumiaiTeamId");
	const id = validateId(c.req.param("id"), "id");
	await deleteProject(teamId, id);
	return noContent(c);
});

export default r;
