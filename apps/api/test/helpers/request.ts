import app from "../../src/app.js";

/**
 * Fire a JSON request against the Hono app without starting an HTTP server.
 * Uses app.request() which is Hono's built-in test helper.
 */
export async function apiRequest(
	method: string,
	path: string,
	opts?: { body?: unknown; headers?: Record<string, string> },
): Promise<Response> {
	return app.request(
		new Request(`http://localhost${path}`, {
			method,
			headers: {
				"content-type": "application/json",
				...opts?.headers,
			},
			body: opts?.body !== undefined ? JSON.stringify(opts.body) : undefined,
		}),
	);
}

/**
 * Fire a raw request against the Hono app — use for multipart/form-data uploads
 * or any case where you need to control the request body and headers exactly.
 */
export async function apiRequestRaw(req: Request): Promise<Response> {
	return app.request(req);
}
