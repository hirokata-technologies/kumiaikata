import { and, asc, eq, inArray, or, sql } from "drizzle-orm";
import { z } from "zod";
import {
	allocateKey,
	kumiaiGoals,
	kumiaiKnowledgeEdge,
	kumiaiProjects,
	kumiaiPriorityOf,
	kumiaiRequirements,
	newId,
	GUILD_DIRECTION_STATUSES,
	PROJECT_ISOLATIONS,
	type GuildTx,
} from "@kata/db";
import {
	GuildError,
	actorInput,
	defineTool,
	guildWrite,
	prioInput,
	workspaceInput,
	type GuildToolDef,
} from "../registry.js";
import { assertExpectedStatus, findByKey, readGuildRow, utcNow } from "../services/work-support.js";

/** Contract §4.3 — goals and projects. */

const directionStatus = z.enum(GUILD_DIRECTION_STATUSES);
const expectDirection = z.union([directionStatus, z.array(directionStatus).min(1)]);
/** A project reads back as `blocked` when Kumiai blocked it, so a guard may name it. */
const projectReadStatus = z.enum([...GUILD_DIRECTION_STATUSES, "blocked"]);
const expectProject = z.union([projectReadStatus, z.array(projectReadStatus).min(1)]);
const keyInput = z.string().min(1);

const createGoal = defineTool({
	name: "create_goal",
	title: "Create goal",
	description: "Create a goal. The server allocates its GOAL-NNN key. Returns the goal.",
	input: z.object({
		workspace: workspaceInput,
		actor: actorInput,
		title: z.string().min(1),
		body: z.string().optional(),
		priority: prioInput.optional(),
		status: directionStatus.optional(),
	}),
	handler: async ({ caller }, input) =>
		guildWrite(caller, input.workspace, input.actor, async (tx) => {
			const key = await allocateKey(tx, input.workspace, "GOAL");
			await tx.insert(kumiaiGoals).values({
				id: newId(),
				teamId: caller.teamId,
				workspaceId: input.workspace,
				key,
				title: input.title,
				body: input.body ?? "",
				status: input.status ?? "todo",
				priority: input.priority ?? 3,
				createdAt: utcNow(),
				updatedAt: utcNow(),
			});
			return readGuildRow(tx, "goal", input.workspace, { id: key });
		}),
});

const updateGoal = defineTool({
	name: "update_goal",
	title: "Update goal",
	description: "Patch a goal: omitted fields keep their value. `expect_status` guards the move (CONFLICT on mismatch).",
	input: z.object({
		expect_status: expectDirection.optional(),
		workspace: workspaceInput,
		actor: actorInput,
		key: keyInput,
		title: z.string().min(1).optional(),
		body: z.string().optional(),
		priority: prioInput.optional(),
		status: directionStatus.optional(),
	}),
	handler: async ({ caller }, input) =>
		guildWrite(caller, input.workspace, input.actor, async (tx) => {
			const row = await findByKey(tx, "kumiai_goals", input.workspace, input.key, { lock: true });
			assertExpectedStatus(`Goal ${input.key}`, String(row["status"]), input.expect_status);
			const patch: Partial<typeof kumiaiGoals.$inferInsert> = {};
			if (input.title !== undefined) patch.title = input.title;
			if (input.body !== undefined) patch.body = input.body;
			if (input.priority !== undefined) patch.priority = input.priority;
			if (input.status !== undefined) patch.status = input.status;
			if (Object.keys(patch).length > 0) await tx.update(kumiaiGoals).set(patch).where(eq(kumiaiGoals.id, row.id));
			return readGuildRow(tx, "goal", input.workspace, { id: input.key });
		}),
});

const projectFields = {
	title: z.string().min(1),
	body: z.string(),
	ordinal: z.number().int().nullable(),
	priority: prioInput,
	status: directionStatus,
	concurrent: z.boolean(),
	isolation: z.enum(PROJECT_ISOLATIONS),
	worktree_path: z.string().min(1).nullable(),
};

const createProject = defineTool({
	name: "create_project",
	title: "Create project",
	description:
		"Create a project under a goal. Omitted `ordinal` means next in the goal; null means unordered. " +
		"Priority 1-5 is stored on Kumiai's four-step scale (5 reads back as 4). Returns the project.",
	input: z.object({
		workspace: workspaceInput,
		actor: actorInput,
		goal: keyInput,
		title: projectFields.title,
		body: projectFields.body.optional(),
		ordinal: projectFields.ordinal.optional(),
		priority: projectFields.priority.optional(),
		status: projectFields.status.optional(),
		concurrent: projectFields.concurrent.optional(),
		isolation: projectFields.isolation.optional(),
		worktree_path: projectFields.worktree_path.optional(),
	}),
	handler: async ({ caller }, input) =>
		guildWrite(caller, input.workspace, input.actor, async (tx) => {
			const goal = await findByKey(tx, "kumiai_goals", input.workspace, input.goal);
			const key = await allocateKey(tx, input.workspace, "PROJ");
			await tx.insert(kumiaiProjects).values({
				id: newId(),
				teamId: caller.teamId,
				workspaceId: input.workspace,
				key,
				goalId: goal.id,
				title: input.title,
				body: input.body ?? "",
				// the guild's `(SELECT COUNT(*)+1 FROM project WHERE goal_id = …)`
				ordinal:
					input.ordinal !== undefined
						? input.ordinal
						: sql`(SELECT count(*)::int + 1 FROM kumiai_projects WHERE goal_id = ${goal.id})`,
				status: input.status ?? "todo",
				priority: kumiaiPriorityOf(input.priority ?? 3),
				impact: 50,
				effort: 5,
				concurrent: input.concurrent ?? false,
				isolation: input.isolation ?? "shared",
				worktreePath: input.worktree_path ?? null,
				createdAt: utcNow(),
				updatedAt: utcNow(),
			});
			return readGuildRow(tx, "project", input.workspace, { id: key });
		}),
});

const updateProject = defineTool({
	name: "update_project",
	title: "Update project",
	description:
		"Patch a project: omitted fields keep their value, null clears `ordinal` / `worktree_path`. " +
		"Set `isolation` and `worktree_path` together. `expect_status` guards the move.",
	input: z.object({
		expect_status: expectProject.optional(),
		workspace: workspaceInput,
		actor: actorInput,
		key: keyInput,
		title: projectFields.title.optional(),
		body: projectFields.body.optional(),
		ordinal: projectFields.ordinal.optional(),
		priority: projectFields.priority.optional(),
		status: projectFields.status.optional(),
		concurrent: projectFields.concurrent.optional(),
		isolation: projectFields.isolation.optional(),
		worktree_path: projectFields.worktree_path.optional(),
	}),
	handler: async ({ caller }, input) =>
		guildWrite(caller, input.workspace, input.actor, async (tx) => {
			const row = await findByKey(tx, "kumiai_projects", input.workspace, input.key, { lock: true });
			// the guild reads Kumiai's `backlog` as `todo`
			const current = row["status"] === "backlog" ? "todo" : String(row["status"]);
			assertExpectedStatus(`Project ${input.key}`, current, input.expect_status);
			const patch: Partial<typeof kumiaiProjects.$inferInsert> = {};
			if (input.title !== undefined) patch.title = input.title;
			if (input.body !== undefined) patch.body = input.body;
			if (input.ordinal !== undefined) patch.ordinal = input.ordinal;
			if (input.priority !== undefined) patch.priority = kumiaiPriorityOf(input.priority);
			// a guild move off a Kumiai `blocked` project clears the Kumiai-only reason with it
			if (input.status !== undefined) {
				patch.status = input.status;
				patch.blockedReason = null;
			}
			if (input.concurrent !== undefined) patch.concurrent = input.concurrent;
			if (input.isolation !== undefined) patch.isolation = input.isolation;
			if (input.worktree_path !== undefined) patch.worktreePath = input.worktree_path;
			if (Object.keys(patch).length > 0) {
				await tx.update(kumiaiProjects).set(patch).where(eq(kumiaiProjects.id, row.id));
			}
			return readGuildRow(tx, "project", input.workspace, { id: input.key });
		}),
});

// ── Deletes ──────────────────────────────────────────────────────────────────

const MAX_DELETE_KEYS = 100;
const keysInput = z.array(keyInput).min(1).max(MAX_DELETE_KEYS);
const cascadeProjectsInput = z
	.boolean()
	.optional()
	.describe("Also delete the goal's projects. Without it a goal that still has projects is CONFLICT.");

/** `keys` once each, in the order given. */
const uniqueKeys = (keys: readonly string[]): string[] => [...new Set(keys)];

/**
 * Knowledge edges name goals and projects by key with no foreign key, so they are removed
 * with the row they name — a left-over edge is a `v_knowledge_dangling` row (invariant G10).
 */
async function dropEdgesOf(tx: GuildTx, workspaceId: string, type: "goal" | "project", keys: string[]) {
	if (keys.length === 0) return;
	await tx
		.delete(kumiaiKnowledgeEdge)
		.where(
			and(
				eq(kumiaiKnowledgeEdge.workspaceId, workspaceId),
				or(
					and(eq(kumiaiKnowledgeEdge.fromType, type), inArray(kumiaiKnowledgeEdge.fromId, keys)),
					and(eq(kumiaiKnowledgeEdge.toType, type), inArray(kumiaiKnowledgeEdge.toId, keys)),
				),
			),
		);
}

/** Every key must exist in the workspace: one NOT_FOUND names all the missing ones. */
function assertAllFound(label: string, wanted: string[], found: string[]): void {
	const have = new Set(found);
	const missing = wanted.filter((k) => !have.has(k));
	if (missing.length > 0) {
		throw new GuildError("NOT_FOUND", `${label} ${missing.join(", ")} not found in this workspace. Nothing was deleted.`);
	}
}

/**
 * Delete projects. A requirement under one is detached, never deleted (its FK is SET NULL):
 * the requirement keeps its plans, tasks and graph and becomes unaffiliated.
 */
async function deleteProjectsTx(tx: GuildTx, workspaceId: string, keys: string[]) {
	const rows = await tx
		.select({ id: kumiaiProjects.id, key: kumiaiProjects.key })
		.from(kumiaiProjects)
		.where(and(eq(kumiaiProjects.workspaceId, workspaceId), inArray(kumiaiProjects.key, keys)))
		.for("update");
	assertAllFound("Project", keys, rows.map((r) => r.key));
	const ids = rows.map((r) => r.id);

	const detached = await tx
		.select({ key: kumiaiRequirements.key })
		.from(kumiaiRequirements)
		.where(and(eq(kumiaiRequirements.workspaceId, workspaceId), inArray(kumiaiRequirements.projectId, ids)))
		.orderBy(asc(kumiaiRequirements.key));

	await dropEdgesOf(tx, workspaceId, "project", keys);
	await tx.delete(kumiaiProjects).where(inArray(kumiaiProjects.id, ids));
	return { deleted: keys, requirements_detached: detached.map((r) => r.key) };
}

/** Delete goals; a goal with projects is CONFLICT unless `cascade` deletes them first. */
async function deleteGoalsTx(tx: GuildTx, workspaceId: string, keys: string[], cascade: boolean) {
	const goals = await tx
		.select({ id: kumiaiGoals.id, key: kumiaiGoals.key })
		.from(kumiaiGoals)
		.where(and(eq(kumiaiGoals.workspaceId, workspaceId), inArray(kumiaiGoals.key, keys)))
		.for("update");
	assertAllFound("Goal", keys, goals.map((g) => g.key));

	const projects = await tx
		.select({ key: kumiaiProjects.key, goalId: kumiaiProjects.goalId })
		.from(kumiaiProjects)
		.where(
			and(
				eq(kumiaiProjects.workspaceId, workspaceId),
				inArray(
					kumiaiProjects.goalId,
					goals.map((g) => g.id),
				),
			),
		)
		.orderBy(asc(kumiaiProjects.key));

	if (projects.length > 0 && !cascade) {
		const keyOf = new Map(goals.map((g) => [g.id, g.key]));
		const owners = [...new Set(projects.map((p) => keyOf.get(p.goalId)))].join(", ");
		throw new GuildError(
			"CONFLICT",
			`Goal ${owners} still has ${projects.length} project(s): ${projects.map((p) => p.key).join(", ")}. ` +
				"Delete the projects first, or pass cascade_projects: true. Nothing was deleted.",
		);
	}

	const cascaded =
		projects.length > 0
			? await deleteProjectsTx(
					tx,
					workspaceId,
					projects.map((p) => p.key),
				)
			: { deleted: [] as string[], requirements_detached: [] as string[] };

	await dropEdgesOf(tx, workspaceId, "goal", keys);
	await tx.delete(kumiaiGoals).where(
		inArray(
			kumiaiGoals.id,
			goals.map((g) => g.id),
		),
	);
	return {
		deleted: keys,
		projects_deleted: cascaded.deleted,
		requirements_detached: cascaded.requirements_detached,
	};
}

const deleteGoal = defineTool({
	name: "delete_goal",
	title: "Delete goal",
	description:
		"Permanently delete one goal. CONFLICT while it still has projects, unless `cascade_projects` is true, " +
		"which deletes them too (their requirements are detached, never deleted). Its knowledge edges go with it. " +
		"Returns the deleted keys and the requirements detached.",
	input: z.object({
		workspace: workspaceInput,
		actor: actorInput,
		key: keyInput,
		cascade_projects: cascadeProjectsInput,
		expect_status: expectDirection.optional(),
	}),
	handler: async ({ caller }, input) =>
		guildWrite(caller, input.workspace, input.actor, async (tx) => {
			if (input.expect_status !== undefined) {
				const row = await findByKey(tx, "kumiai_goals", input.workspace, input.key, { lock: true });
				assertExpectedStatus(`Goal ${input.key}`, String(row["status"]), input.expect_status);
			}
			return deleteGoalsTx(tx, input.workspace, [input.key], input.cascade_projects ?? false);
		}),
});

const deleteGoals = defineTool({
	name: "delete_goals",
	title: "Delete goals",
	description:
		`Permanently delete up to ${MAX_DELETE_KEYS} goals in one transaction: all of them or none. ` +
		"CONFLICT while any still has projects, unless `cascade_projects` is true. NOT_FOUND names every missing key. " +
		"Returns the deleted keys, the projects deleted with them, and the requirements detached.",
	input: z.object({
		workspace: workspaceInput,
		actor: actorInput,
		keys: keysInput,
		cascade_projects: cascadeProjectsInput,
	}),
	handler: async ({ caller }, input) =>
		guildWrite(caller, input.workspace, input.actor, (tx) =>
			deleteGoalsTx(tx, input.workspace, uniqueKeys(input.keys), input.cascade_projects ?? false),
		),
});

const deleteProject = defineTool({
	name: "delete_project",
	title: "Delete project",
	description:
		"Permanently delete one project. Its requirements are detached (they become unaffiliated), never deleted. " +
		"Its knowledge edges go with it. Returns the deleted key and the requirements detached.",
	input: z.object({
		workspace: workspaceInput,
		actor: actorInput,
		key: keyInput,
		expect_status: expectProject.optional(),
	}),
	handler: async ({ caller }, input) =>
		guildWrite(caller, input.workspace, input.actor, async (tx) => {
			if (input.expect_status !== undefined) {
				const row = await findByKey(tx, "kumiai_projects", input.workspace, input.key, { lock: true });
				const current = row["status"] === "backlog" ? "todo" : String(row["status"]);
				assertExpectedStatus(`Project ${input.key}`, current, input.expect_status);
			}
			return deleteProjectsTx(tx, input.workspace, [input.key]);
		}),
});

const deleteProjects = defineTool({
	name: "delete_projects",
	title: "Delete projects",
	description:
		`Permanently delete up to ${MAX_DELETE_KEYS} projects in one transaction: all of them or none. ` +
		"Their requirements are detached, never deleted. NOT_FOUND names every missing key. " +
		"Returns the deleted keys and the requirements detached.",
	input: z.object({ workspace: workspaceInput, actor: actorInput, keys: keysInput }),
	handler: async ({ caller }, input) =>
		guildWrite(caller, input.workspace, input.actor, (tx) =>
			deleteProjectsTx(tx, input.workspace, uniqueKeys(input.keys)),
		),
});

export const directionTools: GuildToolDef[] = [
	createGoal,
	updateGoal,
	deleteGoal,
	deleteGoals,
	createProject,
	updateProject,
	deleteProject,
	deleteProjects,
];
