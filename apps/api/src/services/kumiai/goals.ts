import { eq, and, asc } from "drizzle-orm";
import { db, newId, allocateKey, kumiaiGoals } from "@kata/db";
import { AppError } from "@kata/http";
import { resolveWorkspaceId } from "./workspaces.js";

// ── Serialisation shape ───────────────────────────────────────────────────────

export type GoalStatus = "todo" | "in-progress" | "done";

export interface GoalDetail {
	id: string;
	teamId: string;
	workspaceId: string;
	title: string;
	body: string;
	status: GoalStatus;
	priority: number;
	createdAt: Date;
	updatedAt: Date;
}

function toDetail(row: typeof kumiaiGoals.$inferSelect): GoalDetail {
	return {
		id: row.id,
		teamId: row.teamId,
		workspaceId: row.workspaceId,
		title: row.title,
		body: row.body,
		status: row.status as GoalStatus,
		priority: row.priority,
		createdAt: row.createdAt,
		updatedAt: row.updatedAt,
	};
}

// ── listGoals ─────────────────────────────────────────────────────────────────

/** Every goal in the team, or only those of one workspace when `workspaceId` is given. */
export async function listGoals(
	teamId: string,
	workspaceId?: string | undefined,
): Promise<GoalDetail[]> {
	const scope =
		workspaceId === undefined
			? eq(kumiaiGoals.teamId, teamId)
			: and(
					eq(kumiaiGoals.teamId, teamId),
					eq(kumiaiGoals.workspaceId, await resolveWorkspaceId(teamId, workspaceId)),
				);
	const rows = await db
		.select()
		.from(kumiaiGoals)
		.where(scope)
		.orderBy(asc(kumiaiGoals.priority), asc(kumiaiGoals.title));
	return rows.map(toDetail);
}

// ── getGoal ───────────────────────────────────────────────────────────────────

export async function getGoal(teamId: string, goalId: string): Promise<GoalDetail> {
	const [row] = await db
		.select()
		.from(kumiaiGoals)
		.where(and(eq(kumiaiGoals.id, goalId), eq(kumiaiGoals.teamId, teamId)))
		.limit(1);

	if (!row) {
		throw new AppError("NOT_FOUND", "Goal not found.");
	}

	return toDetail(row);
}

// ── createGoal ────────────────────────────────────────────────────────────────

export interface CreateGoalInput {
	/** The workspace the goal belongs to for good; the team's default when omitted. */
	workspaceId?: string | undefined;
	title: string;
	body?: string | undefined;
	status?: GoalStatus | undefined;
	priority?: number | undefined;
}

export async function createGoal(
	teamId: string,
	input: CreateGoalInput,
): Promise<GoalDetail> {
	const workspaceId = await resolveWorkspaceId(teamId, input.workspaceId);
	const now = new Date();
	const [row] = await db.transaction(async (tx) =>
		tx
			.insert(kumiaiGoals)
			.values({
				id: newId(),
				teamId,
				workspaceId,
				key: await allocateKey(tx, workspaceId, "GOAL"),
				title: input.title,
				body: input.body ?? "",
				status: input.status ?? "todo",
				priority: input.priority ?? 3,
				createdAt: now,
				updatedAt: now,
			})
			.returning(),
	);

	if (!row) {
		throw new AppError("INTERNAL_ERROR", "Goal was created but could not be fetched.");
	}

	return toDetail(row);
}

// ── updateGoal ────────────────────────────────────────────────────────────────

export interface UpdateGoalInput {
	title?: string | undefined;
	body?: string | undefined;
	status?: GoalStatus | undefined;
	priority?: number | undefined;
}

export async function updateGoal(
	teamId: string,
	goalId: string,
	input: UpdateGoalInput,
): Promise<GoalDetail> {
	const patch: Partial<{
		title: string;
		body: string;
		status: GoalStatus;
		priority: number;
		updatedAt: Date;
	}> = { updatedAt: new Date() };

	if (input.title !== undefined) patch.title = input.title;
	if (input.body !== undefined) patch.body = input.body;
	if (input.status !== undefined) patch.status = input.status;
	if (input.priority !== undefined) patch.priority = input.priority;

	const [row] = await db
		.update(kumiaiGoals)
		.set(patch)
		.where(and(eq(kumiaiGoals.id, goalId), eq(kumiaiGoals.teamId, teamId)))
		.returning();

	if (!row) {
		throw new AppError("NOT_FOUND", "Goal not found.");
	}

	return toDetail(row);
}

// ── deleteGoal ────────────────────────────────────────────────────────────────

export async function deleteGoal(teamId: string, goalId: string): Promise<void> {
	const deleted = await db
		.delete(kumiaiGoals)
		.where(and(eq(kumiaiGoals.id, goalId), eq(kumiaiGoals.teamId, teamId)))
		.returning({ id: kumiaiGoals.id });

	if (deleted.length === 0) {
		throw new AppError("NOT_FOUND", "Goal not found.");
	}
}
