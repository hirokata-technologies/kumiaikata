import { Hono } from "hono";
import { boards as boardsColl, teamMembers as teamMembersColl } from "../db/schemas/index.js";
import { ObjectId } from "mongodb";
import { AppError } from "../http/error.js";
import { ok } from "../http/responders.js";
import { requireSession } from "../auth/middleware.js";
import { getBoardWithColumnsAndCards } from "../services/boards.js";
import type { AppVariables } from "../http/types.js";

const r = new Hono<{ Variables: AppVariables }>();

r.use("*", requireSession);

r.get("/personal", async (c) => {
	const user = c.get("user");
	// Better Auth user IDs are strings; ownerId is stored as string via type cast.
	const board = await boardsColl().findOne({
		kind: "personal",
		ownerId: user.id as unknown as ObjectId,
	});
	if (!board) {
		throw new AppError(
			"NOT_FOUND",
			"Personal board missing — provisioning may have failed.",
		);
	}
	return ok(c, await getBoardWithColumnsAndCards(String(board._id)));
});

r.get("/team", async (c) => {
	const user = c.get("user");
	// Better Auth user IDs are strings; userId is stored as string via type cast.
	const membership = await teamMembersColl().findOne({
		userId: user.id as unknown as ObjectId,
	});
	if (!membership) {
		throw new AppError("NOT_FOUND", "No team membership found.");
	}
	const board = await boardsColl().findOne({
		kind: "team",
		teamId: membership.teamId,
	});
	if (!board) {
		throw new AppError("NOT_FOUND", "Team board missing.");
	}
	return ok(c, await getBoardWithColumnsAndCards(String(board._id)));
});

export default r;
