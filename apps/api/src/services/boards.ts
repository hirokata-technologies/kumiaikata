import { eq, inArray, asc } from "drizzle-orm";
import { db } from "@kata/db";
import { boards, columns, cards } from "@kata/db";
import { AppError } from "@kata/http";

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
	options?: { columnIds?: string[] },
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
