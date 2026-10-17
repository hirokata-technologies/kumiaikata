import { createAuthClient } from "better-auth/svelte";
import { inferAdditionalFields } from "better-auth/client/plugins";

// No baseURL: Better Auth is served by this app at /api/auth, so the client uses the
// page origin.
export const authClient = createAuthClient({
	// Mirrors the user additionalFields in apps/api/src/auth/better-auth.ts.
	plugins: [inferAdditionalFields({ user: { isOnboardingDone: { type: "boolean", required: false } } })],
});
