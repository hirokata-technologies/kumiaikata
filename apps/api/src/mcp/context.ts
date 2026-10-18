import { eq } from "drizzle-orm";
import { db, teamMembers, teams, users } from "@kata/db";
import type { AuthInfo, ServerContext } from "@modelcontextprotocol/server";
import { isAllowedDomain } from "../auth/domain-allowlist.js";

/**
 * The authenticated caller of an MCP request: the Kumiai user the access token was
 * issued to, plus their team workspace (one domain = one team, see CLAUDE.md).
 */
export interface McpUser {
	id: string;
	email: string;
	name: string | null;
	team: { id: string; name: string };
}

/** Key under `AuthInfo.extra` that carries the resolved {@link McpUser}. */
const MCP_USER_KEY = "kumiaiUser";

/**
 * Why a verified token still cannot be served: the user is gone, their domain is no
 * longer allow-listed, or they belong to no team workspace.
 */
export type McpUserRejection = "UNKNOWN_USER" | "DOMAIN_NOT_ALLOWED" | "NO_TEAM";

/**
 * Load the user named by a token's `sub` claim and their team (via team_members, the
 * same rule as `loadTeamAccess`).
 */
export async function resolveMcpUser(
	userId: string,
): Promise<{ user: McpUser } | { rejection: McpUserRejection }> {
	const [user] = await db
		.select({ id: users.id, email: users.email, name: users.name })
		.from(users)
		.where(eq(users.id, userId))
		.limit(1);
	if (!user) return { rejection: "UNKNOWN_USER" };
	// Defence in depth: accounts can only be created for allow-listed domains, but a
	// token must never outlive a domain's removal from the list.
	if (!isAllowedDomain(user.email)) return { rejection: "DOMAIN_NOT_ALLOWED" };

	const [team] = await db
		.select({ id: teams.id, name: teams.name })
		.from(teamMembers)
		.innerJoin(teams, eq(teams.id, teamMembers.teamId))
		.where(eq(teamMembers.userId, user.id))
		.limit(1);
	if (!team) return { rejection: "NO_TEAM" };

	return { user: { ...user, team } };
}

/** Build the SDK `AuthInfo` handed to the MCP server for one request. */
export function buildAuthInfo(input: {
	token: string;
	clientId: string;
	scopes: string[];
	expiresAt: number | undefined;
	resource: string;
	user: McpUser;
}): AuthInfo {
	return {
		token: input.token,
		clientId: input.clientId,
		scopes: input.scopes,
		...(input.expiresAt !== undefined ? { expiresAt: input.expiresAt } : {}),
		resource: new URL(input.resource),
		extra: { [MCP_USER_KEY]: input.user },
	};
}

/** The resolved user carried on an `AuthInfo`, if any. */
export function mcpUserFromAuthInfo(authInfo: AuthInfo | undefined): McpUser | null {
	const value = authInfo?.extra?.[MCP_USER_KEY];
	return value && typeof value === "object" ? (value as McpUser) : null;
}

/**
 * The authenticated Kumiai user of the tool call. Every request reaching a tool has
 * passed `mcpHandler`'s token check, so a missing user is a wiring bug.
 *
 * @example
 * server.registerTool("my_tool", { … }, async (args, ctx) => {
 *   const user = getMcpUser(ctx); // { id, email, name, team: { id, name } }
 * });
 */
export function getMcpUser(ctx: Pick<ServerContext, "http">): McpUser {
	const user = mcpUserFromAuthInfo(ctx.http?.authInfo);
	if (!user) throw new Error("MCP request reached a tool without an authenticated user.");
	return user;
}
