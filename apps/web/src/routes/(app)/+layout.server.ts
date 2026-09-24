import { redirect } from "@sveltejs/kit";
import { env } from "$env/dynamic/private";
import type { LayoutServerLoad } from "./$types";
import type { KumiaiStats, RecentProject } from "$lib/api/kumiai/types.js";
import type { TeamInfo } from "$lib/api/types.js";

const EMPTY_STATS: KumiaiStats = {
	tasksInProgress: 0,
	projectCounts: { backlog: 0, todo: 0, inProgress: 0, blocked: 0, done: 0 },
};

/**
 * The API is a different origin (`API_URL`), so the load event's `fetch` does not carry
 * the session cookie automatically — forward it by hand, exactly as `hooks.server.ts`
 * does for `get-session`. Never throws: a dead endpoint degrades the shell instead of
 * 500ing it.
 */
async function fetchShellJson<T>(
	fetchFn: typeof fetch,
	path: string,
	cookie: string,
): Promise<T | null> {
	try {
		const res = await fetchFn(`${env.API_URL}${path}`, { headers: { cookie } });
		if (!res.ok) return null;
		return (await res.json()) as T;
	} catch {
		return null;
	}
}

export const load: LayoutServerLoad = async ({ locals, request, fetch, url }) => {
	const user = locals.user;
	if (!user) redirect(303, "/login");

	// Reading `url.pathname` registers a dependency on the current URL, so this load
	// re-runs on every navigation within the (app) group — that is what keeps the
	// sidebar badges and header pill live without a manual `invalidate` (US-2 AC4).
	void url.pathname;

	const cookie = request.headers.get("cookie") ?? "";

	const [stats, recentProjects, team] = await Promise.all([
		fetchShellJson<KumiaiStats>(fetch, "/api/kumiai/stats", cookie),
		fetchShellJson<RecentProject[]>(fetch, "/api/kumiai/recent-projects", cookie),
		fetchShellJson<TeamInfo>(fetch, "/api/teams/mine", cookie),
	]);

	return {
		user,
		stats: stats ?? EMPTY_STATS,
		recentProjects: recentProjects ?? [],
		team,
	};
};
