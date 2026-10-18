export type GoalStatus = 'todo' | 'in-progress' | 'done';
export type RequirementStatus = 'todo' | 'in-progress' | 'done';
export type PlanStatus = 'todo' | 'in-progress' | 'done';
export type ProjectStatus = 'backlog' | 'todo' | 'in-progress' | 'blocked' | 'done';
export type TaskStatus = 'todo' | 'in-progress' | 'done' | 'failed' | 'blocked' | 'waived';
export type AnyStatus = GoalStatus | RequirementStatus | ProjectStatus | TaskStatus;

export type ProjectPriority = 'urgent' | 'high' | 'medium' | 'low';
export type PriorityLevel = 1 | 2 | 3 | 4 | 5;

export type PlanApproval = 'pending' | 'approved' | 'rejected';

export type TargetWindowKind = 'week' | 'month' | 'quarter';

export interface TargetWindow {
	kind: TargetWindowKind;
	label: string; // bare period name: "Week 39" | "October" | "Q4"
	year: number;
	number: number; // week 1-53 | month 1-12 | quarter 1-4
}

export interface Pill {
	bg: string;
	fg: string;
	label: string;
}

/** A planning workspace: a named set of goals. Every team has one `isDefault` workspace. */
export interface KumiaiWorkspace {
	id: string;
	teamId: string;
	name: string;
	isDefault: boolean;
	goalCount: number;
	projectCount: number;
	createdAt: string;
	updatedAt: string;
}

export interface Goal {
	id: string;
	teamId: string;
	/** The one workspace the goal belongs to. */
	workspaceId: string;
	title: string;
	body: string;
	status: GoalStatus;
	priority: PriorityLevel;
	createdAt: string;
	updatedAt: string;
}

export interface Project {
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
	createdAt: string;
	updatedAt: string;
}

export interface Requirement {
	id: string;
	teamId: string;
	projectId: string | null;
	title: string;
	body: string;
	status: RequirementStatus;
	priority: PriorityLevel;
	createdAt: string;
	updatedAt: string;
}

export interface Plan {
	id: string;
	teamId: string;
	requirementId: string;
	taskId: string | null;
	title: string;
	body: string;
	status: PlanStatus;
	approval: PlanApproval;
	approvedBy: string | null;
	approvedAt: string | null;
	createdAt: string;
	updatedAt: string;
}

export interface Task {
	id: string;
	teamId: string;
	requirementId: string;
	planId: string | null;
	title: string;
	objective: string;
	body: string;
	status: TaskStatus;
	priority: PriorityLevel;
	createdAt: string;
	updatedAt: string;
}
