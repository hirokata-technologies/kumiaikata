import { error, redirect } from "@sveltejs/kit";
import type { PageServerLoad } from "./$types";

/** Plain-language meaning of each OAuth scope the MCP authorization server issues. */
const SCOPE_DESCRIPTIONS: Record<string, string> = {
	openid: "Confirm who you are",
	profile: "See your name and profile picture",
	email: "See your email address",
	offline_access: "Stay connected without asking you to sign in again",
};

interface PublicClient {
	client_id: string;
	client_name?: string;
	client_uri?: string;
}

/**
 * Better Auth sends the user here (with a signed copy of the authorization request)
 * when an OAuth client — e.g. Claude Code connecting to /mcp — needs their consent.
 */
export const load: PageServerLoad = async ({ locals, url, request }) => {
	const clientId = url.searchParams.get("client_id");
	if (!clientId || !url.searchParams.has("sig")) error(400, "Missing or unsigned authorization request.");
	// The signed query is accepted by /login too, which continues back here after sign-in.
	if (!locals.user) redirect(303, `/login${url.search}`);

	const { auth } = await import("@kata/api");
	const lookup = new URL("/api/auth/oauth2/public-client", url.origin);
	lookup.searchParams.set("client_id", clientId);
	const res = await auth.handler(new Request(lookup, { headers: request.headers }));
	if (!res.ok) error(404, "This app is not registered.");
	const client = (await res.json()) as PublicClient;

	const scopes = (url.searchParams.get("scope") ?? "").split(" ").filter(Boolean);
	let redirectHost: string | null = null;
	try {
		redirectHost = new URL(url.searchParams.get("redirect_uri") ?? "").host || null;
	} catch {
		redirectHost = null;
	}

	return {
		client: {
			name: client.client_name ?? clientId,
			uri: client.client_uri ?? null,
		},
		redirectHost,
		scopes: scopes.map((scope) => ({ scope, description: SCOPE_DESCRIPTIONS[scope] ?? scope })),
		account: { email: locals.user.email, name: locals.user.name ?? null },
	};
};
