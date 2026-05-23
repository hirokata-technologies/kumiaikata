import { ObjectId } from "mongodb";
import { teams, teamMembers } from "../db/schemas/index.js";
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
	// Better Auth user IDs are strings (not ObjectId); stored as string in teamMembers.userId.
	const membership = await teamMembers().findOne({
		userId: userId as unknown as ObjectId,
	});
	if (!membership) {
		throw new AppError("NOT_FOUND", "No team membership found.");
	}
	const team = await teams().findOne({ _id: membership.teamId });
	if (!team) {
		throw new AppError("NOT_FOUND", "Team not found.");
	}
	return {
		id: String(team._id),
		domain: team.domain,
		name: team.name,
		role: membership.role,
	};
}

export async function listMembers(teamId: string): Promise<TeamMemberRow[]> {
	const rows = await teamMembers()
		.find({ teamId: new ObjectId(teamId) })
		.toArray();
	return rows.map((r) => ({
		userId: String(r.userId),
		email: "",
		role: r.role,
		joinedAt: r.joinedAt,
	}));
}

export async function setMemberRole(
	teamId: string,
	targetUserId: string,
	newRole: Role,
	actorId: string,
): Promise<{ userId: string; role: Role }> {
	const teamObjId = new ObjectId(teamId);

	// Better Auth user IDs are strings (not ObjectId); use as-is with type cast.
	const actorMembership = await teamMembers().findOne({
		teamId: teamObjId,
		userId: actorId as unknown as ObjectId,
	});
	if (!actorMembership || actorMembership.role !== "admin") {
		throw new AppError("FORBIDDEN", "Only team admins may change roles.");
	}

	const target = await teamMembers().findOne({
		teamId: teamObjId,
		userId: targetUserId as unknown as ObjectId,
	});
	if (!target) {
		throw new AppError("NOT_FOUND", "User is not a member of this team.");
	}

	if (target.role === "admin" && newRole === "member") {
		const adminCount = await teamMembers().countDocuments({
			teamId: teamObjId,
			role: "admin",
		});
		if (adminCount <= 1) {
			throw new AppError(
				"CONFLICT",
				"At least one admin must remain on the team.",
			);
		}
	}

	await teamMembers().updateOne(
		{ _id: target._id },
		{ $set: { role: newRole } },
	);

	return { userId: targetUserId, role: newRole };
}
