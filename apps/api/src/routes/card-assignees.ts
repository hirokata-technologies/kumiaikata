import { Hono } from "hono";
import { z } from "zod";
import { eq, and, sql } from "drizzle-orm";
import { db } from "@kata/db";
import { requireSession, loadBoardAccess } from "../auth/middleware.js";
import { zValidator, validateId } from "../http/validate.js";
import { ok, noContent } from "../http/responders.js";
import type { AppVariables } from "@kata/http";
import { cards, teamMembers } from "@kata/db";
import { AppError } from "@kata/http";
import { eventBus } from "../events/bus.js";

const r = new Hono<{ Variables: AppVariables }>();

r.use("*", requireSession, loadBoardAccess);

// POST /api/boards/:boardId/cards/:cardId/assignees
r.post(
	"/",
	zValidator("json", z.object({ userId: z.string() })),
	async (c) => {
		const board = c.get("board");
		const cardId = validateId(c.req.param("cardId"), "cardId");
		const { userId } = c.req.valid("json");

		// Validate assignee belongs to the board's team or is the personal board owner.
		if (board.kind === "team") {
			const [isMember] = await db
				.select({ id: teamMembers.id })
				.from(teamMembers)
				.where(
					and(
						eq(teamMembers.teamId, board.teamId!),
						eq(teamMembers.userId, userId),
					),
				)
				.limit(1);
			if (!isMember) {
				throw new AppError(
					"VALIDATION_ERROR",
					"User is not a member of this board's team.",
				);
			}
		} else {
			// Personal board: only the owner may be assigned.
			if (board.ownerId !== userId) {
				throw new AppError(
					"VALIDATION_ERROR",
					"Only the board owner may be assigned on a personal board.",
				);
			}
		}

		// Idempotent add: append only if the user isn't already in the array.
		const result = await db
			.update(cards)
			.set({
				assigneeIds: sql`CASE WHEN ${userId} = ANY(${cards.assigneeIds}) THEN ${cards.assigneeIds} ELSE array_append(${cards.assigneeIds}, ${userId}) END`,
			})
			.where(and(eq(cards.id, cardId), eq(cards.boardId, board.id)))
			.returning({ id: cards.id });

		if (result.length === 0) {
			throw new AppError("NOT_FOUND", "Card not found.");
		}

		eventBus.emit({
			type: "card.assignee.added",
			boardId: board.id,
			payload: { cardId, userId },
		});

		return ok(c, { cardId, userId });
	},
);

// DELETE /api/boards/:boardId/cards/:cardId/assignees/:userId
r.delete(
	"/:userId",
	zValidator("param", z.object({ userId: z.string() })),
	async (c) => {
		const board = c.get("board");
		const cardId = validateId(c.req.param("cardId"), "cardId");
		const { userId } = c.req.valid("param");

		// Fetch current state first so we know whether the user is actually assigned.
		// Emitting card.assignee.removed for a userId not in the array would send
		// phantom events that desync SSE clients.
		const [current] = await db
			.select({ id: cards.id, assigneeIds: cards.assigneeIds })
			.from(cards)
			.where(and(eq(cards.id, cardId), eq(cards.boardId, board.id)))
			.limit(1);

		if (!current) {
			throw new AppError("NOT_FOUND", "Card not found.");
		}

		if (!current.assigneeIds.includes(userId)) {
			return noContent(c); // idempotent — userId was not assigned, no event
		}

		await db
			.update(cards)
			.set({ assigneeIds: sql`array_remove(${cards.assigneeIds}, ${userId})` })
			.where(eq(cards.id, cardId));

		eventBus.emit({
			type: "card.assignee.removed",
			boardId: board.id,
			payload: { cardId, userId },
		});

		return noContent(c);
	},
);

export default r;
