import { eq, and, asc } from "drizzle-orm";
import { db, newId, allocateKey, kumiaiRequirements, kumiaiProjects } from "@kata/db";
import { AppError } from "@kata/http";
import { assertSameWorkspace } from "./guild-scope.js";
import { ensureDefaultWorkspace } from "./workspaces.js";

// ── Serialisation shape ───────────────────────────────────────────────────────

export type RequirementStatus = "todo" | "in-progress" | "done";

export interface RequirementDetail {
	id: string;
	teamId: string;
	projectId: string | null;
	title: string;
	body: string;
	status: RequirementStatus;
	priority: number;
	createdAt: Date;
	updatedAt: Date;
}

function toDetail(row: typeof kumiaiRequirements.$inferSelect): RequirementDetail {
	return {
		id: row.id,
		teamId: row.teamId,
		projectId: row.projectId,
		title: row.title,
		body: row.body,
		status: row.status as RequirementStatus,
		priority: row.priority,
		createdAt: row.createdAt,
		updatedAt: row.updatedAt,
	};
}

/** Returns the project's workspace, which its requirements share. */
async function assertProjectInTeam(teamId: string, projectId: string): Promise<string> {
	const [project] = await db
		.select({ id: kumiaiProjects.id, workspaceId: kumiaiProjects.workspaceId })
		.from(kumiaiProjects)
		.where(and(eq(kumiaiProjects.id, projectId), eq(kumiaiProjects.teamId, teamId)))
		.limit(1);
	if (!project) {
		throw new AppError("NOT_FOUND", "Project not found.");
	}
	return project.workspaceId;
}

// ── listRequirements ──────────────────────────────────────────────────────────

export async function listRequirements(teamId: string): Promise<RequirementDetail[]> {
	const rows = await db
		.select()
		.from(kumiaiRequirements)
		.where(eq(kumiaiRequirements.teamId, teamId))
		.orderBy(asc(kumiaiRequirements.priority), asc(kumiaiRequirements.title));
	return rows.map(toDetail);
}

// ── getRequirement ────────────────────────────────────────────────────────────

export async function getRequirement(
	teamId: string,
	requirementId: string,
): Promise<RequirementDetail> {
	const [row] = await db
		.select()
		.from(kumiaiRequirements)
		.where(and(eq(kumiaiRequirements.id, requirementId), eq(kumiaiRequirements.teamId, teamId)))
		.limit(1);

	if (!row) {
		throw new AppError("NOT_FOUND", "Requirement not found.");
	}

	return toDetail(row);
}

// ── createRequirement ─────────────────────────────────────────────────────────

export interface CreateRequirementInput {
	title: string;
	body?: string | undefined;
	projectId?: string | null | undefined;
	status?: RequirementStatus | undefined;
	priority?: number | undefined;
}

export async function createRequirement(
	teamId: string,
	input: CreateRequirementInput,
): Promise<RequirementDetail> {
	// An unaffiliated requirement still belongs to a workspace: the team's default.
	const workspaceId = input.projectId
		? await assertProjectInTeam(teamId, input.projectId)
		: (await ensureDefaultWorkspace(teamId)).id;

	const now = new Date();
	const [row] = await db.transaction(async (tx) =>
		tx
			.insert(kumiaiRequirements)
			.values({
				id: newId(),
				teamId,
				workspaceId,
				key: await allocateKey(tx, workspaceId, "REQ"),
				projectId: input.projectId ?? null,
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
		throw new AppError("INTERNAL_ERROR", "Requirement was created but could not be fetched.");
	}

	return toDetail(row);
}

// ── updateRequirement ─────────────────────────────────────────────────────────

export interface UpdateRequirementInput {
	title?: string | undefined;
	body?: string | undefined;
	projectId?: string | null | undefined;
	status?: RequirementStatus | undefined;
	priority?: number | undefined;
}

export async function updateRequirement(
	teamId: string,
	requirementId: string,
	input: UpdateRequirementInput,
): Promise<RequirementDetail> {
	if (input.projectId) {
		const projectWorkspaceId = await assertProjectInTeam(teamId, input.projectId);
		const [current] = await db
			.select({ workspaceId: kumiaiRequirements.workspaceId })
			.from(kumiaiRequirements)
			.where(and(eq(kumiaiRequirements.id, requirementId), eq(kumiaiRequirements.teamId, teamId)))
			.limit(1);
		if (!current) {
			throw new AppError("NOT_FOUND", "Requirement not found.");
		}
		assertSameWorkspace(current.workspaceId, projectWorkspaceId, "A requirement and its project");
	}

	const patch: Partial<typeof kumiaiRequirements.$inferInsert> = { updatedAt: new Date() };
	if (input.title !== undefined) patch.title = input.title;
	if (input.body !== undefined) patch.body = input.body;
	if (input.projectId !== undefined) patch.projectId = input.projectId;
	if (input.status !== undefined) patch.status = input.status;
	if (input.priority !== undefined) patch.priority = input.priority;

	const [row] = await db
		.update(kumiaiRequirements)
		.set(patch)
		.where(and(eq(kumiaiRequirements.id, requirementId), eq(kumiaiRequirements.teamId, teamId)))
		.returning();

	if (!row) {
		throw new AppError("NOT_FOUND", "Requirement not found.");
	}

	return toDetail(row);
}

// ── deleteRequirement ─────────────────────────────────────────────────────────

export async function deleteRequirement(teamId: string, requirementId: string): Promise<void> {
	const deleted = await db
		.delete(kumiaiRequirements)
		.where(and(eq(kumiaiRequirements.id, requirementId), eq(kumiaiRequirements.teamId, teamId)))
		.returning({ id: kumiaiRequirements.id });

	if (deleted.length === 0) {
		throw new AppError("NOT_FOUND", "Requirement not found.");
	}
}
