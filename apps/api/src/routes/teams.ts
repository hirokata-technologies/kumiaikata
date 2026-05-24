import { Hono } from "hono";
import { z } from "zod";
import { ObjectId } from "mongodb";
import {
	teams as teamsColl,
	teamMembers as teamMembersColl,
	users as usersColl,
} from "../db/schemas/index.js";
import { AppError } from "../http/error.js";
import { ok } from "../http/responders.js";
import { zValidator, validateObjectId } from "../http/validate.js";
import { requireSession } from "../auth/middleware.js";
import { setMemberRole } from "../services/teams.js";
import type { AppVariables } from "../http/types.js";

const r = new Hono<{ Variables: AppVariables }>();

r.use("*", requireSession);

r.get("/mine", async (c) => {
	const user = c.get("user");
	// Better Auth user IDs are strings; userId is stored as string via type cast.
	const m = await teamMembersColl().findOne({
		userId: user.id as unknown as ObjectId,
	});
	if (!m) {
		throw new AppError("NOT_FOUND", "No team membership.");
	}
	const team = await teamsColl().findOne({ _id: m.teamId });
	if (!team) {
		throw new AppError("NOT_FOUND", "Team not found.");
	}
	return ok(c, {
		id: String(team._id),
		domain: team.domain,
		name: team.name,
		role: m.role,
	});
});

r.get("/:teamId/members", async (c) => {
	const user = c.get("user");
	const teamId = validateObjectId(c.req.param("teamId"), "teamId");
	const teamObjId = new ObjectId(teamId);

	// Better Auth user IDs are strings; userId is stored as string via type cast.
	const self = await teamMembersColl().findOne({
		teamId: teamObjId,
		userId: user.id as unknown as ObjectId,
	});
	if (!self) {
		throw new AppError("FORBIDDEN", "Not a member of this team.");
	}
	const rows = await teamMembersColl().find({ teamId: teamObjId }).toArray();

	// Better Auth user IDs are strings; rows[i].userId is stored as a string
	// even though the schema types it as ObjectId. Convert to string for lookup.
	const userIdStrings = rows.map((row) => String(row.userId));
	const userDocs = await usersColl()
		.find(
			{ _id: { $in: userIdStrings } },
			{ projection: { email: 1 } },
		)
		.toArray();
	const emailById = new Map(userDocs.map((u) => [String(u._id), u.email]));

	return ok(
		c,
		rows.map((row) => ({
			userId: String(row.userId),
			email: emailById.get(String(row.userId)) ?? "",
			role: row.role,
			joinedAt: row.joinedAt,
		})),
	);
});

r.patch(
	"/:teamId/members/:userId",
	zValidator("json", z.object({ role: z.enum(["admin", "member"]) })),
	async (c) => {
		const actor = c.get("user");
		const teamId = validateObjectId(c.req.param("teamId"), "teamId");
		const userId = validateObjectId(c.req.param("userId"), "userId");
		const { role } = c.req.valid("json");
		return ok(c, await setMemberRole(teamId, userId, role, actor.id));
	},
);

export default r;
