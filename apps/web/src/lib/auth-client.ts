import { createAuthClient } from "better-auth/svelte";
import { PUBLIC_API_URL } from "$env/dynamic/public";

export const authClient = createAuthClient({
	baseURL: PUBLIC_API_URL,
});
