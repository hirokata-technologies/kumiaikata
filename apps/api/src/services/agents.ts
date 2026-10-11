import { asc, eq } from "drizzle-orm";
import { db, teamMembers } from "@kata/db";
import { AppError } from "@kata/http";

/** Workspace id of a user's private workspace; team workspaces use their team id. */
export const PERSONAL_WORKSPACE_ID = "personal";

/**
 * Resolve which workspace an agents request acts in.
 *
 * - `requested` omitted: the user's team workspace (the domain workspace), or their
 *   personal workspace if they belong to no team.
 * - `requested` = "personal": the user's personal workspace.
 * - otherwise it must be the id of a team the user is a member of.
 */
export async function resolveAgentWorkspace(
	userId: string,
	requested?: string,
): Promise<string> {
	if (requested === PERSONAL_WORKSPACE_ID) return PERSONAL_WORKSPACE_ID;

	const memberships = await db
		.select({ teamId: teamMembers.teamId })
		.from(teamMembers)
		.where(eq(teamMembers.userId, userId))
		.orderBy(asc(teamMembers.joinedAt));

	if (requested === undefined) {
		return memberships[0]?.teamId ?? PERSONAL_WORKSPACE_ID;
	}
	if (!memberships.some((m) => m.teamId === requested)) {
		throw new AppError("FORBIDDEN", "You are not a member of this workspace.");
	}
	return requested;
}

/**
 * The ADK user id. Agent Runtime scopes sessions (and memories) to it, so it is
 * always derived here from the authenticated user and a validated workspace, never
 * taken from the client.
 */
export function agentUserId(workspaceId: string, userId: string): string {
	return `${workspaceId}:${userId}`;
}
