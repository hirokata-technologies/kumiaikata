import { isRedirect, redirect } from "@sveltejs/kit";
import type { PageServerLoad } from "./$types";
import type { Goal, Project } from "$lib/kumiai/types.js";
import { ACTIVE_WORKSPACE_COOKIE, WORKSPACE_COOKIE_MAX_AGE } from "$lib/kumiai/active-workspace.js";
import { loadWorkspace } from "$lib/kumiai/load.js";

export const load: PageServerLoad = async ({ params, fetch, parent, cookies, url }) => {
	let project: Project | null = null;
	try {
		const res = await fetch(`/api/kumiai/projects/${params.id}`);
		if (res.ok) {
			project = (await res.json()) as Project;
		}
	} catch {
		project = null;
	}

	// A missing id (404) or any other failure renders a not-found state rather than
	// crashing the page (US-3 edge case) — never record a project that failed to load.
	if (!project) {
		return { notFound: true as const, project: null };
	}

	// A project opened from a link, search or history may live in another workspace. Move to
	// its workspace and reload, so the sidebar and the joined data agree with the page.
	const { activeWorkspaceId } = await parent();
	try {
		const goalRes = await fetch(`/api/kumiai/goals/${project.goalId}`);
		const goal = goalRes.ok ? ((await goalRes.json()) as Goal) : null;
		if (activeWorkspaceId && goal && goal.workspaceId !== activeWorkspaceId) {
			cookies.set(ACTIVE_WORKSPACE_COOKIE, goal.workspaceId, {
				path: "/",
				maxAge: WORKSPACE_COOKIE_MAX_AGE,
				httpOnly: false,
				sameSite: "lax",
			});
			redirect(303, url.pathname);
		}
	} catch (e) {
		if (isRedirect(e)) throw e;
		// Best-effort — the page still renders, just without moving workspace.
	}

	try {
		await fetch("/api/kumiai/recent-projects", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ projectId: params.id }),
		});
	} catch {
		// Best-effort — a failed "touch" shouldn't break the page render.
	}

	// The requirements, plans and tasks that hang off the project come from the same joined
	// workspace every planning view reads.
	const { workspace, failed } = await loadWorkspace(fetch, activeWorkspaceId);

	return { notFound: false as const, project, workspace, failed };
};
