import type { Goal, Plan, Project, Requirement, Task } from './types.js';
import { EMPTY_WORKSPACE, type Workspace } from './derive.js';

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
 * Loads the five team-wide kumiai lists for a page's server `load`. The API is served by
 * this same app, so the load event's `fetch` forwards the session cookie by itself. Never
 * throws: if any list fails the page gets an empty workspace and `failed: true`, so a view
 * can say so instead of rendering a half-joined picture.
 */
export async function loadWorkspace(
	fetchFn: typeof fetch
): Promise<{ workspace: Workspace; failed: boolean }> {
	const [goals, projects, requirements, plans, tasks] = await Promise.all([
		fetchList<Goal>(fetchFn, '/api/kumiai/goals'),
		fetchList<Project>(fetchFn, '/api/kumiai/projects'),
		fetchList<Requirement>(fetchFn, '/api/kumiai/requirements'),
		fetchList<Plan>(fetchFn, '/api/kumiai/plans'),
		fetchList<Task>(fetchFn, '/api/kumiai/tasks')
	]);
	if (!goals || !projects || !requirements || !plans || !tasks) {
		return { workspace: EMPTY_WORKSPACE, failed: true };
	}
	return { workspace: { goals, projects, requirements, plans, tasks }, failed: false };
}
