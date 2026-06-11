#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { get, post, patch, del, ApiError } from "./client.js";

const server = new McpServer({
	name: "kata-board",
	version: "0.0.1",
});

// ── Helpers ───────────────────────────────────────────────────────────────────

function ok(data: unknown) {
	return {
		content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
	};
}

function fail(err: unknown) {
	const msg = err instanceof ApiError
		? `API error ${err.status.toString()}: ${JSON.stringify(err.body)}`
		: err instanceof Error ? err.message : String(err);
	return { content: [{ type: "text" as const, text: `Error: ${msg}` }], isError: true };
}

async function run<T>(fn: () => Promise<T>) {
	try {
		return ok(await fn());
	} catch (err) {
		return fail(err);
	}
}

// ── Board tools ───────────────────────────────────────────────────────────────

server.tool(
	"get_board",
	"Get the full board (columns + card summaries). Use boardType 'personal' for the user's personal board or 'team' for their team board.",
	{ boardType: z.enum(["personal", "team"]).describe("Which board to fetch") },
	async ({ boardType }) => run(() => get(`/api/boards/${boardType}`)),
);

// ── Column tools ──────────────────────────────────────────────────────────────

server.tool(
	"create_column",
	"Create a new column on a board.",
	{
		boardId: z.string().describe("Board ID"),
		title: z.string().min(1).max(120).describe("Column title"),
	},
	async ({ boardId, title }) => run(() => post(`/api/boards/${boardId}/columns`, { title })),
);

server.tool(
	"rename_column",
	"Rename an existing column.",
	{
		boardId: z.string().describe("Board ID"),
		columnId: z.string().describe("Column ID"),
		title: z.string().min(1).max(120).describe("New title"),
	},
	async ({ boardId, columnId, title }) =>
		run(() => patch(`/api/boards/${boardId}/columns/${columnId}`, { title })),
);

server.tool(
	"delete_column",
	"Delete a column and all its cards.",
	{
		boardId: z.string().describe("Board ID"),
		columnId: z.string().describe("Column ID"),
	},
	async ({ boardId, columnId }) =>
		run(() => del(`/api/boards/${boardId}/columns/${columnId}`)),
);

server.tool(
	"reorder_columns",
	"Reorder all columns by providing an ordered array of column IDs.",
	{
		boardId: z.string().describe("Board ID"),
		orderedIds: z.array(z.string()).min(1).describe("Column IDs in the desired order"),
	},
	async ({ boardId, orderedIds }) =>
		run(() => patch(`/api/boards/${boardId}/columns/reorder`, { orderedIds })),
);

// ── Card tools ────────────────────────────────────────────────────────────────

server.tool(
	"create_card",
	"Create a new card in a column.",
	{
		boardId: z.string().describe("Board ID"),
		columnId: z.string().describe("Column ID to place the card in"),
		title: z.string().min(1).max(500).describe("Card title"),
	},
	async ({ boardId, columnId, title }) =>
		run(() => post(`/api/boards/${boardId}/columns/${columnId}/cards`, { title })),
);

server.tool(
	"get_card",
	"Get the full details of a card including description, checklists, comments, and assignees.",
	{
		boardId: z.string().describe("Board ID"),
		cardId: z.string().describe("Card ID"),
	},
	async ({ boardId, cardId }) =>
		run(() => get(`/api/boards/${boardId}/cards/${cardId}`)),
);

server.tool(
	"update_card",
	"Update a card's title, description, due date, or assigned project.",
	{
		boardId: z.string().describe("Board ID"),
		cardId: z.string().describe("Card ID"),
		title: z.string().min(1).max(500).optional().describe("New title"),
		description: z.string().max(50000).nullable().optional().describe("Markdown description (null to clear)"),
		dueDate: z.string().datetime().nullable().optional().describe("ISO 8601 due date (null to clear)"),
		projectId: z.string().nullable().optional().describe("Project ID to assign (null to clear)"),
	},
	async ({ boardId, cardId, ...fields }) =>
		run(() => patch(`/api/boards/${boardId}/cards/${cardId}`, fields)),
);

server.tool(
	"move_card",
	"Move a card to a different column at a specific zero-based position.",
	{
		boardId: z.string().describe("Board ID"),
		cardId: z.string().describe("Card ID"),
		targetColumnId: z.string().describe("Destination column ID"),
		position: z.number().int().min(0).describe("Zero-based position in the target column"),
	},
	async ({ boardId, cardId, targetColumnId, position }) =>
		run(() => patch(`/api/boards/${boardId}/cards/${cardId}/move`, { targetColumnId, position })),
);

server.tool(
	"reorder_cards",
	"Reorder cards within a column by providing an ordered array of card IDs.",
	{
		boardId: z.string().describe("Board ID"),
		columnId: z.string().describe("Column ID"),
		orderedIds: z.array(z.string()).min(1).describe("Card IDs in the desired order"),
	},
	async ({ boardId, columnId, orderedIds }) =>
		run(() => patch(`/api/boards/${boardId}/columns/${columnId}/cards/reorder`, { orderedIds })),
);

server.tool(
	"delete_card",
	"Permanently delete a card.",
	{
		boardId: z.string().describe("Board ID"),
		cardId: z.string().describe("Card ID"),
	},
	async ({ boardId, cardId }) =>
		run(() => del(`/api/boards/${boardId}/cards/${cardId}`)),
);

// ── Label tools ───────────────────────────────────────────────────────────────

server.tool(
	"list_labels",
	"List all labels defined on a board.",
	{ boardId: z.string().describe("Board ID") },
	async ({ boardId }) => run(() => get(`/api/boards/${boardId}/labels`)),
);

server.tool(
	"create_label",
	"Create a new label on a board.",
	{
		boardId: z.string().describe("Board ID"),
		name: z.string().min(1).max(50).describe("Label name"),
		color: z.string().regex(/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/).describe("Hex color e.g. #e11d48"),
	},
	async ({ boardId, name, color }) =>
		run(() => post(`/api/boards/${boardId}/labels`, { name, color })),
);

server.tool(
	"update_label",
	"Update a label's name or color.",
	{
		boardId: z.string().describe("Board ID"),
		labelId: z.string().describe("Label ID"),
		name: z.string().min(1).max(50).optional().describe("New name"),
		color: z.string().regex(/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/).optional().describe("New hex color"),
	},
	async ({ boardId, labelId, ...fields }) =>
		run(() => patch(`/api/boards/${boardId}/labels/${labelId}`, fields)),
);

server.tool(
	"delete_label",
	"Delete a label from a board.",
	{
		boardId: z.string().describe("Board ID"),
		labelId: z.string().describe("Label ID"),
	},
	async ({ boardId, labelId }) =>
		run(() => del(`/api/boards/${boardId}/labels/${labelId}`)),
);

server.tool(
	"add_card_label",
	"Attach a label to a card (idempotent).",
	{
		boardId: z.string().describe("Board ID"),
		cardId: z.string().describe("Card ID"),
		labelId: z.string().describe("Label ID"),
	},
	async ({ boardId, cardId, labelId }) =>
		run(() => post(`/api/boards/${boardId}/cards/${cardId}/labels`, { labelId })),
);

server.tool(
	"remove_card_label",
	"Remove a label from a card.",
	{
		boardId: z.string().describe("Board ID"),
		cardId: z.string().describe("Card ID"),
		labelId: z.string().describe("Label ID"),
	},
	async ({ boardId, cardId, labelId }) =>
		run(() => del(`/api/boards/${boardId}/cards/${cardId}/labels/${labelId}`)),
);

// ── Project tools ─────────────────────────────────────────────────────────────

server.tool(
	"list_projects",
	"List all projects defined on a board.",
	{ boardId: z.string().describe("Board ID") },
	async ({ boardId }) => run(() => get(`/api/boards/${boardId}/projects`)),
);

server.tool(
	"create_project",
	"Create a new project on a board.",
	{
		boardId: z.string().describe("Board ID"),
		name: z.string().min(1).max(50).describe("Project name"),
		color: z.string().regex(/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/).describe("Hex color e.g. #3b82f6"),
	},
	async ({ boardId, name, color }) =>
		run(() => post(`/api/boards/${boardId}/projects`, { name, color })),
);

server.tool(
	"update_project",
	"Update a project's name or color.",
	{
		boardId: z.string().describe("Board ID"),
		projectId: z.string().describe("Project ID"),
		name: z.string().min(1).max(50).optional().describe("New name"),
		color: z.string().regex(/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/).optional().describe("New hex color"),
	},
	async ({ boardId, projectId, ...fields }) =>
		run(() => patch(`/api/boards/${boardId}/projects/${projectId}`, fields)),
);

server.tool(
	"delete_project",
	"Delete a project from a board. Cards assigned to it have their project reference cleared.",
	{
		boardId: z.string().describe("Board ID"),
		projectId: z.string().describe("Project ID"),
	},
	async ({ boardId, projectId }) =>
		run(() => del(`/api/boards/${boardId}/projects/${projectId}`)),
);

// ── Assignee tools ────────────────────────────────────────────────────────────

server.tool(
	"add_card_assignee",
	"Assign a user to a card (idempotent). The user must be a member of the board's team.",
	{
		boardId: z.string().describe("Board ID"),
		cardId: z.string().describe("Card ID"),
		userId: z.string().describe("User ID to assign"),
	},
	async ({ boardId, cardId, userId }) =>
		run(() => post(`/api/boards/${boardId}/cards/${cardId}/assignees`, { userId })),
);

server.tool(
	"remove_card_assignee",
	"Remove an assignee from a card.",
	{
		boardId: z.string().describe("Board ID"),
		cardId: z.string().describe("Card ID"),
		userId: z.string().describe("User ID to remove"),
	},
	async ({ boardId, cardId, userId }) =>
		run(() => del(`/api/boards/${boardId}/cards/${cardId}/assignees/${userId}`)),
);

// ── Comment tools ─────────────────────────────────────────────────────────────

server.tool(
	"add_card_comment",
	"Add a comment to a card.",
	{
		boardId: z.string().describe("Board ID"),
		cardId: z.string().describe("Card ID"),
		body: z.string().min(1).max(10000).describe("Comment text (markdown supported)"),
	},
	async ({ boardId, cardId, body }) =>
		run(() => post(`/api/boards/${boardId}/cards/${cardId}/comments`, { body })),
);

server.tool(
	"update_card_comment",
	"Edit a comment. Only the comment author may edit.",
	{
		boardId: z.string().describe("Board ID"),
		cardId: z.string().describe("Card ID"),
		commentId: z.string().describe("Comment ID"),
		body: z.string().min(1).max(10000).describe("New comment text"),
	},
	async ({ boardId, cardId, commentId, body }) =>
		run(() => patch(`/api/boards/${boardId}/cards/${cardId}/comments/${commentId}`, { body })),
);

server.tool(
	"delete_card_comment",
	"Delete a comment. Any board member may delete.",
	{
		boardId: z.string().describe("Board ID"),
		cardId: z.string().describe("Card ID"),
		commentId: z.string().describe("Comment ID"),
	},
	async ({ boardId, cardId, commentId }) =>
		run(() => del(`/api/boards/${boardId}/cards/${cardId}/comments/${commentId}`)),
);

// ── Checklist tools ───────────────────────────────────────────────────────────

server.tool(
	"add_checklist",
	"Add a named checklist to a card.",
	{
		boardId: z.string().describe("Board ID"),
		cardId: z.string().describe("Card ID"),
		title: z.string().min(1).max(200).describe("Checklist title"),
	},
	async ({ boardId, cardId, title }) =>
		run(() => post(`/api/boards/${boardId}/cards/${cardId}/checklists`, { title })),
);

server.tool(
	"delete_checklist",
	"Delete a checklist and all its items from a card.",
	{
		boardId: z.string().describe("Board ID"),
		cardId: z.string().describe("Card ID"),
		checklistId: z.string().describe("Checklist ID"),
	},
	async ({ boardId, cardId, checklistId }) =>
		run(() => del(`/api/boards/${boardId}/cards/${cardId}/checklists/${checklistId}`)),
);

server.tool(
	"add_checklist_item",
	"Add an item to a checklist.",
	{
		boardId: z.string().describe("Board ID"),
		cardId: z.string().describe("Card ID"),
		checklistId: z.string().describe("Checklist ID"),
		text: z.string().min(1).max(1000).describe("Item text"),
	},
	async ({ boardId, cardId, checklistId, text }) =>
		run(() => post(`/api/boards/${boardId}/cards/${cardId}/checklists/${checklistId}/items`, { text })),
);

server.tool(
	"update_checklist_item",
	"Update a checklist item's text or checked state.",
	{
		boardId: z.string().describe("Board ID"),
		cardId: z.string().describe("Card ID"),
		checklistId: z.string().describe("Checklist ID"),
		itemId: z.string().describe("Item ID"),
		text: z.string().min(1).max(1000).optional().describe("New text"),
		checked: z.boolean().optional().describe("Checked state"),
	},
	async ({ boardId, cardId, checklistId, itemId, ...fields }) =>
		run(() =>
			patch(
				`/api/boards/${boardId}/cards/${cardId}/checklists/${checklistId}/items/${itemId}`,
				fields,
			),
		),
);

server.tool(
	"delete_checklist_item",
	"Remove an item from a checklist.",
	{
		boardId: z.string().describe("Board ID"),
		cardId: z.string().describe("Card ID"),
		checklistId: z.string().describe("Checklist ID"),
		itemId: z.string().describe("Item ID"),
	},
	async ({ boardId, cardId, checklistId, itemId }) =>
		run(() =>
			del(`/api/boards/${boardId}/cards/${cardId}/checklists/${checklistId}/items/${itemId}`),
		),
);

// ── Start ─────────────────────────────────────────────────────────────────────

const transport = new StdioServerTransport();
await server.connect(transport);
