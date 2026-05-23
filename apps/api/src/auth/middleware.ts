import { ObjectId } from "mongodb";
import { createMiddleware } from "hono/factory";
import type { AppVariables, BoardAccess } from "../http/types.js";
import { boards as boardsColl } from "../db/schemas/index.js";
import { AppError } from "../http/error.js";
import { validateObjectId } from "../http/validate.js";
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
	_id: ObjectId;
	kind: string;
	title: string;
	ownerId?: ObjectId;
	teamId?: ObjectId;
	membership?: { role: string } | null;
}

// ── fetchBoardWithMembership ──────────────────────────────────────────────────

/**
 * Fetch a board and the requesting user's team membership in a single
 * aggregation pipeline. Using one round-trip ensures that the board existence
 * and team membership are read from the same consistent DB snapshot, which
 * eliminates the race condition where membership is revoked between two
 * separate queries.
 *
 * Returns `null` when no board with `boardId` exists.
 */
export async function fetchBoardWithMembership(
	boardId: string,
	userId: string,
): Promise<BoardWithMembership | null> {
	if (!ObjectId.isValid(boardId)) return null;
	const boardObjectId = new ObjectId(boardId);

	// Better Auth user IDs are strings (not ObjectId). The teamMembers.userId
	// field stores these string IDs via type cast (see provisioning.ts).
	// We pass the string directly so the $eq expression matches stored values.
	const cursor = boardsColl().aggregate<BoardWithMembership>([
		{ $match: { _id: boardObjectId } },
		{
			$lookup: {
				from: "teammembers", // preserved Mongoose-default collection name
				let: { teamId: "$teamId" },
				pipeline: [
					{
						$match: {
							$expr: {
								$and: [
									{ $eq: ["$teamId", "$$teamId"] },
									{ $eq: ["$userId", userId] },
								],
							},
						},
					},
					{ $project: { _id: 0, role: 1 } },
					{ $limit: 1 },
				],
				as: "membershipArr",
			},
		},
		{ $addFields: { membership: { $arrayElemAt: ["$membershipArr", 0] } } },
		{ $project: { membershipArr: 0 } },
	]);

	const results = await cursor.toArray();
	return results[0] ?? null;
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
	if (board.kind === "personal" && String(board.ownerId) === String(user.id)) {
		return { kind: "personal-owner", boardId: String(board._id) };
	}
	if (board.kind === "team" && board.membership) {
		return {
			kind: board.membership.role === "admin" ? "team-admin" : "team-member",
			boardId: String(board._id),
			teamId: String(board.teamId),
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
 * Board existence and team membership are checked in a single aggregation
 * pipeline to avoid any race between the two reads.
 */
export const loadBoardAccess = createMiddleware<{ Variables: AppVariables }>(
	async (c, next) => {
		const boardId = validateObjectId(c.req.param("boardId"), "boardId");
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
			_id: board._id,
			kind: board.kind,
			title: board.title as string,
			...(board.ownerId != null && { ownerId: board.ownerId }),
			...(board.teamId != null && { teamId: board.teamId }),
		};
		c.set("board", boardCtx);
		c.set("access", access);
		await next();
	},
);

// ── requireBoardAdmin ─────────────────────────────────────────────────────────

/**
 * Allows `personal-owner` and `team-admin`. Rejects `team-member` with 403.
 * Must be used after `loadBoardAccess`.
 */
export const requireBoardAdmin = createMiddleware<{ Variables: AppVariables }>(
	async (c, next) => {
		const access = c.get("access");
		if (access.kind === "team-member") {
			throw new AppError("FORBIDDEN", "Admins or owners only.");
		}
		await next();
	},
);
