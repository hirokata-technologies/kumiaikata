import { redirect } from "@sveltejs/kit";
import type { PageServerLoad } from "./$types";

// Explicit `void` return annotation — every path calls `redirect()`, whose return
// type is `never`, so without it TS infers `never` and collapses this route's generated
// `PageData` (breaking the still-on-disk but unreachable src/routes/+page.svelte typecheck).
export const load: PageServerLoad = ({ locals }): void => {
	if (!locals.user) redirect(303, "/login");

	// Goals & Projects is the only planning view, so every signed-in user lands there.
	redirect(303, "/roadmap");
};
