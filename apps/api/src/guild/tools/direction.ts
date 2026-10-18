import { eq, sql } from "drizzle-orm";
import { z } from "zod";
import {
	allocateKey,
	kumiaiGoals,
	kumiaiProjects,
	kumiaiPriorityOf,
	newId,
	GUILD_DIRECTION_STATUSES,
	PROJECT_ISOLATIONS,
} from "@kata/db";
import { actorInput, defineTool, guildWrite, prioInput, workspaceInput, type GuildToolDef } from "../registry.js";
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

export const directionTools: GuildToolDef[] = [createGoal, updateGoal, createProject, updateProject];
