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

export async function getStats(teamId: string): Promise<KumiaiStats> {
	const [openTasksRow] = await db
		.select({ count: sql<number>`count(*)` })
		.from(kumiaiTasks)
		.where(and(eq(kumiaiTasks.teamId, teamId), inArray(kumiaiTasks.status, OPEN_TASK_STATUSES)));

	const statusRows = await db
		.select({ status: kumiaiProjects.status, count: sql<number>`count(*)` })
		.from(kumiaiProjects)
		.where(eq(kumiaiProjects.teamId, teamId))
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
): Promise<RecentProjectDetail[]> {
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
		.where(and(eq(kumiaiRecentProjects.userId, userId), eq(kumiaiProjects.teamId, teamId)))
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
