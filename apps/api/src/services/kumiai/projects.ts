import { eq, and, asc } from "drizzle-orm";
import { db, newId, allocateKey, kumiaiProjects, kumiaiGoals } from "@kata/db";
import { AppError } from "@kata/http";
import { assertSameWorkspace } from "./guild-scope.js";

// ── Serialisation shape ───────────────────────────────────────────────────────

export type ProjectStatus = "backlog" | "todo" | "in-progress" | "blocked" | "done";
export type ProjectPriority = "urgent" | "high" | "medium" | "low";
export type TargetWindowKind = "week" | "month" | "quarter";

export interface TargetWindow {
	kind: TargetWindowKind;
	label: string;
	year: number;
	number: number;
}

export interface ProjectDetail {
	id: string;
	teamId: string;
	goalId: string;
	title: string;
	body: string;
	ordinal: number | null;
	status: ProjectStatus;
	priority: ProjectPriority;
	impact: number;
	effort: number;
	targetWindow: TargetWindow | null;
	blockedReason: string | null;
	createdAt: Date;
	updatedAt: Date;
}

function toDetail(row: typeof kumiaiProjects.$inferSelect): ProjectDetail {
	const targetWindow: TargetWindow | null =
		row.targetWindowKind !== null &&
		row.targetWindowLabel !== null &&
		row.targetWindowYear !== null &&
		row.targetWindowNumber !== null
			? {
					kind: row.targetWindowKind as TargetWindowKind,
					label: row.targetWindowLabel,
					year: row.targetWindowYear,
					number: row.targetWindowNumber,
				}
			: null;

	return {
		id: row.id,
		teamId: row.teamId,
		goalId: row.goalId,
		title: row.title,
		body: row.body,
		ordinal: row.ordinal,
		status: row.status as ProjectStatus,
		priority: row.priority as ProjectPriority,
		impact: row.impact,
		effort: row.effort,
		targetWindow,
		blockedReason: row.blockedReason,
		createdAt: row.createdAt,
		updatedAt: row.updatedAt,
	};
}

/**
 * The blocked-reason CHECK constraint, applied server-side so the caller gets
 * a clean 422 instead of a raw Postgres constraint violation. `resolvedStatus`
 * and `resolvedReason` must already have PATCH's "undefined means unchanged"
 * semantics folded in by the caller.
 */
function assertBlockedReasonValid(
	resolvedStatus: ProjectStatus,
	resolvedReason: string | null,
): void {
	if (resolvedStatus === "blocked" && (!resolvedReason || resolvedReason.trim().length === 0)) {
		throw new AppError(
			"VALIDATION_ERROR",
			"blockedReason is required and must be non-empty when status is 'blocked'.",
		);
	}
}

/** Returns the goal's workspace, which its projects share. */
async function assertGoalInTeam(teamId: string, goalId: string): Promise<string> {
	const [goal] = await db
		.select({ id: kumiaiGoals.id, workspaceId: kumiaiGoals.workspaceId })
		.from(kumiaiGoals)
		.where(and(eq(kumiaiGoals.id, goalId), eq(kumiaiGoals.teamId, teamId)))
		.limit(1);
	if (!goal) {
		throw new AppError("NOT_FOUND", "Goal not found.");
	}
	return goal.workspaceId;
}

// ── listProjects ──────────────────────────────────────────────────────────────

export async function listProjects(
	teamId: string,
	filters?: { goalId?: string | undefined; status?: ProjectStatus | undefined },
): Promise<ProjectDetail[]> {
	const conditions = [eq(kumiaiProjects.teamId, teamId)];
	if (filters?.goalId !== undefined) conditions.push(eq(kumiaiProjects.goalId, filters.goalId));
	if (filters?.status !== undefined) conditions.push(eq(kumiaiProjects.status, filters.status));

	const rows = await db
		.select()
		.from(kumiaiProjects)
		.where(and(...conditions))
		.orderBy(asc(kumiaiProjects.ordinal), asc(kumiaiProjects.title));
	return rows.map(toDetail);
}

// ── getProject ────────────────────────────────────────────────────────────────

export async function getProject(teamId: string, projectId: string): Promise<ProjectDetail> {
	const [row] = await db
		.select()
		.from(kumiaiProjects)
		.where(and(eq(kumiaiProjects.id, projectId), eq(kumiaiProjects.teamId, teamId)))
		.limit(1);

	if (!row) {
		throw new AppError("NOT_FOUND", "Project not found.");
	}

	return toDetail(row);
}

// ── createProject ─────────────────────────────────────────────────────────────

export interface CreateProjectInput {
	goalId: string;
	title: string;
	body?: string | undefined;
	ordinal?: number | null | undefined;
	status?: ProjectStatus | undefined;
	priority?: ProjectPriority | undefined;
	impact?: number | undefined;
	effort?: number | undefined;
	targetWindow?: TargetWindow | null | undefined;
	blockedReason?: string | null | undefined;
}

export async function createProject(
	teamId: string,
	input: CreateProjectInput,
): Promise<ProjectDetail> {
	const workspaceId = await assertGoalInTeam(teamId, input.goalId);

	const status = input.status ?? "backlog";
	const blockedReason = input.blockedReason ?? null;
	assertBlockedReasonValid(status, blockedReason);

	const targetWindow = input.targetWindow ?? null;
	const now = new Date();

	const [row] = await db.transaction(async (tx) =>
		tx
			.insert(kumiaiProjects)
			.values({
				id: newId(),
				teamId,
				workspaceId,
				key: await allocateKey(tx, workspaceId, "PROJ"),
				goalId: input.goalId,
				title: input.title,
				body: input.body ?? "",
				ordinal: input.ordinal ?? null,
				status,
				priority: input.priority ?? "medium",
				impact: input.impact ?? 50,
				effort: input.effort ?? 5,
				targetWindowKind: targetWindow?.kind ?? null,
				targetWindowLabel: targetWindow?.label ?? null,
				targetWindowYear: targetWindow?.year ?? null,
				targetWindowNumber: targetWindow?.number ?? null,
				blockedReason,
				createdAt: now,
				updatedAt: now,
			})
			.returning(),
	);

	if (!row) {
		throw new AppError("INTERNAL_ERROR", "Project was created but could not be fetched.");
	}

	return toDetail(row);
}

// ── updateProject ─────────────────────────────────────────────────────────────

export interface UpdateProjectInput {
	goalId?: string | undefined;
	title?: string | undefined;
	body?: string | undefined;
	ordinal?: number | null | undefined;
	status?: ProjectStatus | undefined;
	priority?: ProjectPriority | undefined;
	impact?: number | undefined;
	effort?: number | undefined;
	targetWindow?: TargetWindow | null | undefined;
	blockedReason?: string | null | undefined;
}

export async function updateProject(
	teamId: string,
	projectId: string,
	input: UpdateProjectInput,
): Promise<ProjectDetail> {
	const [existing] = await db
		.select()
		.from(kumiaiProjects)
		.where(and(eq(kumiaiProjects.id, projectId), eq(kumiaiProjects.teamId, teamId)))
		.limit(1);

	if (!existing) {
		throw new AppError("NOT_FOUND", "Project not found.");
	}

	if (input.goalId !== undefined) {
		assertSameWorkspace(existing.workspaceId, await assertGoalInTeam(teamId, input.goalId), "A project and its goal");
	}

	// Fold PATCH's "undefined means unchanged" semantics in before validating —
	// this is what catches "clearing the reason while staying blocked" even
	// when the request omits `status` entirely.
	const resolvedStatus = input.status ?? (existing.status as ProjectStatus);
	const resolvedReason = input.blockedReason !== undefined ? input.blockedReason : existing.blockedReason;
	assertBlockedReasonValid(resolvedStatus, resolvedReason);

	const patch: Partial<typeof kumiaiProjects.$inferInsert> = { updatedAt: new Date() };

	if (input.goalId !== undefined) patch.goalId = input.goalId;
	if (input.title !== undefined) patch.title = input.title;
	if (input.body !== undefined) patch.body = input.body;
	if (input.ordinal !== undefined) patch.ordinal = input.ordinal;
	if (input.status !== undefined) patch.status = input.status;
	if (input.priority !== undefined) patch.priority = input.priority;
	if (input.impact !== undefined) patch.impact = input.impact;
	if (input.effort !== undefined) patch.effort = input.effort;
	if (input.blockedReason !== undefined) patch.blockedReason = input.blockedReason;
	if (input.targetWindow !== undefined) {
		patch.targetWindowKind = input.targetWindow?.kind ?? null;
		patch.targetWindowLabel = input.targetWindow?.label ?? null;
		patch.targetWindowYear = input.targetWindow?.year ?? null;
		patch.targetWindowNumber = input.targetWindow?.number ?? null;
	}

	const [row] = await db
		.update(kumiaiProjects)
		.set(patch)
		.where(and(eq(kumiaiProjects.id, projectId), eq(kumiaiProjects.teamId, teamId)))
		.returning();

	if (!row) {
		throw new AppError("NOT_FOUND", "Project not found.");
	}

	return toDetail(row);
}

// ── deleteProject ─────────────────────────────────────────────────────────────

export async function deleteProject(teamId: string, projectId: string): Promise<void> {
	const deleted = await db
		.delete(kumiaiProjects)
		.where(and(eq(kumiaiProjects.id, projectId), eq(kumiaiProjects.teamId, teamId)))
		.returning({ id: kumiaiProjects.id });

	if (deleted.length === 0) {
		throw new AppError("NOT_FOUND", "Project not found.");
	}
}
