// Library entry point. apps/web imports this and mounts the Hono app under
// SvelteKit; there is no standalone server (see src/routes/api/[...path]/+server.ts
// in apps/web).
export { app } from "./app.js";
export { auth } from "./auth/better-auth.js";
