import { describe, it, expect, vi } from 'vitest';
import { loadWorkspace } from './load.js';

const stamp = '2026-01-01T00:00:00.000Z';
const goal = (id: string) => ({ id, workspaceId: 'w1', title: id, createdAt: stamp, updatedAt: stamp });

function makeFetch(lists: Record<string, unknown[]>, failing?: string) {
	return vi.fn(async (url: string | URL | Request) => {
		url = String(url);
		const path = url.split('?')[0];
		if (path === failing) return { ok: false, json: async () => null } as Response;
		return { ok: true, json: async () => lists[path] ?? [] } as Response;
	});
}

describe('loadWorkspace', () => {
	it('fetches every goal and keeps everything when no workspace is given', async () => {
		const fetchFn = makeFetch({
			'/api/kumiai/goals': [goal('g1')],
			'/api/kumiai/projects': [{ id: 'p1', goalId: 'other' }]
		});
		const { workspace, failed } = await loadWorkspace(fetchFn);
		expect(failed).toBe(false);
		expect(fetchFn).toHaveBeenCalledWith('/api/kumiai/goals');
		expect(workspace.projects).toHaveLength(1);
	});

	it("asks for one workspace's goals and drops projects of other goals", async () => {
		const fetchFn = makeFetch({
			'/api/kumiai/goals': [goal('g1')],
			'/api/kumiai/projects': [
				{ id: 'p1', goalId: 'g1' },
				{ id: 'p2', goalId: 'elsewhere' }
			],
			'/api/kumiai/requirements': [{ id: 'r1', projectId: 'p2' }]
		});
		const { workspace } = await loadWorkspace(fetchFn, 'w 1');
		expect(fetchFn).toHaveBeenCalledWith('/api/kumiai/goals?workspaceId=w%201');
		expect(workspace.projects.map((p) => p.id)).toEqual(['p1']);
		expect(workspace.requirements).toEqual([]);
	});

	it('reports failed with an empty workspace when any list fails', async () => {
		const { workspace, failed } = await loadWorkspace(makeFetch({}, '/api/kumiai/tasks'), 'w1');
		expect(failed).toBe(true);
		expect(workspace.goals).toEqual([]);
	});
});
