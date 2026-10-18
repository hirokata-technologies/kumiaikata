import { requireMcpAuth } from "@better-auth/mcp";
import { auth } from "../auth/better-auth.js";
import { resolveMcpUser, type McpUser, type McpUserRejection } from "./context.js";
import { MCP_RESOURCE } from "./resource.js";

/** The verified access-token payload `requireMcpAuth` hands to its handler. */
type AccessTokenClaims = Parameters<Parameters<typeof requireMcpAuth>[1]>[1];

/** Why a bearer request was refused. `challenge` is the RFC 9728 `WWW-Authenticate` value. */
export type BearerFailure =
	| { kind: "unauthenticated"; status: number; challenge: string | null }
	| { kind: "rejected"; rejection: McpUserRejection };

/** True when the request carries an `Authorization: Bearer|DPoP …` access token. */
export function hasAccessToken(request: Request): boolean {
	return /^(Bearer|DPoP)\s+\S/i.test(request.headers.get("authorization") ?? "");
}

/**
 * Verify a request's OAuth access token exactly as POST /mcp does — `requireMcpAuth`
 * against Better Auth's JWKS, audience = {@link MCP_RESOURCE} — and resolve its user
 * with `resolveMcpUser`. Lets the REST/RPC guild API accept the same token.
 */
export async function authenticateAccessToken(
	request: Request,
): Promise<{ ok: true; user: McpUser } | { ok: false; failure: BearerFailure }> {
	let claims: AccessTokenClaims | undefined;
	const verify = requireMcpAuth(
		auth,
		(_request, verified) => {
			claims = verified;
			return new Response(null, { status: 204 });
		},
		{ resource: MCP_RESOURCE },
	);
	// Only the method, URL and auth headers matter for verification; never hand it the body.
	const response = await verify(new Request(request.url, { method: request.method, headers: request.headers }));
	if (!claims) {
		return {
			ok: false,
			failure: {
				kind: "unauthenticated",
				status: response.status,
				challenge: response.headers.get("www-authenticate"),
			},
		};
	}
	if (!claims.sub) return { ok: false, failure: { kind: "rejected", rejection: "UNKNOWN_USER" } };
	const resolved = await resolveMcpUser(claims.sub);
	if ("rejection" in resolved) return { ok: false, failure: { kind: "rejected", rejection: resolved.rejection } };
	return { ok: true, user: resolved.user };
}
