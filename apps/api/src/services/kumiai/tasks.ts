import { eq, and, asc } from "drizzle-orm";
import { db, newId, kumiaiTasks, kumiaiRequirements, kumiaiPlans } from "@kata/db";
import { AppError } from "@kata/http";

// ── Serialisation shape ───────────────────────────────────────────────────────

export type TaskStatus = "todo" | "in-progress" | "done" | "failed" | "blocked" | "waived";

export interface TaskDetail {
	id: string;
	teamId: string;
	requirementId: string;
	planId: string | null;
	title: string;
	objective: string;
	body: string;
	status: TaskStatus;
	priority: number;
	createdAt: Date;
	updatedAt: Date;
}

function toDetail(row: typeof kumiaiTasks.$inferSelect): TaskDetail {
	return {
		id: row.id,
		teamId: row.teamId,
		requirementId: row.requirementId,
		planId: row.planId,
		title: row.title,
		objective: row.objective,
		body: row.body,
		status: row.status as TaskStatus,
		priority: row.priority,
		createdAt: row.createdAt,
		updatedAt: row.updatedAt,
	};
}

async function assertRequirementInTeam(teamId: string, requirementId: string): Promise<void> {
	const [requirement] = await db
		.select({ id: kumiaiRequirements.id })
		.from(kumiaiRequirements)
		.where(and(eq(kumiaiRequirements.id, requirementId), eq(kumiaiRequirements.teamId, teamId)))
		.limit(1);
	if (!requirement) {
		throw new AppError("NOT_FOUND", "Requirement not found.");
	}
}

async function assertPlanInTeam(teamId: string, planId: string): Promise<void> {
	const [plan] = await db
		.select({ id: kumiaiPlans.id })
		.from(kumiaiPlans)
		.where(and(eq(kumiaiPlans.id, planId), eq(kumiaiPlans.teamId, teamId)))
		.limit(1);
	if (!plan) {
		throw new AppError("NOT_FOUND", "Plan not found.");
	}
}

// ── listTasks ─────────────────────────────────────────────────────────────────

export async function listTasks(teamId: string): Promise<TaskDetail[]> {
	const rows = await db
		.select()
		.from(kumiaiTasks)
		.where(eq(kumiaiTasks.teamId, teamId))
		.orderBy(asc(kumiaiTasks.priority), asc(kumiaiTasks.title));
	return rows.map(toDetail);
}

// ── getTask ───────────────────────────────────────────────────────────────────

export async function getTask(teamId: string, taskId: string): Promise<TaskDetail> {
	const [row] = await db
		.select()
		.from(kumiaiTasks)
		.where(and(eq(kumiaiTasks.id, taskId), eq(kumiaiTasks.teamId, teamId)))
		.limit(1);

	if (!row) {
		throw new AppError("NOT_FOUND", "Task not found.");
	}

	return toDetail(row);
}

// ── createTask ────────────────────────────────────────────────────────────────

export interface CreateTaskInput {
	requirementId: string;
	planId?: string | null | undefined;
	title: string;
	objective?: string | undefined;
	body?: string | undefined;
	status?: TaskStatus | undefined;
	priority?: number | undefined;
}

export async function createTask(
	teamId: string,
	input: CreateTaskInput,
): Promise<TaskDetail> {
	await assertRequirementInTeam(teamId, input.requirementId);
	if (input.planId) {
		await assertPlanInTeam(teamId, input.planId);
	}

	const now = new Date();
	const [row] = await db
		.insert(kumiaiTasks)
		.values({
			id: newId(),
			teamId,
			requirementId: input.requirementId,
			planId: input.planId ?? null,
			title: input.title,
			objective: input.objective ?? "",
			body: input.body ?? "",
			status: input.status ?? "todo",
			priority: input.priority ?? 3,
			createdAt: now,
			updatedAt: now,
		})
		.returning();

	if (!row) {
		throw new AppError("INTERNAL_ERROR", "Task was created but could not be fetched.");
	}

	return toDetail(row);
}

// ── updateTask ────────────────────────────────────────────────────────────────

export interface UpdateTaskInput {
	requirementId?: string | undefined;
	planId?: string | null | undefined;
	title?: string | undefined;
	objective?: string | undefined;
	body?: string | undefined;
	status?: TaskStatus | undefined;
	priority?: number | undefined;
}

export async function updateTask(
	teamId: string,
	taskId: string,
	input: UpdateTaskInput,
): Promise<TaskDetail> {
	if (input.requirementId !== undefined) {
		await assertRequirementInTeam(teamId, input.requirementId);
	}
	if (input.planId) {
		await assertPlanInTeam(teamId, input.planId);
	}

	const patch: Partial<typeof kumiaiTasks.$inferInsert> = { updatedAt: new Date() };
	if (input.requirementId !== undefined) patch.requirementId = input.requirementId;
	if (input.planId !== undefined) patch.planId = input.planId;
	if (input.title !== undefined) patch.title = input.title;
	if (input.objective !== undefined) patch.objective = input.objective;
	if (input.body !== undefined) patch.body = input.body;
	if (input.status !== undefined) patch.status = input.status;
	if (input.priority !== undefined) patch.priority = input.priority;

	const [row] = await db
		.update(kumiaiTasks)
		.set(patch)
		.where(and(eq(kumiaiTasks.id, taskId), eq(kumiaiTasks.teamId, teamId)))
		.returning();

	if (!row) {
		throw new AppError("NOT_FOUND", "Task not found.");
	}

	return toDetail(row);
}

// ── deleteTask ────────────────────────────────────────────────────────────────

export async function deleteTask(teamId: string, taskId: string): Promise<void> {
	const deleted = await db
		.delete(kumiaiTasks)
		.where(and(eq(kumiaiTasks.id, taskId), eq(kumiaiTasks.teamId, teamId)))
		.returning({ id: kumiaiTasks.id });

	if (deleted.length === 0) {
		throw new AppError("NOT_FOUND", "Task not found.");
	}
}
