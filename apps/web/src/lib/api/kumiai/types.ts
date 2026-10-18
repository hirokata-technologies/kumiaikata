// Response shapes and request-input types that are not entities. Entity interfaces
// (Goal, Project, Requirement, Plan, Task, TargetWindow, …) live in $lib/kumiai/types.ts
// and are imported by the resource modules directly — they are not redeclared here.
import type {
	GoalStatus,
	PlanApproval,
	PlanStatus,
	PriorityLevel,
	ProjectPriority,
	ProjectStatus,
	RequirementStatus,
	TargetWindow,
	TaskStatus,
} from '$lib/kumiai/types.js';

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

export interface KumiaiSearchResults {
	goals: Array<{ id: string; title: string }>;
	projects: Array<{ id: string; title: string }>;
	requirements: Array<{ id: string; title: string }>;
}

export interface RecentProject {
	id: string;
	title: string;
	priority: ProjectPriority;
	status: ProjectStatus;
	openedAt: string;
}

export interface CreateGoalInput {
	/** The team's default workspace when omitted. */
	workspaceId?: string;
	title: string;
	body?: string;
	status: GoalStatus;
	priority: PriorityLevel;
}

export type UpdateGoalInput = Partial<CreateGoalInput>;

export interface CreateProjectInput {
	goalId: string;
	title: string;
	body?: string;
	ordinal?: number | null;
	status: ProjectStatus;
	priority: ProjectPriority;
	impact: number;
	effort: number;
	targetWindow?: TargetWindow | null;
	blockedReason?: string | null;
}

export type UpdateProjectInput = Partial<CreateProjectInput>;

export interface CreateRequirementInput {
	projectId?: string | null;
	title: string;
	body?: string;
	status: RequirementStatus;
	priority: PriorityLevel;
}

export type UpdateRequirementInput = Partial<CreateRequirementInput>;

export interface CreatePlanInput {
	requirementId: string;
	taskId?: string | null;
	title: string;
	body?: string;
	status: PlanStatus;
	approval: PlanApproval;
	approvedBy?: string | null;
	approvedAt?: string | null;
}

export type UpdatePlanInput = Partial<CreatePlanInput>;

export interface CreateTaskInput {
	requirementId: string;
	planId?: string | null;
	title: string;
	objective?: string;
	body?: string;
	status: TaskStatus;
	priority: PriorityLevel;
}

export type UpdateTaskInput = Partial<CreateTaskInput>;

export type QueryParams = Record<string, string | number | boolean | null | undefined>;
type QueryValue = string | number | boolean | null | undefined;

/**
 * Builds a URL-encoded query string from a partial params object, skipping
 * undefined/null values. Returns '' (no leading '?') when there is nothing to encode.
 *
 * Constrained to `object` rather than `QueryParams` directly: plain option interfaces
 * without an index signature — e.g. `ListProjectsParams` — are not structurally
 * assignable to an indexed type such as `Record<string, …>`, even when only their
 * declared properties are read at runtime (which is all this function does).
 */
export function qs<T extends object>(params?: T): string {
	if (!params) return '';
	const search = new URLSearchParams();
	for (const [key, value] of Object.entries(params as Record<string, QueryValue>)) {
		if (value === undefined || value === null) continue;
		search.set(key, String(value));
	}
	const encoded = search.toString();
	return encoded ? `?${encoded}` : '';
}
