import { redirect } from "@sveltejs/kit";
import type { PageServerLoad } from "./$types";

export const load: PageServerLoad = ({ locals }): void => {
	if (!locals.user) redirect(303, "/login");
	if (locals.user.isOnboardingDone) redirect(303, "/week");
};
