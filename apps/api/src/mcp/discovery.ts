import { auth } from "../auth/better-auth.js";

/** Better Auth's base path; it is also the OAuth issuer path (`<origin>/api/auth`). */
const ISSUER_PATH = "/api/auth";

/**
 * Root `/.well-known/*` documents → the path Better Auth's discovery hook answers.
 * The hook (`onRequest` of the mcp / oauth-provider plugins) runs before Better
 * Auth's base-path routing, so `auth.handler` serves these at the origin root.
 *
 * - Protected-resource metadata (RFC 9728): the plain path and the `/mcp`-suffixed
 *   one clients derive from the resource URL.
 * - Authorization-server metadata (RFC 8414): the issuer-path form
 *   (`/.well-known/oauth-authorization-server/api/auth`) and the bare root form
 *   older MCP clients probe.
 * - OpenID configuration: the bare root and path-inserted forms, both mapped to the
 *   issuer-relative `/api/auth/.well-known/openid-configuration`.
 */
const WELL_KNOWN_ROUTES: Record<string, string> = {
	"/.well-known/oauth-protected-resource": "/.well-known/oauth-protected-resource",
	"/.well-known/oauth-protected-resource/mcp": "/.well-known/oauth-protected-resource/mcp",
	"/.well-known/oauth-authorization-server": `/.well-known/oauth-authorization-server${ISSUER_PATH}`,
	[`/.well-known/oauth-authorization-server${ISSUER_PATH}`]: `/.well-known/oauth-authorization-server${ISSUER_PATH}`,
	"/.well-known/openid-configuration": `${ISSUER_PATH}/.well-known/openid-configuration`,
	[`/.well-known/openid-configuration${ISSUER_PATH}`]: `${ISSUER_PATH}/.well-known/openid-configuration`,
};

/**
 * Serve the OAuth / MCP discovery documents at the origin root (apps/web routes
 * `/.well-known/*` here). Unknown paths answer 404.
 */
export async function wellKnownHandler(request: Request): Promise<Response> {
	const url = new URL(request.url);
	const target = WELL_KNOWN_ROUTES[url.pathname.replace(/\/+$/, "")];
	if (!target) return new Response("Not Found", { status: 404 });

	url.pathname = target;
	const response = await auth.handler(new Request(url, { method: request.method, headers: request.headers }));
	// Discovery documents are public: let browser-based MCP clients read them.
	const headers = new Headers(response.headers);
	headers.set("Access-Control-Allow-Origin", "*");
	return new Response(response.body, { status: response.status, headers });
}
