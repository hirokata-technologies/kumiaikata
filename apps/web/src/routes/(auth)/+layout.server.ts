import { redirect } from "@sveltejs/kit";
import type { LayoutServerLoad } from "./$types";

export const load: LayoutServerLoad = ({ locals, url }) => {
	// An OAuth authorization request (signed query, `sig`) may send a signed-in user to
	// /login, e.g. with `prompt=login`: let them re-authenticate instead of bouncing home.
	const isOAuthRequest = url.searchParams.has("sig") && url.searchParams.has("client_id");
	if (locals.user && !isOAuthRequest) redirect(303, "/");
};
