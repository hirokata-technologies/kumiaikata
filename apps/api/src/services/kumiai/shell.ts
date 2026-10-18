import { eq, and, or, ilike, desc, notInArray, inArray, sql } from "drizzle-orm";
import {
	db,
	kumiaiTasks,
	kumiaiProjects,
	kumiaiGoals,
	kumiaiRequirements,
	kumiaiRecentProjects,
} from "@kata/db";
import { AppError } from "@kata/http";
import type { ProjectStatus, ProjectPriority } from "./projects.js";
import { resolveWorkspaceId } from "./workspaces.js";

// ── workspace scoping ─────────────────────────────────────────────────────────

/** Ids of the goals in a workspace, as a subquery to filter projects by. */
function goalIdsIn(workspaceId: string) {
	return db.select({ id: kumiaiGoals.id }).from(kumiaiGoals).where(eq(kumiaiGoals.workspaceId, workspaceId));
}

// ── getStats ──────────────────────────────────────────────────────────────────

export interface KumiaiStats {
	tasksInProgress: number;
	projectCounts: {
		backlog: number;
		todo: number;
		inProgress: number;
		blocked: number;
		done: number;
	};
}

const PROJECT_STATUS_KEY: Record<ProjectStatus, keyof KumiaiStats["projectCounts"]> = {
	backlog: "backlog",
	todo: "todo",
	"in-progress": "inProgress",
	blocked: "blocked",
	done: "done",
};

// US-2 AC4: the pill counts *open* tasks — todo, in-progress, or blocked — not just
// tasks actively in progress.
const OPEN_TASK_STATUSES = ["todo", "in-progress", "blocked"] as const;

export async function getStats(
	teamId: string,
	workspaceId?: string | undefined,
): Promise<KumiaiStats> {
	// With a workspace, only projects under its goals count, and only the tasks of
	// requirements that belong to those projects.
	const inWorkspace = workspaceId
		? await resolveWorkspaceId(teamId, workspaceId)
		: undefined;
	const projectScope = inWorkspace
		? and(eq(kumiaiProjects.teamId, teamId), inArray(kumiaiProjects.goalId, goalIdsIn(inWorkspace)))
		: eq(kumiaiProjects.teamId, teamId);
	const taskScope = inWorkspace
		? and(
				eq(kumiaiTasks.teamId, teamId),
				inArray(
					kumiaiTasks.requirementId,
					db
						.select({ id: kumiaiRequirements.id })
						.from(kumiaiRequirements)
						.where(
							inArray(
								kumiaiRequirements.projectId,
								db
									.select({ id: kumiaiProjects.id })
									.from(kumiaiProjects)
									.where(inArray(kumiaiProjects.goalId, goalIdsIn(inWorkspace))),
							),
						),
				),
			)
		: eq(kumiaiTasks.teamId, teamId);

	const [openTasksRow] = await db
		.select({ count: sql<number>`count(*)` })
		.from(kumiaiTasks)
		.where(and(taskScope, inArray(kumiaiTasks.status, OPEN_TASK_STATUSES)));

	const statusRows = await db
		.select({ status: kumiaiProjects.status, count: sql<number>`count(*)` })
		.from(kumiaiProjects)
		.where(projectScope)
		.groupBy(kumiaiProjects.status);

	const projectCounts: KumiaiStats["projectCounts"] = {
		backlog: 0,
		todo: 0,
		inProgress: 0,
		blocked: 0,
		done: 0,
	};
	for (const row of statusRows) {
		const key = PROJECT_STATUS_KEY[row.status as ProjectStatus];
		projectCounts[key] = Number(row.count);
	}

	return {
		tasksInProgress: Number(openTasksRow?.count ?? 0),
		projectCounts,
	};
}

// ── searchWorkspace ───────────────────────────────────────────────────────────

export interface SearchResultItem {
	id: string;
	title: string;
}

export interface SearchResults {
	goals: SearchResultItem[];
	projects: SearchResultItem[];
	requirements: SearchResultItem[];
}

const SEARCH_LIMIT = 20;

/** Escape `%` and `_` (and the escape char itself) for a LIKE/ILIKE pattern. */
function escapeLikePattern(raw: string): string {
	return raw.replace(/\\/g, "\\\\").replace(/%/g, "\\%").replace(/_/g, "\\_");
}

export async function searchWorkspace(teamId: string, q: string): Promise<SearchResults> {
	const trimmed = q.trim();
	if (trimmed.length < 1) {
		return { goals: [], projects: [], requirements: [] };
	}

	const pattern = `%${escapeLikePattern(trimmed)}%`;

	const [goals, projects, requirements] = await Promise.all([
		db
			.select({ id: kumiaiGoals.id, title: kumiaiGoals.title })
			.from(kumiaiGoals)
			.where(
				and(
					eq(kumiaiGoals.teamId, teamId),
					or(ilike(kumiaiGoals.title, pattern), ilike(kumiaiGoals.id, pattern)),
				),
			)
			.limit(SEARCH_LIMIT),
		db
			.select({ id: kumiaiProjects.id, title: kumiaiProjects.title })
			.from(kumiaiProjects)
			.where(
				and(
					eq(kumiaiProjects.teamId, teamId),
					or(ilike(kumiaiProjects.title, pattern), ilike(kumiaiProjects.id, pattern)),
				),
			)
			.limit(SEARCH_LIMIT),
		db
			.select({ id: kumiaiRequirements.id, title: kumiaiRequirements.title })
			.from(kumiaiRequirements)
			.where(
				and(
					eq(kumiaiRequirements.teamId, teamId),
					or(ilike(kumiaiRequirements.title, pattern), ilike(kumiaiRequirements.id, pattern)),
				),
			)
			.limit(SEARCH_LIMIT),
	]);

	return { goals, projects, requirements };
}

// ── listRecentProjects / touchRecentProject ──────────────────────────────────

export interface RecentProjectDetail {
	id: string;
	title: string;
	priority: ProjectPriority;
	status: ProjectStatus;
	openedAt: Date;
}

const RECENT_PROJECTS_LIMIT = 5;

export async function listRecentProjects(
	teamId: string,
	userId: string,
	workspaceId?: string | undefined,
): Promise<RecentProjectDetail[]> {
	const inWorkspace = workspaceId
		? await resolveWorkspaceId(teamId, workspaceId)
		: undefined;
	const rows = await db
		.select({
			id: kumiaiProjects.id,
			title: kumiaiProjects.title,
			priority: kumiaiProjects.priority,
			status: kumiaiProjects.status,
			openedAt: kumiaiRecentProjects.openedAt,
		})
		.from(kumiaiRecentProjects)
		.innerJoin(kumiaiProjects, eq(kumiaiProjects.id, kumiaiRecentProjects.projectId))
		.where(
			and(
				eq(kumiaiRecentProjects.userId, userId),
				eq(kumiaiProjects.teamId, teamId),
				inWorkspace ? inArray(kumiaiProjects.goalId, goalIdsIn(inWorkspace)) : undefined,
			),
		)
		.orderBy(desc(kumiaiRecentProjects.openedAt))
		.limit(RECENT_PROJECTS_LIMIT);

	return rows.map((r) => ({
		id: r.id,
		title: r.title,
		priority: r.priority as ProjectPriority,
		status: r.status as ProjectStatus,
		openedAt: r.openedAt,
	}));
}

export async function touchRecentProject(
	teamId: string,
	userId: string,
	projectId: string,
): Promise<void> {
	const [project] = await db
		.select({ id: kumiaiProjects.id })
		.from(kumiaiProjects)
		.where(and(eq(kumiaiProjects.id, projectId), eq(kumiaiProjects.teamId, teamId)))
		.limit(1);

	if (!project) {
		throw new AppError("NOT_FOUND", "Project not found.");
	}

	const now = new Date();
	await db
		.insert(kumiaiRecentProjects)
		.values({ userId, projectId, openedAt: now })
		.onConflictDoUpdate({
			target: [kumiaiRecentProjects.userId, kumiaiRecentProjects.projectId],
			set: { openedAt: now },
		});

	// De-duplication is free via the upsert above; trim anything outside the
	// newest N so the table cannot grow without bound for a heavy user.
	const keep = await db
		.select({ projectId: kumiaiRecentProjects.projectId })
		.from(kumiaiRecentProjects)
		.where(eq(kumiaiRecentProjects.userId, userId))
		.orderBy(desc(kumiaiRecentProjects.openedAt))
		.limit(RECENT_PROJECTS_LIMIT);

	const keepIds = keep.map((k) => k.projectId);
	if (keepIds.length > 0) {
		await db
			.delete(kumiaiRecentProjects)
			.where(
				and(
					eq(kumiaiRecentProjects.userId, userId),
					notInArray(kumiaiRecentProjects.projectId, keepIds),
				),
			);
	}
}
