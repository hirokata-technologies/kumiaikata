import { ObjectId } from "mongodb";
import { boards, columns, cards } from "../db/schemas/index.js";
import { AppError } from "../http/error.js";

export interface CardSummary {
	id: string;
	title: string;
	position: string;
	dueDate: Date | null;
	labelIds: string[];
	assigneeIds: string[];
	attachmentIds: string[];
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
): Promise<BoardWithColumnsAndCards> {
	const board = await boards().findOne({ _id: new ObjectId(boardId) });
	if (!board) {
		throw new AppError("NOT_FOUND", "Board not found.");
	}

	const cols = await columns()
		.find({ boardId: board._id })
		.sort({ position: 1 })
		.toArray();

	const columnIds = cols.map((c) => c._id);
	const cardDocs =
		columnIds.length > 0
			? await cards()
					.find({ columnId: { $in: columnIds } })
					.sort({ position: 1 })
					.toArray()
			: [];

	const cardsByColumnId = new Map<string, CardSummary[]>();
	for (const col of cols) {
		cardsByColumnId.set(String(col._id), []);
	}

	for (const card of cardDocs) {
		const colId = String(card.columnId);
		const list = cardsByColumnId.get(colId);
		if (list) {
			list.push({
				id: String(card._id),
				title: card.title,
				position: card.position,
				dueDate: card.dueDate ?? null,
				labelIds: (card.labelIds ?? []).map(String),
				assigneeIds: (card.assigneeIds ?? []).map(String),
				attachmentIds: (card.attachmentIds ?? []).map(String),
				commentsCount: (card.comments ?? []).length,
				checklistsCount: (card.checklists ?? []).length,
			});
		}
	}

	return {
		id: String(board._id),
		kind: board.kind,
		title: board.title,
		...(board.teamId ? { teamId: String(board.teamId) } : {}),
		...(board.ownerId ? { ownerId: String(board.ownerId) } : {}),
		createdAt: board.createdAt,
		columns: cols.map((col) => ({
			id: String(col._id),
			title: col.title,
			position: col.position,
			cards: cardsByColumnId.get(String(col._id)) ?? [],
		})),
	};
}
