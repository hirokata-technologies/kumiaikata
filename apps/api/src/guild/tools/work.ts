import { and, eq } from "drizzle-orm";
import type { PgUpdateSetSource } from "drizzle-orm/pg-core";
import { z } from "zod";
import {
	allocateKey,
	kumiaiPlans,
	kumiaiRequirements,
	kumiaiTaskCapability,
	kumiaiTaskDependency,
	kumiaiTasks,
	kumiaiWorkLog,
	newId,
	GUILD_DIRECTION_STATUSES,
	PLAN_APPROVALS,
	TASK_STATUSES,
	type GuildTx,
} from "@kata/db";
import {
	actorInput,
	defineTool,
	GuildError,
	guildWrite,
	prioInput,
	workspaceInput,
	type GuildToolDef,
} from "../registry.js";
import {
	assertExpectedStatus,
	findByKey,
	readGuildRow,
	readTask,
	resolveOptionalKey,
	utcClock,
	utcNow,
} from "../services/work-support.js";
import { claimTask } from "../services/work-claim.js";

/** Contract §4.4 — requirements, plans, tasks. */

const directionStatus = z.enum(GUILD_DIRECTION_STATUSES);
const expectDirection = z.union([directionStatus, z.array(directionStatus).min(1)]);
const taskStatus = z.enum(TASK_STATUSES);
const expectTask = z.union([taskStatus, z.array(taskStatus).min(1)]);
const keyInput = z.string().min(1);
const capabilitiesInput = z.array(
	z.object({ capability: z.string().min(1).max(64), required: z.boolean().optional() }),
);

// ── requirements ─────────────────────────────────────────────────────────────

const createRequirement = defineTool({
	name: "create_requirement",
	title: "Create requirement",
	description:
		"Create a requirement. `project` null or omitted is unaffiliated work (still in this workspace). Returns the requirement.",
	input: z.object({
		workspace: workspaceInput,
		actor: actorInput,
		title: z.string().min(1),
		body: z.string().optional(),
		project: keyInput.nullable().optional(),
		priority: prioInput.optional(),
		status: directionStatus.optional(),
	}),
	handler: async ({ caller }, input) =>
		guildWrite(caller, input.workspace, input.actor, async (tx) => {
			const projectId = await resolveOptionalKey(tx, "kumiai_projects", input.workspace, input.project);
			const key = await allocateKey(tx, input.workspace, "REQ");
			await tx.insert(kumiaiRequirements).values({
				id: newId(),
				teamId: caller.teamId,
				workspaceId: input.workspace,
				key,
				projectId: projectId ?? null,
				title: input.title,
				body: input.body ?? "",
				status: input.status ?? "todo",
				priority: input.priority ?? 3,
				createdAt: utcNow(),
				updatedAt: utcNow(),
			});
			return readGuildRow(tx, "requirement", input.workspace, { id: key });
		}),
});

const updateRequirement = defineTool({
	name: "update_requirement",
	title: "Update requirement",
	description:
		"Patch a requirement: omitted fields keep their value, `project: null` detaches it. `expect_status` guards the move.",
	input: z.object({
		expect_status: expectDirection.optional(),
		workspace: workspaceInput,
		actor: actorInput,
		key: keyInput,
		title: z.string().min(1).optional(),
		body: z.string().optional(),
		project: keyInput.nullable().optional(),
		priority: prioInput.optional(),
		status: directionStatus.optional(),
	}),
	handler: async ({ caller }, input) =>
		guildWrite(caller, input.workspace, input.actor, async (tx) => {
			const row = await findByKey(tx, "kumiai_requirements", input.workspace, input.key, { lock: true });
			assertExpectedStatus(`Requirement ${input.key}`, String(row["status"]), input.expect_status);
			const patch: Partial<typeof kumiaiRequirements.$inferInsert> = {};
			if (input.title !== undefined) patch.title = input.title;
			if (input.body !== undefined) patch.body = input.body;
			if (input.project !== undefined) {
				patch.projectId = (await resolveOptionalKey(tx, "kumiai_projects", input.workspace, input.project)) ?? null;
			}
			if (input.priority !== undefined) patch.priority = input.priority;
			if (input.status !== undefined) patch.status = input.status;
			if (Object.keys(patch).length > 0) {
				await tx.update(kumiaiRequirements).set(patch).where(eq(kumiaiRequirements.id, row.id));
			}
			return readGuildRow(tx, "requirement", input.workspace, { id: input.key });
		}),
});

// ── plans ────────────────────────────────────────────────────────────────────

const createPlan = defineTool({
	name: "create_plan",
	title: "Create plan",
	description:
		"Create a plan for a requirement (`task` makes it a plan written for one ticket). Starts `approval = 'pending'`. Returns the plan.",
	input: z.object({
		workspace: workspaceInput,
		actor: actorInput,
		requirement: keyInput,
		title: z.string().min(1),
		body: z.string().optional(),
		task: keyInput.optional(),
		status: directionStatus.optional(),
		gate_node_id: keyInput.optional().describe("A graph node id, e.g. REQ-001/gate-plan"),
	}),
	handler: async ({ caller }, input) =>
		guildWrite(caller, input.workspace, input.actor, async (tx) => {
			const requirement = await findByKey(tx, "kumiai_requirements", input.workspace, input.requirement);
			const taskId = await resolveOptionalKey(tx, "kumiai_tasks", input.workspace, input.task);
			const gateNodeId = await resolveOptionalKey(tx, "kumiai_graph_node", input.workspace, input.gate_node_id);
			const key = await allocateKey(tx, input.workspace, "PLAN");
			await tx.insert(kumiaiPlans).values({
				id: newId(),
				teamId: caller.teamId,
				workspaceId: input.workspace,
				key,
				requirementId: requirement.id,
				taskId: taskId ?? null,
				title: input.title,
				body: input.body ?? "",
				status: input.status ?? "todo",
				approval: "pending",
				gateNodeId: gateNodeId ?? null,
				createdAt: utcNow(),
				updatedAt: utcNow(),
			});
			return readGuildRow(tx, "plan", input.workspace, { id: key });
		}),
});

const updatePlan = defineTool({
	name: "update_plan",
	title: "Update plan",
	description:
		"Patch a plan. `status` (is it written) and `approval` (did the user say yes) move separately; a ruling stamps `approved_at`. " +
		"A gated plan is approved with resolve_gate. `expect_status` guards `status`.",
	input: z.object({
		expect_status: expectDirection.optional(),
		workspace: workspaceInput,
		actor: actorInput,
		key: keyInput,
		title: z.string().min(1).optional(),
		body: z.string().optional(),
		status: directionStatus.optional(),
		approval: z.enum(PLAN_APPROVALS).optional(),
		approved_by: z.string().min(1).nullable().optional(),
		gate_node_id: keyInput.nullable().optional(),
	}),
	handler: async ({ caller }, input) =>
		guildWrite(caller, input.workspace, input.actor, async (tx) => {
			const row = await findByKey(tx, "kumiai_plans", input.workspace, input.key, { lock: true });
			assertExpectedStatus(`Plan ${input.key}`, String(row["status"]), input.expect_status);
			const patch: PgUpdateSetSource<typeof kumiaiPlans> = {};
			if (input.title !== undefined) patch.title = input.title;
			if (input.body !== undefined) patch.body = input.body;
			if (input.status !== undefined) patch.status = input.status;
			if (input.approved_by !== undefined) patch.approvedBy = input.approved_by;
			if (input.approval !== undefined && input.approval !== row["approval"]) {
				patch.approval = input.approval;
				// a ruling is stamped; going back to pending un-stamps it
				patch.approvedAt = input.approval === "pending" ? null : utcNow();
			}
			if (input.gate_node_id !== undefined) {
				patch.gateNodeId =
					(await resolveOptionalKey(tx, "kumiai_graph_node", input.workspace, input.gate_node_id)) ?? null;
			}
			if (Object.keys(patch).length > 0) await tx.update(kumiaiPlans).set(patch).where(eq(kumiaiPlans.id, row.id));
			return readGuildRow(tx, "plan", input.workspace, { id: input.key });
		}),
});

// ── tasks ────────────────────────────────────────────────────────────────────

async function insertCapabilities(
	tx: GuildTx,
	teamId: string,
	workspaceId: string,
	taskId: string,
	capabilities: readonly { capability: string; required?: boolean | undefined }[],
): Promise<void> {
	const seen = new Set<string>();
	for (const c of capabilities) {
		if (seen.has(c.capability)) throw new GuildError("VALIDATION", `Capability '${c.capability}' is listed twice.`);
		seen.add(c.capability);
	}
	if (capabilities.length === 0) return;
	await tx.insert(kumiaiTaskCapability).values(
		capabilities.map((c) => ({
			teamId,
			workspaceId,
			taskId,
			capability: c.capability,
			required: c.required ?? true,
		})),
	);
}

const createTask = defineTool({
	name: "create_task",
	title: "Create task",
	description:
		"Create a task with its capabilities and dependencies, atomically. Leave `agent` out to let the dispatcher match; set it only to pin. " +
		"Returns the task with `capabilities` and `depends_on`.",
	input: z.object({
		workspace: workspaceInput,
		actor: actorInput,
		requirement: keyInput,
		title: z.string().min(1),
		objective: z.string().optional(),
		body: z.string().optional(),
		plan: keyInput.optional(),
		files: z.array(z.string()).optional(),
		parallel_group: z.string().min(1).optional(),
		node_key: z.string().min(1).optional(),
		priority: prioInput.optional(),
		agent: z.string().min(1).optional(),
		status: taskStatus.optional(),
		capabilities: capabilitiesInput.optional(),
		depends_on: z.array(keyInput).optional(),
	}),
	handler: async ({ caller }, input) =>
		guildWrite(caller, input.workspace, input.actor, async (tx) => {
			const requirement = await findByKey(tx, "kumiai_requirements", input.workspace, input.requirement);
			const planId = await resolveOptionalKey(tx, "kumiai_plans", input.workspace, input.plan);
			const dependsOn: string[] = [];
			for (const depKey of new Set(input.depends_on ?? [])) {
				dependsOn.push((await findByKey(tx, "kumiai_tasks", input.workspace, depKey)).id);
			}
			const id = newId();
			const key = await allocateKey(tx, input.workspace, "TASK");
			await tx.insert(kumiaiTasks).values({
				id,
				teamId: caller.teamId,
				workspaceId: input.workspace,
				key,
				requirementId: requirement.id,
				planId: planId ?? null,
				files: input.files ?? [],
				parallelGroup: input.parallel_group ?? null,
				nodeKey: input.node_key ?? null,
				title: input.title,
				objective: input.objective ?? "",
				body: input.body ?? "",
				status: input.status ?? "todo",
				priority: input.priority ?? 3,
				agent: input.agent ?? null,
				createdAt: utcNow(),
				updatedAt: utcNow(),
			});
			await insertCapabilities(tx, caller.teamId, input.workspace, id, input.capabilities ?? []);
			if (dependsOn.length > 0) {
				await tx
					.insert(kumiaiTaskDependency)
					.values(dependsOn.map((d) => ({ teamId: caller.teamId, workspaceId: input.workspace, taskId: id, dependsOn: d })));
			}
			return readTask(tx, input.workspace, key);
		}),
});

const updateTask = defineTool({
	name: "update_task",
	title: "Update task",
	description:
		"Patch a task's content: omitted fields keep their value, null clears a nullable one (`plan`, `parallel_group`, `node_key`, `agent`). " +
		"Status moves go through set_task_status.",
	input: z.object({
		workspace: workspaceInput,
		actor: actorInput,
		key: keyInput,
		title: z.string().min(1).optional(),
		objective: z.string().optional(),
		body: z.string().optional(),
		files: z.array(z.string()).optional(),
		parallel_group: z.string().min(1).nullable().optional(),
		node_key: z.string().min(1).nullable().optional(),
		priority: prioInput.optional(),
		agent: z.string().min(1).nullable().optional(),
		plan: keyInput.nullable().optional(),
	}),
	handler: async ({ caller }, input) =>
		guildWrite(caller, input.workspace, input.actor, async (tx) => {
			const row = await findByKey(tx, "kumiai_tasks", input.workspace, input.key, { lock: true });
			const patch: Partial<typeof kumiaiTasks.$inferInsert> = {};
			if (input.title !== undefined) patch.title = input.title;
			if (input.objective !== undefined) patch.objective = input.objective;
			if (input.body !== undefined) patch.body = input.body;
			if (input.files !== undefined) patch.files = input.files;
			if (input.parallel_group !== undefined) patch.parallelGroup = input.parallel_group;
			if (input.node_key !== undefined) patch.nodeKey = input.node_key;
			if (input.priority !== undefined) patch.priority = input.priority;
			if (input.agent !== undefined) patch.agent = input.agent;
			if (input.plan !== undefined) {
				patch.planId = (await resolveOptionalKey(tx, "kumiai_plans", input.workspace, input.plan)) ?? null;
			}
			if (Object.keys(patch).length > 0) await tx.update(kumiaiTasks).set(patch).where(eq(kumiaiTasks.id, row.id));
			return readTask(tx, input.workspace, input.key);
		}),
});

const setTaskStatus = defineTool({
	name: "set_task_status",
	title: "Set task status",
	description:
		"Move a task. `expect_status` is the guard (CONFLICT, nothing written). `in-progress` claims an unclaimed task for " +
		"`claimed_by` (default: actor) at now; `claimed_by: null` clears the claim. `reason` is written to work_log — " +
		"do not pass it on a dispatch move. The event's actor is always `actor`.",
	input: z.object({
		workspace: workspaceInput,
		actor: actorInput,
		key: keyInput,
		status: taskStatus,
		expect_status: expectTask.optional(),
		claimed_by: z.string().trim().min(1).max(64).nullable().optional(),
		reason: z.string().min(1).optional(),
	}),
	handler: async ({ caller }, input) =>
		guildWrite(caller, input.workspace, input.actor, async (tx) => {
			const row = await findByKey(tx, "kumiai_tasks", input.workspace, input.key, { lock: true });
			assertExpectedStatus(`Task ${input.key}`, String(row["status"]), input.expect_status);
			const currentClaim = (row["claimed_by"] as string | null) ?? null;
			const patch: PgUpdateSetSource<typeof kumiaiTasks> = { status: input.status };
			if (input.claimed_by === null) {
				patch.claimedBy = null;
				patch.claimedAt = null;
			} else if (input.claimed_by !== undefined && input.claimed_by !== currentClaim) {
				patch.claimedBy = input.claimed_by;
				patch.claimedAt = utcNow();
			} else if (input.status === "in-progress" && currentClaim === null) {
				patch.claimedBy = input.claimed_by ?? input.actor;
				patch.claimedAt = utcNow();
			}
			await tx.update(kumiaiTasks).set(patch).where(eq(kumiaiTasks.id, row.id));
			if (input.reason !== undefined) {
				await tx.insert(kumiaiWorkLog).values({
					teamId: caller.teamId,
					workspaceId: input.workspace,
					taskId: row.id,
					ts: utcClock(),
					agent: input.actor,
					entry: input.reason,
				});
			}
			return readTask(tx, input.workspace, input.key);
		}),
});

const claimTaskTool = defineTool({
	name: "claim_task",
	title: "Claim task",
	description:
		"Claim a task for `claimant` (default: actor); the move is attributed to `actor`. With no `key`, claims v_next_task's " +
		"row (resume-first, exactly like the view). Concurrency-safe: two claims never take the same task. " +
		"Returns `{task}`, null when nothing is claimable.",
	input: z.object({
		workspace: workspaceInput,
		actor: actorInput,
		key: keyInput.optional(),
		claimant: z.string().trim().min(1).max(64).optional(),
	}),
	handler: async ({ caller }, input) =>
		guildWrite(caller, input.workspace, input.actor, async (tx) => ({
			task: await claimTask(tx, {
				workspaceId: input.workspace,
				key: input.key,
				claimant: input.claimant ?? input.actor,
			}),
		})),
});

const dependencyInput = z.object({
	workspace: workspaceInput,
	actor: actorInput,
	task: keyInput,
	depends_on: keyInput,
});

const addTaskDependency = defineTool({
	name: "add_task_dependency",
	title: "Add task dependency",
	description: "Make `task` depend directly on `depends_on`. Idempotent. Returns the task with its `depends_on`.",
	input: dependencyInput,
	handler: async ({ caller }, input) =>
		guildWrite(caller, input.workspace, input.actor, async (tx) => {
			const task = await findByKey(tx, "kumiai_tasks", input.workspace, input.task);
			const dep = await findByKey(tx, "kumiai_tasks", input.workspace, input.depends_on);
			if (task.id === dep.id) throw new GuildError("VALIDATION", "A task cannot depend on itself.");
			await tx
				.insert(kumiaiTaskDependency)
				.values({ teamId: caller.teamId, workspaceId: input.workspace, taskId: task.id, dependsOn: dep.id })
				.onConflictDoNothing();
			return readTask(tx, input.workspace, input.task);
		}),
});

const removeTaskDependency = defineTool({
	name: "remove_task_dependency",
	title: "Remove task dependency",
	description: "Remove a direct dependency (NOT_FOUND when there is none). Returns the task with its `depends_on`.",
	input: dependencyInput,
	handler: async ({ caller }, input) =>
		guildWrite(caller, input.workspace, input.actor, async (tx) => {
			const task = await findByKey(tx, "kumiai_tasks", input.workspace, input.task);
			const dep = await findByKey(tx, "kumiai_tasks", input.workspace, input.depends_on);
			const removed = await tx
				.delete(kumiaiTaskDependency)
				.where(and(eq(kumiaiTaskDependency.taskId, task.id), eq(kumiaiTaskDependency.dependsOn, dep.id)))
				.returning({ taskId: kumiaiTaskDependency.taskId });
			if (removed.length === 0) {
				throw new GuildError("NOT_FOUND", `${input.task} does not depend on ${input.depends_on}.`);
			}
			return readTask(tx, input.workspace, input.task);
		}),
});

const setTaskCapabilities = defineTool({
	name: "set_task_capabilities",
	title: "Set task capabilities",
	description:
		"Replace a task's capability set (pass every row to keep). `required` defaults to true; false means preferred (rank only).",
	input: z.object({
		workspace: workspaceInput,
		actor: actorInput,
		task: keyInput,
		capabilities: capabilitiesInput,
	}),
	handler: async ({ caller }, input) =>
		guildWrite(caller, input.workspace, input.actor, async (tx) => {
			const task = await findByKey(tx, "kumiai_tasks", input.workspace, input.task, { lock: true });
			await tx.delete(kumiaiTaskCapability).where(eq(kumiaiTaskCapability.taskId, task.id));
			await insertCapabilities(tx, caller.teamId, input.workspace, task.id, input.capabilities);
			return readTask(tx, input.workspace, input.task);
		}),
});

const logWork = defineTool({
	name: "log_work",
	title: "Log work",
	description:
		"Append a work_log line to a task; its `agent` is the actor. A waiver is an entry beginning exactly `Skipped by user`.",
	input: z.object({
		workspace: workspaceInput,
		actor: actorInput,
		task: keyInput,
		entry: z.string().min(1),
	}),
	handler: async ({ caller }, input) =>
		guildWrite(caller, input.workspace, input.actor, async (tx) => {
			const task = await findByKey(tx, "kumiai_tasks", input.workspace, input.task);
			const [inserted] = await tx
				.insert(kumiaiWorkLog)
				.values({
					teamId: caller.teamId,
					workspaceId: input.workspace,
					taskId: task.id,
					ts: utcClock(),
					agent: input.actor,
					entry: input.entry,
				})
				.returning({ id: kumiaiWorkLog.id });
			if (!inserted) throw new Error("work_log insert returned no row");
			return readGuildRow(tx, "work_log", input.workspace, { id: inserted.id });
		}),
});

export const workTools: GuildToolDef[] = [
	createRequirement,
	updateRequirement,
	createPlan,
	updatePlan,
	createTask,
	updateTask,
	setTaskStatus,
	claimTaskTool,
	addTaskDependency,
	removeTaskDependency,
	setTaskCapabilities,
	logWork,
];
