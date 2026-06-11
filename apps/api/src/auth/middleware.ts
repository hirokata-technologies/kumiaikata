import { eq, and } from "drizzle-orm";
import { createMiddleware } from "hono/factory";
import type { AppVariables, BoardAccess } from "../http/types.js";
import { db } from "../db/client.js";
import { boards, teamMembers } from "../db/schema/index.js";
import { AppError } from "../http/error.js";
import { validateId } from "../http/validate.js";
import { auth } from "./better-auth.js";

// ── requireSession ────────────────────────────────────────────────────────────

/**
 * Gate any route behind a valid Better Auth session. Sets `c.get('user')` and
 * `c.get('session')` for downstream handlers.
 */
export const requireSession = createMiddleware<{ Variables: AppVariables }>(
	async (c, next) => {
		const result = await auth.api.getSession({ headers: c.req.raw.headers });
		if (!result) {
			throw new AppError("UNAUTHENTICATED", "Sign-in required.");
		}
		c.set("user", {
			id: result.user.id,
			email: result.user.email,
			name: result.user.name ?? undefined,
		});
		c.set("session", result.session);
		await next();
	},
);

// ── BoardWithMembership ───────────────────────────────────────────────────────

/**
 * Shape returned by `fetchBoardWithMembership`. The `membership` field is
 * present only when the board is a team board and the given user is a member.
 */
export interface BoardWithMembership {
	id: string;
	kind: string;
	title: string;
	ownerId: string | null;
	teamId: string | null;
	membership: { role: string } | null;
}

// ── fetchBoardWithMembership ──────────────────────────────────────────────────

/**
 * Fetch a board and the requesting user's team membership in one round-trip
 * with a LEFT JOIN. This preserves the snapshot-consistency guarantee from
 * the old MongoDB $lookup aggregation: board existence and membership are
 * read from the same transaction snapshot.
 *
 * Returns `null` when no board with `boardId` exists.
 */
export async function fetchBoardWithMembership(
	boardId: string,
	userId: string,
): Promise<BoardWithMembership | null> {
	if (!boardId) return null;

	const rows = await db
		.select({
			id: boards.id,
			kind: boards.kind,
			title: boards.title,
			ownerId: boards.ownerId,
			teamId: boards.teamId,
			memberRole: teamMembers.role,
		})
		.from(boards)
		.leftJoin(
			teamMembers,
			and(
				eq(teamMembers.teamId, boards.teamId),
				eq(teamMembers.userId, userId),
			),
		)
		.where(eq(boards.id, boardId))
		.limit(1);

	const row = rows[0];
	if (!row) return null;

	return {
		id: row.id,
		kind: row.kind,
		title: row.title,
		ownerId: row.ownerId,
		teamId: row.teamId,
		membership: row.memberRole ? { role: row.memberRole } : null,
	};
}

// ── deriveAccess ──────────────────────────────────────────────────────────────

/**
 * Derive the access level from a board document that already carries its
 * membership data (populated by `fetchBoardWithMembership`). Returns `null`
 * when the user has no access to the board.
 *
 * This function is pure (no additional DB queries) — all data must be
 * supplied by the caller via `fetchBoardWithMembership`.
 */
export function deriveAccess(
	board: BoardWithMembership,
	user: { id: string },
): BoardAccess | null {
	if (board.kind === "personal" && board.ownerId === user.id) {
		return { kind: "personal-owner", boardId: board.id };
	}
	if (board.kind === "team" && board.membership && board.teamId) {
		return {
			kind: board.membership.role === "admin" ? "team-admin" : "team-member",
			boardId: board.id,
			teamId: board.teamId,
		};
	}
	return null;
}

// ── loadBoardAccess ───────────────────────────────────────────────────────────

/**
 * Resolve the authenticated user's access level for the board identified by
 * `:boardId` in the route path. Must be used after `requireSession`.
 * Sets `c.get('board')` and `c.get('access')`.
 *
 * Board existence and team membership are checked in a single LEFT JOIN query
 * to avoid any race between the two reads.
 */
export const loadBoardAccess = createMiddleware<{ Variables: AppVariables }>(
	async (c, next) => {
		const boardId = validateId(c.req.param("boardId"), "boardId");
		const user = c.get("user");

		const board = await fetchBoardWithMembership(boardId, user.id);
		if (!board) {
			throw new AppError("NOT_FOUND", "Board not found.");
		}

		const access = deriveAccess(board, user);

		if (!access) {
			throw new AppError("FORBIDDEN", "You do not have access to this board.");
		}

		const boardCtx: import("../http/types.js").ContextBoard = {
			id: board.id,
			kind: board.kind,
			title: board.title,
			...(board.ownerId !== null && { ownerId: board.ownerId }),
			...(board.teamId !== null && { teamId: board.teamId }),
		};
		c.set("board", boardCtx);
		c.set("access", access);
		await next();
	},
);
