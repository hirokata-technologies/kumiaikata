import { eq, and, asc, sql } from "drizzle-orm";
import { db, newId, kumiaiWorkspaces, kumiaiGoals, kumiaiProjects } from "@kata/db";
import { AppError } from "@kata/http";

export const DEFAULT_WORKSPACE_NAME = "default";

// ── Serialisation shape ───────────────────────────────────────────────────────

export interface WorkspaceDetail {
	id: string;
	teamId: string;
	name: string;
	isDefault: boolean;
	goalCount: number;
	projectCount: number;
	createdAt: Date;
	updatedAt: Date;
}

// ── ensureDefaultWorkspace ────────────────────────────────────────────────────

/**
 * Returns the team's default workspace, creating it on first use. Safe to call
 * concurrently: the partial unique index allows a single default per team, so a
 * racing insert is swallowed and the winner's row is read back.
 */
export async function ensureDefaultWorkspace(teamId: string): Promise<{ id: string }> {
	const find = () =>
		db
			.select({ id: kumiaiWorkspaces.id })
			.from(kumiaiWorkspaces)
			.where(and(eq(kumiaiWorkspaces.teamId, teamId), eq(kumiaiWorkspaces.isDefault, true)))
			.limit(1);

	const [existing] = await find();
	if (existing) return existing;

	const now = new Date();
	await db
		.insert(kumiaiWorkspaces)
		.values({
			id: newId(),
			teamId,
			name: DEFAULT_WORKSPACE_NAME,
			isDefault: true,
			createdAt: now,
			updatedAt: now,
		})
		.onConflictDoNothing();

	const [row] = await find();
	if (!row) {
		throw new AppError("INTERNAL_ERROR", "Default workspace could not be created.");
	}
	return row;
}

// ── resolveWorkspaceId ────────────────────────────────────────────────────────

/** The given workspace id if it belongs to the team, the team's default when omitted. */
export async function resolveWorkspaceId(
	teamId: string,
	workspaceId?: string | undefined,
): Promise<string> {
	if (workspaceId === undefined) return (await ensureDefaultWorkspace(teamId)).id;

	const [row] = await db
		.select({ id: kumiaiWorkspaces.id })
		.from(kumiaiWorkspaces)
		.where(and(eq(kumiaiWorkspaces.id, workspaceId), eq(kumiaiWorkspaces.teamId, teamId)))
		.limit(1);

	if (!row) {
		throw new AppError("NOT_FOUND", "Workspace not found.");
	}
	return row.id;
}

// ── listWorkspaces ────────────────────────────────────────────────────────────

export async function listWorkspaces(teamId: string): Promise<WorkspaceDetail[]> {
	await ensureDefaultWorkspace(teamId);

	const goalCount = db
		.select({ workspaceId: kumiaiGoals.workspaceId, n: sql<number>`count(*)`.as("goal_n") })
		.from(kumiaiGoals)
		.groupBy(kumiaiGoals.workspaceId)
		.as("goal_counts");

	const projectCount = db
		.select({ workspaceId: kumiaiGoals.workspaceId, n: sql<number>`count(*)`.as("project_n") })
		.from(kumiaiProjects)
		.innerJoin(kumiaiGoals, eq(kumiaiGoals.id, kumiaiProjects.goalId))
		.groupBy(kumiaiGoals.workspaceId)
		.as("project_counts");

	const rows = await db
		.select({
			workspace: kumiaiWorkspaces,
			goals: goalCount.n,
			projects: projectCount.n,
		})
		.from(kumiaiWorkspaces)
		.leftJoin(goalCount, eq(goalCount.workspaceId, kumiaiWorkspaces.id))
		.leftJoin(projectCount, eq(projectCount.workspaceId, kumiaiWorkspaces.id))
		.where(eq(kumiaiWorkspaces.teamId, teamId))
		// The default workspace leads, the rest follow in the order they were made.
		.orderBy(sql`${kumiaiWorkspaces.isDefault} DESC`, asc(kumiaiWorkspaces.createdAt));

	return rows.map((r) => ({
		id: r.workspace.id,
		teamId: r.workspace.teamId,
		name: r.workspace.name,
		isDefault: r.workspace.isDefault,
		goalCount: Number(r.goals ?? 0),
		projectCount: Number(r.projects ?? 0),
		createdAt: r.workspace.createdAt,
		updatedAt: r.workspace.updatedAt,
	}));
}

// ── createWorkspace ───────────────────────────────────────────────────────────

export async function createWorkspace(teamId: string, name: string): Promise<WorkspaceDetail> {
	await ensureDefaultWorkspace(teamId);

	const now = new Date();
	const id = newId();
	const inserted = await db
		.insert(kumiaiWorkspaces)
		.values({ id, teamId, name, isDefault: false, createdAt: now, updatedAt: now })
		.onConflictDoNothing()
		.returning({ id: kumiaiWorkspaces.id });

	if (inserted.length === 0) {
		throw new AppError("CONFLICT", "A workspace with that name already exists.");
	}

	return {
		id,
		teamId,
		name,
		isDefault: false,
		goalCount: 0,
		projectCount: 0,
		createdAt: now,
		updatedAt: now,
	};
}

// ── renameWorkspace ───────────────────────────────────────────────────────────

function isUniqueViolation(err: unknown): boolean {
	// drizzle wraps driver errors; walk `cause` to the pg error.
	let cur: unknown = err;
	for (let i = 0; i < 5 && cur && typeof cur === "object"; i++) {
		const o = cur as { code?: unknown; cause?: unknown };
		if (o.code === "23505") return true;
		cur = o.cause;
	}
	return false;
}

/**
 * Renames one of the team's workspaces. Renaming to the name it already has succeeds as a
 * no-op; a name another workspace of the team holds is a CONFLICT. The id, the default flag
 * and everything under the workspace are untouched.
 */
export async function renameWorkspace(
	teamId: string,
	workspaceId: string,
	name: string,
): Promise<WorkspaceDetail> {
	let updated: Array<{ id: string }>;
	try {
		updated = await db
			.update(kumiaiWorkspaces)
			.set({ name, updatedAt: new Date() })
			.where(and(eq(kumiaiWorkspaces.id, workspaceId), eq(kumiaiWorkspaces.teamId, teamId)))
			.returning({ id: kumiaiWorkspaces.id });
	} catch (err) {
		if (isUniqueViolation(err)) {
			throw new AppError("CONFLICT", "A workspace with that name already exists.");
		}
		throw err;
	}

	if (updated.length === 0) {
		throw new AppError("NOT_FOUND", "Workspace not found.");
	}

	const detail = (await listWorkspaces(teamId)).find((w) => w.id === workspaceId);
	if (!detail) {
		throw new AppError("NOT_FOUND", "Workspace not found.");
	}
	return detail;
}
