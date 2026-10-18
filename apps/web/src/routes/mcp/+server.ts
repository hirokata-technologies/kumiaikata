import type { RequestHandler } from './$types';

/**
 * The remote MCP endpoint (docs/guild-contract.md §1): Streamable HTTP, stateless,
 * OAuth 2.1 Bearer tokens. Served by @kata/api's `mcpHandler`, which verifies the
 * token and answers 401 + `WWW-Authenticate` when it is missing or invalid. GET and
 * DELETE (2025 session operations) are answered 405 by the handler itself.
 *
 * Imported lazily so the backend is not evaluated during `vite build`.
 */
export const fallback: RequestHandler = async ({ request }) => {
	const { mcpHandler } = await import('@kata/api');
	return mcpHandler(request);
};
