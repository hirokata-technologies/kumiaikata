import { createAuthClient } from "better-auth/svelte";
import { inferAdditionalFields } from "better-auth/client/plugins";
import { oauthProviderClient } from "@better-auth/oauth-provider/client";

// No baseURL: Better Auth is served by this app at /api/auth, so the client uses the
// page origin.
export const authClient = createAuthClient({
	plugins: [
		// Mirrors the user additionalFields in apps/api/src/auth/better-auth.ts.
		inferAdditionalFields({ user: { isOnboardingDone: { type: "boolean", required: false } } }),
		// OAuth (MCP) sign-in: when /login or /consent was opened by an authorization
		// request, attaches its signed query (`oauth_query`) to sign-in and consent
		// calls so the server continues the authorization afterwards. No-op otherwise.
		oauthProviderClient(),
	],
});
