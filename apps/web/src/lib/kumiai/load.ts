import type { Goal, Plan, Project, Requirement, Task } from './types.js';
import { EMPTY_WORKSPACE, scopeToGoals, type Workspace } from './derive.js';

async function fetchList<T>(fetchFn: typeof fetch, path: string): Promise<T[] | null> {
	try {
		const res = await fetchFn(path);
		if (!res.ok) return null;
		return (await res.json()) as T[];
	} catch {
		return null;
	}
}

/**
 * Loads the five team-wide kumiai lists for a page's server `load`. With a `workspaceId`, only
 * that workspace's goals are fetched and everything else is narrowed to them. The API is served by
 * this same app, so the load event's `fetch` forwards the session cookie by itself. Never
 * throws: if any list fails the page gets an empty workspace and `failed: true`, so a view
 * can say so instead of rendering a half-joined picture.
 */
export async function loadWorkspace(
	fetchFn: typeof fetch,
	workspaceId?: string | null
): Promise<{ workspace: Workspace; failed: boolean }> {
	const goalsPath = workspaceId
		? `/api/kumiai/goals?workspaceId=${encodeURIComponent(workspaceId)}`
		: '/api/kumiai/goals';
	const [goals, projects, requirements, plans, tasks] = await Promise.all([
		fetchList<Goal>(fetchFn, goalsPath),
		fetchList<Project>(fetchFn, '/api/kumiai/projects'),
		fetchList<Requirement>(fetchFn, '/api/kumiai/requirements'),
		fetchList<Plan>(fetchFn, '/api/kumiai/plans'),
		fetchList<Task>(fetchFn, '/api/kumiai/tasks')
	]);
	if (!goals || !projects || !requirements || !plans || !tasks) {
		return { workspace: EMPTY_WORKSPACE, failed: true };
	}
	const all = { goals, projects, requirements, plans, tasks };
	return { workspace: workspaceId ? scopeToGoals(all) : all, failed: false };
}
