import { redirect } from "@sveltejs/kit";
import type { LayoutServerLoad } from "./$types";
import type { KumiaiStats, RecentProject } from "$lib/api/kumiai/types.js";
import type { KumiaiWorkspace } from "$lib/kumiai/types.js";
import { ACTIVE_WORKSPACE_COOKIE, resolveActiveWorkspace } from "$lib/kumiai/active-workspace.js";
import type { TeamInfo } from "$lib/api/types.js";

const EMPTY_STATS: KumiaiStats = {
	tasksInProgress: 0,
	projectCounts: { backlog: 0, todo: 0, inProgress: 0, blocked: 0, done: 0 },
};

/**
 * The API is served by this same app, so the load event's `fetch` resolves the relative
 * path in-process and forwards the session cookie by itself. Never throws: a dead
 * endpoint degrades the shell instead of 500ing it.
 */
async function fetchShellJson<T>(fetchFn: typeof fetch, path: string): Promise<T | null> {
	try {
		const res = await fetchFn(path);
		if (!res.ok) return null;
		return (await res.json()) as T;
	} catch {
		return null;
	}
}

export const load: LayoutServerLoad = async ({ locals, fetch, url, cookies }) => {
	const user = locals.user;
	if (!user) redirect(303, "/login");
	// Strict `=== false`: a session without the field must not trap the user in the guide.
	if (user.isOnboardingDone === false) redirect(303, "/onboarding");

	// Reading `url.pathname` registers a dependency on the current URL, so this load
	// re-runs on every navigation within the (app) group — that is what keeps the
	// sidebar badges and header pill live without a manual `invalidate` (US-2 AC4).
	void url.pathname;

	// The workspace comes first: the sidebar counts and recent projects are scoped to it.
	// A remembered workspace that no longer exists falls back to the team's default.
	const workspaces = (await fetchShellJson<KumiaiWorkspace[]>(fetch, "/api/kumiai/workspaces")) ?? [];
	const activeWorkspaceId =
		resolveActiveWorkspace(workspaces, cookies.get(ACTIVE_WORKSPACE_COOKIE))?.id ?? null;
	const scope = activeWorkspaceId ? `?workspaceId=${encodeURIComponent(activeWorkspaceId)}` : "";

	const [stats, recentProjects, team] = await Promise.all([
		fetchShellJson<KumiaiStats>(fetch, `/api/kumiai/stats${scope}`),
		fetchShellJson<RecentProject[]>(fetch, `/api/kumiai/recent-projects${scope}`),
		fetchShellJson<TeamInfo>(fetch, "/api/teams/mine"),
	]);

	return {
		user,
		stats: stats ?? EMPTY_STATS,
		recentProjects: recentProjects ?? [],
		team,
		workspaces,
		activeWorkspaceId,
	};
};
