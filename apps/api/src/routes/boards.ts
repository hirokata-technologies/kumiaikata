import { Hono } from "hono";
import { eq, and } from "drizzle-orm";
import { db } from "@kata/db";
import { boards, teamMembers, users } from "@kata/db";
import { AppError } from "@kata/http";
import { ok } from "../http/responders.js";
import { requireSession } from "../auth/middleware.js";
import { getBoardWithColumnsAndCards } from "../services/boards.js";
import type { AppVariables } from "@kata/http";

const r = new Hono<{ Variables: AppVariables }>();
r.use("*", requireSession);

r.get("/personal", async (c) => {
	const user = c.get("user");
	// Use the denormalised pointer first — single-row lookup.
	const [u] = await db.select({ personalBoardId: users.personalBoardId })
		.from(users).where(eq(users.id, user.id)).limit(1);

	let boardId = u?.personalBoardId ?? null;
	if (!boardId) {
		// Fall back to scanning boards by ownerId in case the denormalised pointer
		// is missing (defence-in-depth against provisioning regressions).
		const [b] = await db.select({ id: boards.id }).from(boards)
			.where(and(eq(boards.kind, "personal"), eq(boards.ownerId, user.id)))
			.limit(1);
		boardId = b?.id ?? null;
	}
	if (!boardId) {
		throw new AppError("NOT_FOUND", "Personal board missing — provisioning may have failed.");
	}
	return ok(c, await getBoardWithColumnsAndCards(boardId));
});

r.get("/team", async (c) => {
	const user = c.get("user");
	const [membership] = await db.select({ teamId: teamMembers.teamId })
		.from(teamMembers).where(eq(teamMembers.userId, user.id)).limit(1);
	if (!membership) throw new AppError("NOT_FOUND", "No team membership found.");
	const [board] = await db.select({ id: boards.id }).from(boards)
		.where(and(eq(boards.kind, "team"), eq(boards.teamId, membership.teamId)))
		.limit(1);
	if (!board) throw new AppError("NOT_FOUND", "Team board missing.");
	return ok(c, await getBoardWithColumnsAndCards(board.id));
});

export default r;
