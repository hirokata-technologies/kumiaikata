import { eq, and, count } from "drizzle-orm";
import { db } from "../db/client.js";
import { teams, teamMembers, users } from "../db/schema/index.js";
import { AppError } from "../http/error.js";
import type { Role } from "../db/types.js";

export interface TeamForUser {
	id: string;
	domain: string;
	name: string;
	role: Role;
}

export interface TeamMemberRow {
	userId: string;
	email: string;
	role: Role;
	joinedAt: Date;
}

export async function getTeamForUser(userId: string): Promise<TeamForUser> {
	const [membership] = await db
		.select()
		.from(teamMembers)
		.where(eq(teamMembers.userId, userId))
		.limit(1);
	if (!membership) {
		throw new AppError("NOT_FOUND", "No team membership found.");
	}

	const [team] = await db
		.select()
		.from(teams)
		.where(eq(teams.id, membership.teamId))
		.limit(1);
	if (!team) {
		throw new AppError("NOT_FOUND", "Team not found.");
	}

	return {
		id: team.id,
		domain: team.domain,
		name: team.name,
		role: membership.role as Role,
	};
}

export async function listMembers(teamId: string): Promise<TeamMemberRow[]> {
	const rows = await db
		.select({
			userId: teamMembers.userId,
			email: users.email,
			role: teamMembers.role,
			joinedAt: teamMembers.joinedAt,
		})
		.from(teamMembers)
		.leftJoin(users, eq(users.id, teamMembers.userId))
		.where(eq(teamMembers.teamId, teamId));
	return rows.map((r) => ({
		userId: r.userId,
		email: r.email ?? "",
		role: r.role as Role,
		joinedAt: r.joinedAt,
	}));
}

export async function setMemberRole(
	teamId: string,
	targetUserId: string,
	newRole: Role,
	actorId: string,
): Promise<{ userId: string; role: Role }> {
	// Verify actor is admin.
	const [actorMembership] = await db
		.select()
		.from(teamMembers)
		.where(and(eq(teamMembers.teamId, teamId), eq(teamMembers.userId, actorId)))
		.limit(1);
	if (!actorMembership || actorMembership.role !== "admin") {
		throw new AppError("FORBIDDEN", "Only team admins may change roles.");
	}

	// Find target membership.
	const [target] = await db
		.select()
		.from(teamMembers)
		.where(and(eq(teamMembers.teamId, teamId), eq(teamMembers.userId, targetUserId)))
		.limit(1);
	if (!target) {
		throw new AppError("NOT_FOUND", "User is not a member of this team.");
	}

	// Prevent demoting the last admin.
	if (target.role === "admin" && newRole === "member") {
		const result = await db
			.select({ adminCount: count() })
			.from(teamMembers)
			.where(and(eq(teamMembers.teamId, teamId), eq(teamMembers.role, "admin")));
		const adminCount = result[0]?.adminCount ?? 0;
		if (adminCount <= 1) {
			throw new AppError(
				"CONFLICT",
				"At least one admin must remain on the team.",
			);
		}
	}

	await db
		.update(teamMembers)
		.set({ role: newRole })
		.where(eq(teamMembers.id, target.id));

	return { userId: targetUserId, role: newRole };
}
