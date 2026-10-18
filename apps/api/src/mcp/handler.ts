import { requireMcpAuth } from "@better-auth/mcp";
import { createMcpHandler } from "@modelcontextprotocol/server";
import { auth } from "../auth/better-auth.js";
import { buildAuthInfo, resolveMcpUser, type McpUserRejection } from "./context.js";
import { MCP_RESOURCE } from "./resource.js";
import { createKumiaiMcpServer } from "./server.js";

// Stateless Streamable HTTP. Legacy (2025-era) traffic is served too — the default
// `legacy: "stateless"` — so current Claude Code clients that still open with the
// `initialize` handshake keep working.
const mcpServerHandler = createMcpHandler(() => createKumiaiMcpServer(), {
	onerror: (error) => console.error("[mcp]", error.message),
});

/** The verified access-token payload `requireMcpAuth` hands to the handler. */
type AccessTokenClaims = Parameters<Parameters<typeof requireMcpAuth>[1]>[1];

/** What a caller is told when a verified token's user cannot be served (shared with REST). */
export const REJECTION_MESSAGES: Record<McpUserRejection, string> = {
	UNKNOWN_USER: "The account this token was issued to no longer exists.",
	DOMAIN_NOT_ALLOWED: "This account's email domain is not permitted.",
	NO_TEAM: "Not a member of any team workspace.",
};

function forbidden(rejection: McpUserRejection): Response {
	return Response.json(
		{ jsonrpc: "2.0", error: { code: -32_000, message: REJECTION_MESSAGES[rejection] }, id: null },
		{ status: 403 },
	);
}

/** The raw access token from `Authorization: Bearer …` (or `DPoP …`). */
function accessTokenOf(request: Request): string {
	const header = request.headers.get("authorization") ?? "";
	return header.replace(/^(Bearer|DPoP)\s+/i, "");
}

function scopesOf(claims: AccessTokenClaims): string[] {
	return typeof claims["scope"] === "string" ? claims["scope"].split(" ").filter(Boolean) : [];
}

function clientIdOf(claims: AccessTokenClaims): string {
	const id = claims["azp"] ?? claims["client_id"];
	return typeof id === "string" ? id : "";
}

/**
 * `POST /mcp`: verifies the OAuth access token (JWT signed by Better Auth, audience
 * = {@link MCP_RESOURCE}), resolves the Kumiai user from its `sub`, and serves the
 * MCP request with that user on `AuthInfo` (read it in tools with `getMcpUser`).
 * Unauthenticated requests get 401 + an RFC 9728 `WWW-Authenticate` challenge.
 */
export const mcpHandler: (request: Request) => Promise<Response> = requireMcpAuth(
	auth,
	async (request, claims) => {
		if (!claims.sub) return forbidden("UNKNOWN_USER");
		const resolved = await resolveMcpUser(claims.sub);
		if ("rejection" in resolved) return forbidden(resolved.rejection);

		const authInfo = buildAuthInfo({
			token: accessTokenOf(request),
			clientId: clientIdOf(claims),
			scopes: scopesOf(claims),
			expiresAt: claims.exp,
			resource: MCP_RESOURCE,
			user: resolved.user,
		});
		return mcpServerHandler.fetch(request, { authInfo });
	},
	{ resource: MCP_RESOURCE },
);
