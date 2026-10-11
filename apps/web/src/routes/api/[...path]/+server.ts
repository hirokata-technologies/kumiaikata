import type { RequestHandler } from './$types';

/**
 * Every /api/* request is served by the Hono app from @kata/api (Better Auth at
 * /api/auth/*, REST routes, and the board SSE stream). SvelteKit only forwards the
 * Request and returns Hono's Response untouched, so streaming bodies (SSE) are
 * flushed chunk by chunk by adapter-node.
 *
 * `fallback` handles every HTTP method. The app is imported lazily so that the
 * backend (env validation, database pool) is not evaluated during `vite build`.
 */
export const fallback: RequestHandler = async ({ request }) => {
	const { app } = await import('@kata/api');
	return app.fetch(request);
};
