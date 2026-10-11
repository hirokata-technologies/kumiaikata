import type { RequestHandler } from './$types';

/**
 * Liveness/readiness probe: answers 200 `{ ok: true, db: true }` when the database
 * is reachable, 503 otherwise. Delegates to the Hono `/healthz` route.
 */
export const GET: RequestHandler = async ({ request }) => {
	const { app } = await import('@kata/api');
	return app.fetch(request);
};
