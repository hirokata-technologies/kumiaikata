import type { PageServerLoad } from "./$types";
import type { Project } from "$lib/kumiai/types.js";
import { loadWorkspace } from "$lib/kumiai/load.js";

export const load: PageServerLoad = async ({ params, fetch }) => {
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
	const { workspace, failed } = await loadWorkspace(fetch);

	return { notFound: false as const, project, workspace, failed };
};
