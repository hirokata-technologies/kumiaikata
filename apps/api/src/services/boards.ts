import { eq, inArray, asc, and } from "drizzle-orm";
import { db } from "@kata/db";
import { boards, columns, cards, teamMembers, users } from "@kata/db";
import { AppError } from "@kata/http";

// ── findBoardIdByType ─────────────────────────────────────────────────────────

/**
 * The id of the user's personal board, or of their team's board. Throws
 * NOT_FOUND when it is missing (provisioning creates both).
 */
export async function findBoardIdByType(userId: string, type: "personal" | "team"): Promise<string> {
	if (type === "personal") {
		// Use the denormalised pointer first — single-row lookup.
		const [u] = await db.select({ personalBoardId: users.personalBoardId })
			.from(users).where(eq(users.id, userId)).limit(1);

		let boardId = u?.personalBoardId ?? null;
		if (!boardId) {
			// Fall back to scanning boards by ownerId in case the denormalised pointer
			// is missing (defence-in-depth against provisioning regressions).
			const [b] = await db.select({ id: boards.id }).from(boards)
				.where(and(eq(boards.kind, "personal"), eq(boards.ownerId, userId)))
				.limit(1);
			boardId = b?.id ?? null;
		}
		if (!boardId) {
			throw new AppError("NOT_FOUND", "Personal board missing — provisioning may have failed.");
		}
		return boardId;
	}

	const [membership] = await db.select({ teamId: teamMembers.teamId })
		.from(teamMembers).where(eq(teamMembers.userId, userId))
		.orderBy(asc(teamMembers.joinedAt)).limit(1);
	if (!membership) throw new AppError("NOT_FOUND", "No team membership found.");
	const [board] = await db.select({ id: boards.id }).from(boards)
		.where(and(eq(boards.kind, "team"), eq(boards.teamId, membership.teamId)))
		.limit(1);
	if (!board) throw new AppError("NOT_FOUND", "Team board missing.");
	return board.id;
}

export interface CardSummary {
	id: string;
	title: string;
	position: string;
	dueDate: Date | null;
	labelIds: string[];
	assigneeIds: string[];
	attachmentIds: string[];
	projectId: string | null;
	commentsCount: number;
	checklistsCount: number;
}

export interface ColumnWithCards {
	id: string;
	title: string;
	position: string;
	cards: CardSummary[];
}

export interface BoardWithColumnsAndCards {
	id: string;
	kind: string;
	title: string;
	teamId?: string;
	ownerId?: string;
	createdAt: Date;
	columns: ColumnWithCards[];
}

export async function getBoardWithColumnsAndCards(
	boardId: string,
	options?: { columnIds?: string[] | undefined },
): Promise<BoardWithColumnsAndCards> {
	const [board] = await db.select().from(boards).where(eq(boards.id, boardId)).limit(1);
	if (!board) throw new AppError("NOT_FOUND", "Board not found.");

	const cols = await db.select().from(columns)
		.where(eq(columns.boardId, board.id))
		.orderBy(asc(columns.position));

	const fetchableIds = options?.columnIds
		? cols.map((c) => c.id).filter((id) => options.columnIds!.includes(id))
		: cols.map((c) => c.id);

	const cardDocs = fetchableIds.length > 0
		? await db.select().from(cards)
				.where(inArray(cards.columnId, fetchableIds))
				.orderBy(asc(cards.position))
		: [];

	const cardsByColumnId = new Map<string, CardSummary[]>();
	for (const col of cols) cardsByColumnId.set(col.id, []);

	for (const card of cardDocs) {
		cardsByColumnId.get(card.columnId)?.push({
			id: card.id,
			title: card.title,
			position: card.position,
			dueDate: card.dueDate ?? null,
			labelIds: card.labelIds ?? [],
			assigneeIds: card.assigneeIds ?? [],
			attachmentIds: card.attachmentIds ?? [],
			projectId: card.projectId ?? null,
			commentsCount: (card.comments ?? []).length,
			checklistsCount: (card.checklists ?? []).length,
		});
	}

	return {
		id: board.id,
		kind: board.kind,
		title: board.title,
		...(board.teamId !== null && { teamId: board.teamId }),
		...(board.ownerId !== null && { ownerId: board.ownerId }),
		createdAt: board.createdAt,
		columns: cols.map((col) => ({
			id: col.id,
			title: col.title,
			position: col.position,
			cards: cardsByColumnId.get(col.id) ?? [],
		})),
	};
}
