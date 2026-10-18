import { redirect } from "@sveltejs/kit";
import type { PageServerLoad } from "./$types";
import type { Goal, KumiaiWorkspace, Project } from "$lib/kumiai/types.js";
import { ACTIVE_WORKSPACE_COOKIE, resolveActiveWorkspace } from "$lib/kumiai/active-workspace.js";

async function fetchList<T>(fetchFn: typeof fetch, path: string): Promise<T[]> {
	try {
		const res = await fetchFn(path);
		if (!res.ok) return [];
		return (await res.json()) as T[];
	} catch {
		return [];
	}
}

// Explicit `Promise<void>` return annotation — every path calls `redirect()`, whose return
// type is `never`, so without it TS infers `never` and collapses this route's generated
// `PageData` (breaking the still-on-disk but unreachable src/routes/+page.svelte typecheck).
export const load: PageServerLoad = async ({ locals, fetch, cookies }): Promise<void> => {
	if (!locals.user) redirect(303, "/login");

	// Land on this week only when the active workspace already has a goal with a project;
	// otherwise there is nothing to schedule, so start at the roadmap to plan some.
	const workspaces = await fetchList<KumiaiWorkspace>(fetch, "/api/kumiai/workspaces");
	const active = resolveActiveWorkspace(workspaces, cookies.get(ACTIVE_WORKSPACE_COOKIE));
	const goalsPath = active
		? `/api/kumiai/goals?workspaceId=${encodeURIComponent(active.id)}`
		: "/api/kumiai/goals";
	const [goals, projects] = await Promise.all([
		fetchList<Goal>(fetch, goalsPath),
		fetchList<Project>(fetch, "/api/kumiai/projects"),
	]);
	const goalIds = new Set(goals.map((g) => g.id));
	const hasPlan = projects.some((p) => goalIds.has(p.goalId));
	redirect(303, hasPlan ? "/week" : "/roadmap");
};
