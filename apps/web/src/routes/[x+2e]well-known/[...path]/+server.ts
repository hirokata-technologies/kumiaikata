import type { RequestHandler } from './$types';

/**
 * (Directory `[x+2e]well-known` is SvelteKit's escape for `.well-known`, so the route
 * stays inside the tsconfig / lint globs, which skip dot-directories.)
 *
 * OAuth / MCP discovery documents at the origin root (RFC 9728 protected-resource
 * metadata, RFC 8414 authorization-server metadata, OpenID configuration), served
 * by Better Auth through @kata/api's `wellKnownHandler`. Other paths answer 404.
 */
const serve: RequestHandler = async ({ request }) => {
	const { wellKnownHandler } = await import('@kata/api');
	return wellKnownHandler(request);
};

export const GET = serve;
export const HEAD = serve;
