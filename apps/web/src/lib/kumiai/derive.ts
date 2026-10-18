import type { Goal, Plan, Project, Requirement, Task } from './types.js';

/** Everything the planning views read, as returned by the five team-wide list endpoints. */
export interface Workspace {
	goals: Goal[];
	projects: Project[];
	requirements: Requirement[];
	plans: Plan[];
	tasks: Task[];
}

export interface RequirementView {
	requirement: Requirement;
	/** The requirement's own plan (not a task-level plan); the most recently updated if several. */
	plan: Plan | null;
	tasks: Task[];
	tasksDone: number;
}

export interface ProjectView {
	project: Project;
	goal: Goal | null;
	requirements: RequirementView[];
	reqsTotal: number;
	reqsDone: number;
}

export const EMPTY_WORKSPACE: Workspace = {
	goals: [],
	projects: [],
	requirements: [],
	plans: [],
	tasks: []
};

/**
 * Narrows the team-wide lists to the goals they were fetched for: a project stays when its
 * goal is in `ws.goals`, and requirements, plans and tasks follow their project. A requirement
 * with no project belongs to no goal, so it belongs to no workspace and is dropped.
 */
export function scopeToGoals(ws: Workspace): Workspace {
	const goalIds = new Set(ws.goals.map((g) => g.id));
	const projects = ws.projects.filter((p) => goalIds.has(p.goalId));
	const projectIds = new Set(projects.map((p) => p.id));
	const requirements = ws.requirements.filter((r) => r.projectId !== null && projectIds.has(r.projectId));
	const requirementIds = new Set(requirements.map((r) => r.id));
	return {
		goals: ws.goals,
		projects,
		requirements,
		plans: ws.plans.filter((p) => requirementIds.has(p.requirementId)),
		tasks: ws.tasks.filter((t) => requirementIds.has(t.requirementId))
	};
}

function newest<T extends { updatedAt: string }>(rows: T[]): T | null {
	let best: T | null = null;
	for (const row of rows) if (!best || row.updatedAt > best.updatedAt) best = row;
	return best;
}

/** Joins each project to its goal, requirements, plans and tasks. Rows are matched by id only. */
export function buildProjectViews(ws: Workspace): ProjectView[] {
	const goals = new Map(ws.goals.map((g) => [g.id, g]));
	return ws.projects.map((project) => {
		const requirements = ws.requirements
			.filter((r) => r.projectId === project.id)
			.map((requirement): RequirementView => {
				const tasks = ws.tasks.filter((t) => t.requirementId === requirement.id);
				const plan = newest(
					ws.plans.filter((p) => p.requirementId === requirement.id && p.taskId === null)
				);
				return {
					requirement,
					plan,
					tasks,
					tasksDone: tasks.filter((t) => t.status === 'done').length
				};
			});
		return {
			project,
			goal: goals.get(project.goalId) ?? null,
			requirements,
			reqsTotal: requirements.length,
			reqsDone: requirements.filter((r) => r.requirement.status === 'done').length
		};
	});
}

/** "1/4 reqs" or "no reqs yet". */
export function reqLine(view: Pick<ProjectView, 'reqsTotal' | 'reqsDone'>): string {
	return view.reqsTotal ? `${view.reqsDone}/${view.reqsTotal} reqs` : 'no reqs yet';
}

/** "2/3 tasks" or "no tasks yet". */
export function taskLine(view: Pick<RequirementView, 'tasks' | 'tasksDone'>): string {
	return view.tasks.length ? `${view.tasksDone}/${view.tasks.length} tasks` : 'no tasks yet';
}

export function percent(done: number, total: number): number {
	return total ? Math.round((done / total) * 100) : 0;
}

const PRIORITY_RANK: Record<string, number> = { urgent: 0, high: 1, medium: 2, low: 3 };

export type BacklogSort = 'impact' | 'effort' | 'priority';

/** Highest impact first, least effort first, or most urgent first. Does not mutate its input. */
export function sortProjects<T extends { project: Project }>(rows: T[], sort: BacklogSort): T[] {
	return rows.slice().sort((a, b) => {
		if (sort === 'impact') return b.project.impact - a.project.impact;
		if (sort === 'effort') return a.project.effort - b.project.effort;
		return PRIORITY_RANK[a.project.priority] - PRIORITY_RANK[b.project.priority];
	});
}

/** Short label for a project dot: "PRJ-007" -> "#7", anything else -> its first six characters. */
export function shortId(id: string): string {
	const m = /^PRJ-0*(\d+)$/.exec(id);
	return m ? `#${m[1]}` : id.slice(0, 6);
}

/**
 * Ids are generated, 21 characters long. Cards and rows show the first six so the label stays
 * scannable; the full id is the link target and the `title` of the element that shows it.
 */
export function displayId(id: string): string {
	return id.length > 12 ? id.slice(0, 6) : id;
}
