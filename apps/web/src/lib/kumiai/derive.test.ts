import { describe, it, expect } from 'vitest';
import {
	buildProjectViews,
	percent,
	reqLine,
	scopeToGoals,
	sortProjects,
	taskLine,
	type Workspace
} from './derive.js';
import type { Plan, Project, Requirement, Task } from './types.js';

const stamp = '2026-01-01T00:00:00.000Z';
const project = (id: string, over: Partial<Project> = {}): Project => ({
	id,
	teamId: 't',
	goalId: 'g1',
	title: id,
	body: '',
	ordinal: null,
	status: 'backlog',
	priority: 'medium',
	impact: 50,
	effort: 5,
	targetWindow: null,
	blockedReason: null,
	createdAt: stamp,
	updatedAt: stamp,
	...over
});
const requirement = (id: string, projectId: string | null, status: Requirement['status'] = 'todo'): Requirement => ({
	id,
	teamId: 't',
	projectId,
	title: id,
	body: '',
	status,
	priority: 3,
	createdAt: stamp,
	updatedAt: stamp
});
const plan = (id: string, requirementId: string, updatedAt: string, taskId: string | null = null): Plan => ({
	id,
	teamId: 't',
	requirementId,
	taskId,
	title: id,
	body: '',
	status: 'todo',
	approval: 'approved',
	approvedBy: null,
	approvedAt: null,
	createdAt: stamp,
	updatedAt
});
const task = (id: string, requirementId: string, status: Task['status']): Task => ({
	id,
	teamId: 't',
	requirementId,
	planId: null,
	title: id,
	objective: '',
	body: '',
	status,
	priority: 3,
	createdAt: stamp,
	updatedAt: stamp
});

const ws: Workspace = {
	goals: [
		{ id: 'g1', teamId: 't', workspaceId: 'w1', title: 'Goal', body: '', status: 'todo', priority: 1, createdAt: stamp, updatedAt: stamp }
	],
	projects: [project('p1'), project('p2', { goalId: 'missing' })],
	requirements: [requirement('r1', 'p1', 'done'), requirement('r2', 'p1'), requirement('r3', null)],
	plans: [
		plan('old', 'r1', '2026-01-01T00:00:00.000Z'),
		plan('new', 'r1', '2026-02-01T00:00:00.000Z'),
		plan('task-plan', 'r1', '2026-03-01T00:00:00.000Z', 'tk1')
	],
	tasks: [task('tk1', 'r1', 'done'), task('tk2', 'r1', 'todo')]
};

describe('buildProjectViews', () => {
	const [p1, p2] = buildProjectViews(ws);

	it('joins the goal and counts requirements by project', () => {
		expect(p1.goal?.id).toBe('g1');
		expect(p1.reqsTotal).toBe(2);
		expect(p1.reqsDone).toBe(1);
		expect(p1.tasksTotal).toBe(p1.requirements.reduce((n, r) => n + r.tasks.length, 0));
		expect(p1.tasksDone).toBe(p1.requirements.reduce((n, r) => n + r.tasksDone, 0));
	});

	it('leaves requirements that belong to no project out', () => {
		expect(p1.requirements.map((r) => r.requirement.id)).toEqual(['r1', 'r2']);
	});

	it('picks the newest requirement-level plan and ignores task-level plans', () => {
		expect(p1.requirements[0].plan?.id).toBe('new');
		expect(p1.requirements[1].plan).toBeNull();
	});

	it('counts finished tasks per requirement', () => {
		expect(p1.requirements[0].tasks).toHaveLength(2);
		expect(p1.requirements[0].tasksDone).toBe(1);
	});

	it('tolerates a project whose goal is gone', () => {
		expect(p2.goal).toBeNull();
		expect(p2.reqsTotal).toBe(0);
	});
});

describe('scopeToGoals', () => {
	it('keeps only what hangs off the given goals', () => {
		const scoped = scopeToGoals(ws);
		expect(scoped.projects.map((p) => p.id)).toEqual(['p1']);
		expect(scoped.requirements.map((r) => r.id)).toEqual(['r1', 'r2']);
		expect(scoped.plans.map((p) => p.id)).toEqual(['old', 'new', 'task-plan']);
		expect(scoped.tasks.map((t) => t.id)).toEqual(['tk1', 'tk2']);
	});

	it('drops requirements with no project, and the plans and tasks beneath them', () => {
		const loose: Workspace = {
			...ws,
			plans: [...ws.plans, plan('loose-plan', 'r3', stamp)],
			tasks: [...ws.tasks, task('loose-task', 'r3', 'todo')]
		};
		const scoped = scopeToGoals(loose);
		expect(scoped.requirements.map((r) => r.id)).not.toContain('r3');
		expect(scoped.plans.map((p) => p.id)).not.toContain('loose-plan');
		expect(scoped.tasks.map((t) => t.id)).not.toContain('loose-task');
	});

	it('empties everything when the workspace has no goals', () => {
		const scoped = scopeToGoals({ ...ws, goals: [] });
		expect(scoped).toEqual({ goals: [], projects: [], requirements: [], plans: [], tasks: [] });
	});
});

describe('line helpers', () => {
	it('formats requirement and task progress', () => {
		expect(reqLine({ reqsTotal: 4, reqsDone: 1 })).toBe('1/4 reqs');
		expect(reqLine({ reqsTotal: 0, reqsDone: 0 })).toBe('no reqs yet');
		expect(taskLine({ tasks: [], tasksDone: 0 })).toBe('no tasks yet');
		expect(taskLine({ tasks: [task('a', 'r', 'done'), task('b', 'r', 'todo')], tasksDone: 1 })).toBe('1/2 tasks');
	});

	it('rounds progress and treats an empty total as zero', () => {
		expect(percent(1, 3)).toBe(33);
		expect(percent(0, 0)).toBe(0);
	});
});

describe('sortProjects', () => {
	const rows = [
		{ project: project('a', { impact: 40, effort: 2, priority: 'low' }) },
		{ project: project('b', { impact: 90, effort: 9, priority: 'urgent' }) },
		{ project: project('c', { impact: 60, effort: 4, priority: 'high' }) }
	];

	it('orders by impact, least effort or priority', () => {
		expect(sortProjects(rows, 'impact').map((r) => r.project.id)).toEqual(['b', 'c', 'a']);
		expect(sortProjects(rows, 'effort').map((r) => r.project.id)).toEqual(['a', 'c', 'b']);
		expect(sortProjects(rows, 'priority').map((r) => r.project.id)).toEqual(['b', 'c', 'a']);
	});

	it('does not mutate the input', () => {
		sortProjects(rows, 'impact');
		expect(rows.map((r) => r.project.id)).toEqual(['a', 'b', 'c']);
	});
});
