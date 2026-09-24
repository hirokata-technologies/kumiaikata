import { redirect } from "@sveltejs/kit";
import type { PageServerLoad } from "./$types";

// Explicit `: void` return annotation — both branches call `redirect()`, whose return
// type is `never`, so without this annotation TS infers the function itself as
// returning `never`. That collapses this route's generated `PageData` to `never`
// (a naked `never` type parameter short-circuits distributive conditional types), which
// breaks the still-on-disk (but unreachable) src/routes/+page.svelte's typecheck.
export const load: PageServerLoad = ({ locals }): void => {
	if (!locals.user) redirect(303, "/login");
	redirect(303, "/week");
};
