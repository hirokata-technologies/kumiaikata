import { Hono } from "hono";
import { z } from "zod";
import { eq, and } from "drizzle-orm";
import { db } from "@kata/db";
import { teams, teamMembers } from "@kata/db";
import { AppError } from "@kata/http";
import { ok } from "../http/responders.js";
import { zValidator, validateId } from "../http/validate.js";
import { requireSession } from "../auth/middleware.js";
import { listMembers, setMemberRole } from "../services/teams.js";
import type { AppVariables } from "@kata/http";

const r = new Hono<{ Variables: AppVariables }>();

r.use("*", requireSession);

r.get("/mine", async (c) => {
	const user = c.get("user");
	const [m] = await db
		.select()
		.from(teamMembers)
		.where(eq(teamMembers.userId, user.id))
		.limit(1);
	if (!m) {
		throw new AppError("NOT_FOUND", "No team membership.");
	}
	const [team] = await db
		.select()
		.from(teams)
		.where(eq(teams.id, m.teamId))
		.limit(1);
	if (!team) {
		throw new AppError("NOT_FOUND", "Team not found.");
	}
	return ok(c, {
		id: team.id,
		domain: team.domain,
		name: team.name,
		role: m.role,
	});
});

r.get("/:teamId/members", async (c) => {
	const user = c.get("user");
	const teamId = validateId(c.req.param("teamId"), "teamId");

	// Verify the requesting user is a member of this team.
	const [self] = await db
		.select({ id: teamMembers.id })
		.from(teamMembers)
		.where(and(eq(teamMembers.teamId, teamId), eq(teamMembers.userId, user.id)))
		.limit(1);
	if (!self) {
		throw new AppError("FORBIDDEN", "Not a member of this team.");
	}

	return ok(c, await listMembers(teamId));
});

r.patch(
	"/:teamId/members/:userId",
	zValidator("json", z.object({ role: z.enum(["admin", "member"]) })),
	async (c) => {
		const actor = c.get("user");
		const teamId = validateId(c.req.param("teamId"), "teamId");
		const userId = validateId(c.req.param("userId"), "userId");
		const { role } = c.req.valid("json");
		return ok(c, await setMemberRole(teamId, userId, role, actor.id));
	},
);

export default r;
