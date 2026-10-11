import { createAuthClient } from "better-auth/svelte";

// No baseURL: Better Auth is served by this app at /api/auth, so the client uses the
// page origin.
export const authClient = createAuthClient();
