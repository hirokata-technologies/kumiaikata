import { eq, and, asc } from "drizzle-orm";
import { db, newId, kumiaiPlans, kumiaiRequirements, kumiaiTasks } from "@kata/db";
import { AppError } from "@kata/http";

// ── Serialisation shape ───────────────────────────────────────────────────────

export type PlanStatus = "todo" | "in-progress" | "done";
export type PlanApproval = "pending" | "approved" | "rejected";

export interface PlanDetail {
	id: string;
	teamId: string;
	requirementId: string;
	taskId: string | null;
	title: string;
	body: string;
	status: PlanStatus;
	approval: PlanApproval;
	approvedBy: string | null;
	approvedAt: Date | null;
	createdAt: Date;
	updatedAt: Date;
}

function toDetail(row: typeof kumiaiPlans.$inferSelect): PlanDetail {
	return {
		id: row.id,
		teamId: row.teamId,
		requirementId: row.requirementId,
		taskId: row.taskId,
		title: row.title,
		body: row.body,
		status: row.status as PlanStatus,
		approval: row.approval as PlanApproval,
		approvedBy: row.approvedBy,
		approvedAt: row.approvedAt,
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

async function assertTaskInTeam(teamId: string, taskId: string): Promise<void> {
	const [task] = await db
		.select({ id: kumiaiTasks.id })
		.from(kumiaiTasks)
		.where(and(eq(kumiaiTasks.id, taskId), eq(kumiaiTasks.teamId, teamId)))
		.limit(1);
	if (!task) {
		throw new AppError("NOT_FOUND", "Task not found.");
	}
}

// ── listPlans ─────────────────────────────────────────────────────────────────

export async function listPlans(teamId: string): Promise<PlanDetail[]> {
	const rows = await db
		.select()
		.from(kumiaiPlans)
		.where(eq(kumiaiPlans.teamId, teamId))
		.orderBy(asc(kumiaiPlans.title));
	return rows.map(toDetail);
}

// ── getPlan ───────────────────────────────────────────────────────────────────

export async function getPlan(teamId: string, planId: string): Promise<PlanDetail> {
	const [row] = await db
		.select()
		.from(kumiaiPlans)
		.where(and(eq(kumiaiPlans.id, planId), eq(kumiaiPlans.teamId, teamId)))
		.limit(1);

	if (!row) {
		throw new AppError("NOT_FOUND", "Plan not found.");
	}

	return toDetail(row);
}

// ── createPlan ────────────────────────────────────────────────────────────────

export interface CreatePlanInput {
	requirementId: string;
	taskId?: string | null | undefined;
	title: string;
	body?: string | undefined;
	status?: PlanStatus | undefined;
	approval?: PlanApproval | undefined;
	approvedBy?: string | null | undefined;
	approvedAt?: string | null | undefined;
}

export async function createPlan(
	teamId: string,
	input: CreatePlanInput,
): Promise<PlanDetail> {
	await assertRequirementInTeam(teamId, input.requirementId);
	if (input.taskId) {
		await assertTaskInTeam(teamId, input.taskId);
	}

	const now = new Date();
	const [row] = await db
		.insert(kumiaiPlans)
		.values({
			id: newId(),
			teamId,
			requirementId: input.requirementId,
			taskId: input.taskId ?? null,
			title: input.title,
			body: input.body ?? "",
			status: input.status ?? "todo",
			approval: input.approval ?? "pending",
			approvedBy: input.approvedBy ?? null,
			approvedAt: input.approvedAt ? new Date(input.approvedAt) : null,
			createdAt: now,
			updatedAt: now,
		})
		.returning();

	if (!row) {
		throw new AppError("INTERNAL_ERROR", "Plan was created but could not be fetched.");
	}

	return toDetail(row);
}

// ── updatePlan ────────────────────────────────────────────────────────────────

export interface UpdatePlanInput {
	requirementId?: string | undefined;
	taskId?: string | null | undefined;
	title?: string | undefined;
	body?: string | undefined;
	status?: PlanStatus | undefined;
	approval?: PlanApproval | undefined;
	approvedBy?: string | null | undefined;
	approvedAt?: string | null | undefined;
}

export async function updatePlan(
	teamId: string,
	planId: string,
	input: UpdatePlanInput,
): Promise<PlanDetail> {
	if (input.requirementId !== undefined) {
		await assertRequirementInTeam(teamId, input.requirementId);
	}
	if (input.taskId) {
		await assertTaskInTeam(teamId, input.taskId);
	}

	const patch: Partial<typeof kumiaiPlans.$inferInsert> = { updatedAt: new Date() };
	if (input.requirementId !== undefined) patch.requirementId = input.requirementId;
	if (input.taskId !== undefined) patch.taskId = input.taskId;
	if (input.title !== undefined) patch.title = input.title;
	if (input.body !== undefined) patch.body = input.body;
	if (input.status !== undefined) patch.status = input.status;
	if (input.approval !== undefined) patch.approval = input.approval;
	if (input.approvedBy !== undefined) patch.approvedBy = input.approvedBy;
	if (input.approvedAt !== undefined) {
		patch.approvedAt = input.approvedAt ? new Date(input.approvedAt) : null;
	}

	const [row] = await db
		.update(kumiaiPlans)
		.set(patch)
		.where(and(eq(kumiaiPlans.id, planId), eq(kumiaiPlans.teamId, teamId)))
		.returning();

	if (!row) {
		throw new AppError("NOT_FOUND", "Plan not found.");
	}

	return toDetail(row);
}

// ── deletePlan ────────────────────────────────────────────────────────────────

export async function deletePlan(teamId: string, planId: string): Promise<void> {
	const deleted = await db
		.delete(kumiaiPlans)
		.where(and(eq(kumiaiPlans.id, planId), eq(kumiaiPlans.teamId, teamId)))
		.returning({ id: kumiaiPlans.id });

	if (deleted.length === 0) {
		throw new AppError("NOT_FOUND", "Plan not found.");
	}
}
