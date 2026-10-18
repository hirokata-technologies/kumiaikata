import { z } from "zod";
import { AppError } from "@kata/http";
import type { ContextBoard } from "@kata/http";
import { deriveAccess, fetchBoardWithMembership } from "../../auth/middleware.js";
import { defineTool, type GuildCaller, type GuildToolDef } from "../../guild/registry.js";
import { findBoardIdByType, getBoardWithColumnsAndCards } from "../../services/boards.js";
import { createColumn, deleteColumn, renameColumn, reorderColumns } from "../../services/columns.js";
import {
	createCard,
	deleteCard,
	getCard,
	moveCard,
	reorderCardsInColumn,
	updateCard,
} from "../../services/cards.js";
import { createLabel, deleteLabel, listLabels, updateLabel } from "../../services/labels.js";
import { createProject, deleteProject, listProjects, updateProject } from "../../services/projects.js";
import {
	addCardAssignee,
	addCardComment,
	addCardLabel,
	addChecklist,
	addChecklistItem,
	deleteCardComment,
	deleteChecklist,
	deleteChecklistItem,
	removeCardAssignee,
	removeCardLabel,
	updateCardComment,
	updateChecklistItem,
} from "../../services/card-parts.js";

/**
 * Board tools (docs/guild-contract.md §4.9) — the old stdio `apps/mcp` server's tools,
 * served in-process from POST /mcp. MCP-only: they are not guild registry tools and have
 * no REST/RPC route (the board REST API already exists). They share the registry's tool
 * shape so the guild adapter serves them; each one checks board access exactly like
 * `loadBoardAccess` does for the REST routes, then calls the same service, which emits
 * the same SSE events. Board project tools carry a `_board_project` suffix so they do not
 * clash with the guild's `create_project` / `update_project`.
 */

const hexColor = z
	.string()
	.regex(/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/, {
		message: "Color must be a valid CSS hex color (e.g. #fff or #e11d48).",
	});
const boardId = z.string().min(1).describe("Board ID");
const cardId = z.string().min(1).describe("Card ID");
const columnId = z.string().min(1).describe("Column ID");
const labelId = z.string().min(1).describe("Label ID");
const projectId = z.string().min(1).describe("Project ID");
const checklistId = z.string().min(1).describe("Checklist ID");
const itemId = z.string().min(1).describe("Item ID");
const commentBody = z.string().min(1).max(10000);
const labelName = z.string().min(1).max(50);

/** The board the caller may act on — the same rule as `loadBoardAccess` (REST). */
async function accessBoard(caller: GuildCaller, id: string): Promise<ContextBoard> {
	const board = await fetchBoardWithMembership(id, caller.userId);
	if (!board) throw new AppError("NOT_FOUND", "Board not found.");
	if (!deriveAccess(board, { id: caller.userId })) {
		throw new AppError("FORBIDDEN", "You do not have access to this board.");
	}
	return {
		id: board.id,
		kind: board.kind,
		title: board.title,
		...(board.ownerId !== null && { ownerId: board.ownerId }),
		...(board.teamId !== null && { teamId: board.teamId }),
	};
}

/** A plain JSON object for structuredContent: Dates become ISO strings, arrays are wrapped. */
function json(value: unknown, listKey = "items"): Record<string, unknown> {
	const plain = JSON.parse(JSON.stringify(value ?? null)) as unknown;
	if (Array.isArray(plain)) return { [listKey]: plain };
	if (plain && typeof plain === "object") return plain as Record<string, unknown>;
	return { value: plain };
}

const DONE = { ok: true } as const;

// ── Board ─────────────────────────────────────────────────────────────────────

const getBoard = defineTool({
	name: "get_board",
	title: "Get board",
	description:
		"Get the full board (columns + card summaries). Use boardType 'personal' for the user's personal board or 'team' for their team board.",
	input: z.object({ boardType: z.enum(["personal", "team"]).describe("Which board to fetch") }),
	readOnly: true,
	handler: async ({ caller }, { boardType }) => {
		const id = await findBoardIdByType(caller.userId, boardType);
		await accessBoard(caller, id);
		return json(await getBoardWithColumnsAndCards(id));
	},
});

// ── Columns ───────────────────────────────────────────────────────────────────

const createColumnTool = defineTool({
	name: "create_column",
	title: "Create column",
	description: "Create a new column on a board.",
	input: z.object({ boardId, title: z.string().min(1).max(120).describe("Column title") }),
	handler: async ({ caller }, input) => {
		const board = await accessBoard(caller, input.boardId);
		return json(await createColumn(board.id, input.title));
	},
});

const renameColumnTool = defineTool({
	name: "rename_column",
	title: "Rename column",
	description: "Rename an existing column.",
	input: z.object({ boardId, columnId, title: z.string().min(1).max(120).describe("New title") }),
	handler: async ({ caller }, input) => {
		const board = await accessBoard(caller, input.boardId);
		return json(await renameColumn(board.id, input.columnId, input.title));
	},
});

const deleteColumnTool = defineTool({
	name: "delete_column",
	title: "Delete column",
	description: "Delete a column and all its cards.",
	input: z.object({ boardId, columnId }),
	handler: async ({ caller }, input) => {
		const board = await accessBoard(caller, input.boardId);
		await deleteColumn(board.id, input.columnId);
		return DONE;
	},
});

const reorderColumnsTool = defineTool({
	name: "reorder_columns",
	title: "Reorder columns",
	description: "Reorder all columns by providing an ordered array of column IDs.",
	input: z.object({ boardId, orderedIds: z.array(z.string()).min(1).describe("Column IDs in the desired order") }),
	handler: async ({ caller }, input) => {
		const board = await accessBoard(caller, input.boardId);
		return json(await reorderColumns(board.id, input.orderedIds));
	},
});

// ── Cards ─────────────────────────────────────────────────────────────────────

const createCardTool = defineTool({
	name: "create_card",
	title: "Create card",
	description: "Create a new card in a column.",
	input: z.object({
		boardId,
		columnId: z.string().min(1).describe("Column ID to place the card in"),
		title: z.string().min(1).max(500).describe("Card title"),
	}),
	handler: async ({ caller }, input) => {
		const board = await accessBoard(caller, input.boardId);
		return json(await createCard({ boardId: board.id, columnId: input.columnId, title: input.title }));
	},
});

const getCardTool = defineTool({
	name: "get_card",
	title: "Get card",
	description: "Get the full details of a card including description, checklists, comments, and assignees.",
	input: z.object({ boardId, cardId }),
	readOnly: true,
	handler: async ({ caller }, input) => {
		const board = await accessBoard(caller, input.boardId);
		return json(await getCard(board.id, input.cardId));
	},
});

const updateCardTool = defineTool({
	name: "update_card",
	title: "Update card",
	description: "Update a card's title, description, due date, or assigned project.",
	input: z.object({
		boardId,
		cardId,
		title: z.string().min(1).max(500).optional().describe("New title"),
		description: z.string().max(50000).nullable().optional().describe("Markdown description (null to clear)"),
		dueDate: z.string().datetime().nullable().optional().describe("ISO 8601 due date (null to clear)"),
		projectId: z.string().nullable().optional().describe("Project ID to assign (null to clear)"),
	}),
	handler: async ({ caller }, { boardId: id, cardId: card, ...fields }) => {
		const board = await accessBoard(caller, id);
		return json(await updateCard(board.id, card, fields));
	},
});

const moveCardTool = defineTool({
	name: "move_card",
	title: "Move card",
	description: "Move a card to a different column at a specific zero-based position.",
	input: z.object({
		boardId,
		cardId,
		targetColumnId: z.string().min(1).describe("Destination column ID"),
		position: z.number().int().min(0).describe("Zero-based position in the target column"),
	}),
	handler: async ({ caller }, input) => {
		const board = await accessBoard(caller, input.boardId);
		return json(await moveCard(board.id, input.cardId, input.targetColumnId, input.position));
	},
});

const reorderCardsTool = defineTool({
	name: "reorder_cards",
	title: "Reorder cards",
	description: "Reorder cards within a column by providing an ordered array of card IDs.",
	input: z.object({ boardId, columnId, orderedIds: z.array(z.string()).min(1).describe("Card IDs in the desired order") }),
	handler: async ({ caller }, input) => {
		const board = await accessBoard(caller, input.boardId);
		return json(await reorderCardsInColumn(board.id, input.columnId, input.orderedIds));
	},
});

const deleteCardTool = defineTool({
	name: "delete_card",
	title: "Delete card",
	description: "Permanently delete a card.",
	input: z.object({ boardId, cardId }),
	handler: async ({ caller }, input) => {
		const board = await accessBoard(caller, input.boardId);
		await deleteCard(board.id, input.cardId);
		return DONE;
	},
});

// ── Labels ────────────────────────────────────────────────────────────────────

const listLabelsTool = defineTool({
	name: "list_labels",
	title: "List labels",
	description: "List all labels defined on a board.",
	input: z.object({ boardId }),
	readOnly: true,
	handler: async ({ caller }, input) => {
		const board = await accessBoard(caller, input.boardId);
		return json(await listLabels(board.id), "labels");
	},
});

const createLabelTool = defineTool({
	name: "create_label",
	title: "Create label",
	description: "Create a new label on a board.",
	input: z.object({
		boardId,
		name: labelName.describe("Label name"),
		color: hexColor.describe("Hex color e.g. #e11d48"),
	}),
	handler: async ({ caller }, input) => {
		const board = await accessBoard(caller, input.boardId);
		return json(await createLabel(board.id, { name: input.name, color: input.color }));
	},
});

const updateLabelTool = defineTool({
	name: "update_label",
	title: "Update label",
	description: "Update a label's name or color.",
	input: z.object({
		boardId,
		labelId,
		name: labelName.optional().describe("New name"),
		color: hexColor.optional().describe("New hex color"),
	}),
	handler: async ({ caller }, input) => {
		const board = await accessBoard(caller, input.boardId);
		return json(
			await updateLabel(board.id, input.labelId, {
				...(input.name !== undefined && { name: input.name }),
				...(input.color !== undefined && { color: input.color }),
			}),
		);
	},
});

const deleteLabelTool = defineTool({
	name: "delete_label",
	title: "Delete label",
	description: "Delete a label from a board.",
	input: z.object({ boardId, labelId }),
	handler: async ({ caller }, input) => {
		const board = await accessBoard(caller, input.boardId);
		await deleteLabel(board.id, input.labelId);
		return DONE;
	},
});

const addCardLabelTool = defineTool({
	name: "add_card_label",
	title: "Add card label",
	description: "Attach a label to a card (idempotent).",
	input: z.object({ boardId, cardId, labelId }),
	handler: async ({ caller }, input) => {
		const board = await accessBoard(caller, input.boardId);
		return json(await addCardLabel(board.id, input.cardId, input.labelId));
	},
});

const removeCardLabelTool = defineTool({
	name: "remove_card_label",
	title: "Remove card label",
	description: "Remove a label from a card.",
	input: z.object({ boardId, cardId, labelId }),
	handler: async ({ caller }, input) => {
		const board = await accessBoard(caller, input.boardId);
		await removeCardLabel(board.id, input.cardId, input.labelId);
		return DONE;
	},
});

// ── Board projects ────────────────────────────────────────────────────────────

const listBoardProjects = defineTool({
	name: "list_board_projects",
	title: "List board projects",
	description: "List all projects defined on a board.",
	input: z.object({ boardId }),
	readOnly: true,
	handler: async ({ caller }, input) => {
		const board = await accessBoard(caller, input.boardId);
		return json(await listProjects(board.id), "projects");
	},
});

const createBoardProject = defineTool({
	name: "create_board_project",
	title: "Create board project",
	description: "Create a new project on a board.",
	input: z.object({
		boardId,
		name: labelName.describe("Project name"),
		color: hexColor.describe("Hex color e.g. #3b82f6"),
	}),
	handler: async ({ caller }, input) => {
		const board = await accessBoard(caller, input.boardId);
		return json(await createProject(board.id, { name: input.name, color: input.color }));
	},
});

const updateBoardProject = defineTool({
	name: "update_board_project",
	title: "Update board project",
	description: "Update a board project's name or color.",
	input: z.object({
		boardId,
		projectId,
		name: labelName.optional().describe("New name"),
		color: hexColor.optional().describe("New hex color"),
	}),
	handler: async ({ caller }, input) => {
		const board = await accessBoard(caller, input.boardId);
		return json(
			await updateProject(board.id, input.projectId, {
				...(input.name !== undefined && { name: input.name }),
				...(input.color !== undefined && { color: input.color }),
			}),
		);
	},
});

const deleteBoardProject = defineTool({
	name: "delete_board_project",
	title: "Delete board project",
	description: "Delete a project from a board. Cards assigned to it have their project reference cleared.",
	input: z.object({ boardId, projectId }),
	handler: async ({ caller }, input) => {
		const board = await accessBoard(caller, input.boardId);
		await deleteProject(board.id, input.projectId);
		return DONE;
	},
});

// ── Assignees ─────────────────────────────────────────────────────────────────

const addCardAssigneeTool = defineTool({
	name: "add_card_assignee",
	title: "Add card assignee",
	description: "Assign a user to a card (idempotent). The user must be a member of the board's team.",
	input: z.object({ boardId, cardId, userId: z.string().min(1).describe("User ID to assign") }),
	handler: async ({ caller }, input) => {
		const board = await accessBoard(caller, input.boardId);
		return json(await addCardAssignee(board, input.cardId, input.userId));
	},
});

const removeCardAssigneeTool = defineTool({
	name: "remove_card_assignee",
	title: "Remove card assignee",
	description: "Remove an assignee from a card.",
	input: z.object({ boardId, cardId, userId: z.string().min(1).describe("User ID to remove") }),
	handler: async ({ caller }, input) => {
		const board = await accessBoard(caller, input.boardId);
		await removeCardAssignee(board.id, input.cardId, input.userId);
		return DONE;
	},
});

// ── Comments ──────────────────────────────────────────────────────────────────

const addCardCommentTool = defineTool({
	name: "add_card_comment",
	title: "Add card comment",
	description: "Add a comment to a card.",
	input: z.object({ boardId, cardId, body: commentBody.describe("Comment text (markdown supported)") }),
	handler: async ({ caller }, input) => {
		const board = await accessBoard(caller, input.boardId);
		return json(await addCardComment(board.id, input.cardId, caller.userId, input.body));
	},
});

const updateCardCommentTool = defineTool({
	name: "update_card_comment",
	title: "Update card comment",
	description: "Edit a comment. Only the comment author may edit.",
	input: z.object({
		boardId,
		cardId,
		commentId: z.string().min(1).describe("Comment ID"),
		body: commentBody.describe("New comment text"),
	}),
	handler: async ({ caller }, input) => {
		const board = await accessBoard(caller, input.boardId);
		return json(await updateCardComment(board.id, input.cardId, input.commentId, caller.userId, input.body));
	},
});

const deleteCardCommentTool = defineTool({
	name: "delete_card_comment",
	title: "Delete card comment",
	description: "Delete a comment. Any board member may delete.",
	input: z.object({ boardId, cardId, commentId: z.string().min(1).describe("Comment ID") }),
	handler: async ({ caller }, input) => {
		const board = await accessBoard(caller, input.boardId);
		await deleteCardComment(board.id, input.cardId, input.commentId);
		return DONE;
	},
});

// ── Checklists ────────────────────────────────────────────────────────────────

const addChecklistTool = defineTool({
	name: "add_checklist",
	title: "Add checklist",
	description: "Add a named checklist to a card.",
	input: z.object({ boardId, cardId, title: z.string().min(1).max(200).describe("Checklist title") }),
	handler: async ({ caller }, input) => {
		const board = await accessBoard(caller, input.boardId);
		return json(await addChecklist(board.id, input.cardId, input.title));
	},
});

const deleteChecklistTool = defineTool({
	name: "delete_checklist",
	title: "Delete checklist",
	description: "Delete a checklist and all its items from a card.",
	input: z.object({ boardId, cardId, checklistId }),
	handler: async ({ caller }, input) => {
		const board = await accessBoard(caller, input.boardId);
		await deleteChecklist(board.id, input.cardId, input.checklistId);
		return DONE;
	},
});

const addChecklistItemTool = defineTool({
	name: "add_checklist_item",
	title: "Add checklist item",
	description: "Add an item to a checklist.",
	input: z.object({ boardId, cardId, checklistId, text: z.string().min(1).max(1000).describe("Item text") }),
	handler: async ({ caller }, input) => {
		const board = await accessBoard(caller, input.boardId);
		return json(await addChecklistItem(board.id, input.cardId, input.checklistId, input.text));
	},
});

const updateChecklistItemTool = defineTool({
	name: "update_checklist_item",
	title: "Update checklist item",
	description: "Update a checklist item's text or checked state.",
	input: z.object({
		boardId,
		cardId,
		checklistId,
		itemId,
		text: z.string().min(1).max(1000).optional().describe("New text"),
		checked: z.boolean().optional().describe("Checked state"),
	}),
	handler: async ({ caller }, input) => {
		const board = await accessBoard(caller, input.boardId);
		return json(
			await updateChecklistItem(board.id, input.cardId, input.checklistId, input.itemId, {
				text: input.text,
				checked: input.checked,
			}),
		);
	},
});

const deleteChecklistItemTool = defineTool({
	name: "delete_checklist_item",
	title: "Delete checklist item",
	description: "Remove an item from a checklist.",
	input: z.object({ boardId, cardId, checklistId, itemId }),
	handler: async ({ caller }, input) => {
		const board = await accessBoard(caller, input.boardId);
		await deleteChecklistItem(board.id, input.cardId, input.checklistId, input.itemId);
		return DONE;
	},
});

/** Every board tool of contract §4.9, in the old server's order. */
export const boardTools: GuildToolDef[] = [
	getBoard,
	createColumnTool,
	renameColumnTool,
	deleteColumnTool,
	reorderColumnsTool,
	createCardTool,
	getCardTool,
	updateCardTool,
	moveCardTool,
	reorderCardsTool,
	deleteCardTool,
	listLabelsTool,
	createLabelTool,
	updateLabelTool,
	deleteLabelTool,
	addCardLabelTool,
	removeCardLabelTool,
	listBoardProjects,
	createBoardProject,
	updateBoardProject,
	deleteBoardProject,
	addCardAssigneeTool,
	removeCardAssigneeTool,
	addCardCommentTool,
	updateCardCommentTool,
	deleteCardCommentTool,
	addChecklistTool,
	deleteChecklistTool,
	addChecklistItemTool,
	updateChecklistItemTool,
	deleteChecklistItemTool,
];
