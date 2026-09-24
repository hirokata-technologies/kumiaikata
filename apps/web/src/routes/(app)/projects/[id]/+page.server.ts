import { env } from "$env/dynamic/private";
import type { PageServerLoad } from "./$types";
import type { Project } from "$lib/kumiai/types.js";

export const load: PageServerLoad = async ({ params, request, fetch }) => {
	const cookie = request.headers.get("cookie") ?? "";

	let project: Project | null = null;
	try {
		const res = await fetch(`${env.API_URL}/api/kumiai/projects/${params.id}`, {
			headers: { cookie },
		});
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
		await fetch(`${env.API_URL}/api/kumiai/recent-projects`, {
			method: "POST",
			headers: { cookie, "content-type": "application/json" },
			body: JSON.stringify({ projectId: params.id }),
		});
	} catch {
		// Best-effort — a failed "touch" shouldn't break the page render.
	}

	return { notFound: false as const, project };
};
