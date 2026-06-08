import Anthropic from '@anthropic-ai/sdk';
import { env } from '$env/dynamic/private';
import type { RequestHandler } from './$types';
import type { BoardContext } from '$lib/ai/board-context.js';
import { countCards } from '$lib/ai/board-context.js';

const MAX_TURNS = 10;

const SYSTEM_PROMPT = `You are Kata, an AI assistant embedded in a kanban board application.
You can read the board and take actions on it using tools.
When the user asks you to do something, use your tools to accomplish it, then confirm what you did.
When asked to analyze or summarize the board, call get_board first for the latest state, then provide insights.
Be concise and action-oriented. Always confirm what actions you took.`;

type ToolName =
	| 'get_board' | 'list_labels' | 'list_projects'
	| 'create_card' | 'update_card' | 'move_card' | 'delete_card'
	| 'add_card_label' | 'remove_card_label'
	| 'add_card_assignee' | 'remove_card_assignee'
	| 'add_card_comment'
	| 'create_column' | 'rename_column' | 'delete_column';

const TOOLS: Anthropic.Tool[] = [
	{
		name: 'get_board',
		description: 'Get the current board state with all columns and cards. Call this to see the latest board before taking actions.',
		input_schema: { type: 'object' as const, properties: {}, required: [] }
	},
	{
		name: 'list_labels',
		description: 'List all labels defined on the board.',
		input_schema: { type: 'object' as const, properties: {}, required: [] }
	},
	{
		name: 'list_projects',
		description: 'List all projects defined on the board.',
		input_schema: { type: 'object' as const, properties: {}, required: [] }
	},
	{
		name: 'create_card',
		description: 'Create a new card in a column.',
		input_schema: {
			type: 'object' as const,
			properties: {
				columnId: { type: 'string', description: 'Column ID where the card should be placed' },
				title: { type: 'string', description: 'Card title (max 500 chars)' }
			},
			required: ['columnId', 'title']
		}
	},
	{
		name: 'update_card',
		description: 'Update a card\'s title, description, due date, or project assignment.',
		input_schema: {
			type: 'object' as const,
			properties: {
				cardId: { type: 'string', description: 'Card ID' },
				title: { type: 'string', description: 'New title' },
				description: { type: 'string', description: 'Markdown description (null to clear)' },
				dueDate: { type: 'string', description: 'ISO 8601 due date (null to clear)' },
				projectId: { type: 'string', description: 'Project ID (null to clear)' }
			},
			required: ['cardId']
		}
	},
	{
		name: 'move_card',
		description: 'Move a card to a different column at a specific zero-based position.',
		input_schema: {
			type: 'object' as const,
			properties: {
				cardId: { type: 'string', description: 'Card ID' },
				targetColumnId: { type: 'string', description: 'Destination column ID' },
				position: { type: 'integer', description: 'Zero-based position in the target column' }
			},
			required: ['cardId', 'targetColumnId', 'position']
		}
	},
	{
		name: 'delete_card',
		description: 'Permanently delete a card.',
		input_schema: {
			type: 'object' as const,
			properties: {
				cardId: { type: 'string', description: 'Card ID' }
			},
			required: ['cardId']
		}
	},
	{
		name: 'add_card_label',
		description: 'Attach a label to a card.',
		input_schema: {
			type: 'object' as const,
			properties: {
				cardId: { type: 'string', description: 'Card ID' },
				labelId: { type: 'string', description: 'Label ID' }
			},
			required: ['cardId', 'labelId']
		}
	},
	{
		name: 'remove_card_label',
		description: 'Remove a label from a card.',
		input_schema: {
			type: 'object' as const,
			properties: {
				cardId: { type: 'string', description: 'Card ID' },
				labelId: { type: 'string', description: 'Label ID' }
			},
			required: ['cardId', 'labelId']
		}
	},
	{
		name: 'add_card_assignee',
		description: 'Assign a user to a card.',
		input_schema: {
			type: 'object' as const,
			properties: {
				cardId: { type: 'string', description: 'Card ID' },
				userId: { type: 'string', description: 'User ID to assign' }
			},
			required: ['cardId', 'userId']
		}
	},
	{
		name: 'remove_card_assignee',
		description: 'Remove an assignee from a card.',
		input_schema: {
			type: 'object' as const,
			properties: {
				cardId: { type: 'string', description: 'Card ID' },
				userId: { type: 'string', description: 'User ID to remove' }
			},
			required: ['cardId', 'userId']
		}
	},
	{
		name: 'add_card_comment',
		description: 'Add a comment to a card (markdown supported).',
		input_schema: {
			type: 'object' as const,
			properties: {
				cardId: { type: 'string', description: 'Card ID' },
				body: { type: 'string', description: 'Comment text (max 10000 chars)' }
			},
			required: ['cardId', 'body']
		}
	},
	{
		name: 'create_column',
		description: 'Create a new column on the board. Requires board admin access.',
		input_schema: {
			type: 'object' as const,
			properties: {
				title: { type: 'string', description: 'Column title (max 120 chars)' }
			},
			required: ['title']
		}
	},
	{
		name: 'rename_column',
		description: 'Rename a column. Requires board admin access.',
		input_schema: {
			type: 'object' as const,
			properties: {
				columnId: { type: 'string', description: 'Column ID' },
				title: { type: 'string', description: 'New title (max 120 chars)' }
			},
			required: ['columnId', 'title']
		}
	},
	{
		name: 'delete_column',
		description: 'Delete a column and all its cards. Requires board admin access.',
		input_schema: {
			type: 'object' as const,
			properties: {
				columnId: { type: 'string', description: 'Column ID' }
			},
			required: ['columnId']
		}
	}
];

async function apiCall(
	method: string,
	path: string,
	body: unknown,
	apiUrl: string,
	cookie: string
): Promise<unknown> {
	const res = await fetch(`${apiUrl}${path}`, {
		method,
		headers: { 'Content-Type': 'application/json', Cookie: cookie },
		...(body !== undefined && body !== null && { body: JSON.stringify(body) })
	});
	if (res.status === 204) return null;
	const json: unknown = await res.json();
	if (!res.ok) throw new Error(JSON.stringify(json));
	return json;
}

async function executeTool(
	name: ToolName,
	input: Record<string, unknown>,
	apiUrl: string,
	cookie: string,
	boardId: string,
	boardType: 'personal' | 'team'
): Promise<unknown> {
	const get = (p: string) => apiCall('GET', p, undefined, apiUrl, cookie);
	const post = (p: string, b: unknown) => apiCall('POST', p, b, apiUrl, cookie);
	const patch = (p: string, b: unknown) => apiCall('PATCH', p, b, apiUrl, cookie);
	const del = (p: string) => apiCall('DELETE', p, undefined, apiUrl, cookie);

	switch (name) {
		case 'get_board':
			return get(`/api/boards/${boardType}`);
		case 'list_labels':
			return get(`/api/boards/${boardId}/labels`);
		case 'list_projects':
			return get(`/api/boards/${boardId}/projects`);
		case 'create_card':
			return post(`/api/boards/${boardId}/columns/${String(input['columnId'])}/cards`, {
				title: input['title']
			});
		case 'update_card': {
			const fields: Record<string, unknown> = {};
			if (input['title'] !== undefined) fields['title'] = input['title'];
			if (input['description'] !== undefined) fields['description'] = input['description'];
			if (input['dueDate'] !== undefined) fields['dueDate'] = input['dueDate'];
			if (input['projectId'] !== undefined) fields['projectId'] = input['projectId'];
			return patch(`/api/boards/${boardId}/cards/${String(input['cardId'])}`, fields);
		}
		case 'move_card':
			return patch(`/api/boards/${boardId}/cards/${String(input['cardId'])}/move`, {
				targetColumnId: input['targetColumnId'],
				position: input['position']
			});
		case 'delete_card':
			return del(`/api/boards/${boardId}/cards/${String(input['cardId'])}`);
		case 'add_card_label':
			return post(`/api/boards/${boardId}/cards/${String(input['cardId'])}/labels`, {
				labelId: input['labelId']
			});
		case 'remove_card_label':
			return del(
				`/api/boards/${boardId}/cards/${String(input['cardId'])}/labels/${String(input['labelId'])}`
			);
		case 'add_card_assignee':
			return post(`/api/boards/${boardId}/cards/${String(input['cardId'])}/assignees`, {
				userId: input['userId']
			});
		case 'remove_card_assignee':
			return del(
				`/api/boards/${boardId}/cards/${String(input['cardId'])}/assignees/${String(input['userId'])}`
			);
		case 'add_card_comment':
			return post(`/api/boards/${boardId}/cards/${String(input['cardId'])}/comments`, {
				body: input['body']
			});
		case 'create_column':
			return post(`/api/boards/${boardId}/columns`, { title: input['title'] });
		case 'rename_column':
			return patch(`/api/boards/${boardId}/columns/${String(input['columnId'])}`, {
				title: input['title']
			});
		case 'delete_column':
			return del(`/api/boards/${boardId}/columns/${String(input['columnId'])}`);
		default:
			throw new Error(`Unknown tool: ${String(name)}`);
	}
}

export const POST: RequestHandler = async ({ request }) => {
	if (!env.MINIMAX_API_KEY) {
		return new Response(JSON.stringify({ error: 'AI is not configured.' }), {
			status: 500,
			headers: { 'Content-Type': 'application/json' }
		});
	}

	let board: BoardContext;
	let message: string;
	let boardId: string;
	let boardType: 'personal' | 'team';

	try {
		const body = (await request.json()) as {
			board: BoardContext;
			message?: string;
			boardId: string;
			boardType?: 'personal' | 'team';
		};
		board = body.board;
		message = body.message?.trim() || 'Analyze all Tasks';
		boardId = body.boardId;
		boardType = body.boardType ?? 'personal';

		if (!board || typeof board !== 'object' || !Array.isArray(board.columns)) {
			return new Response(JSON.stringify({ error: 'Invalid board payload.' }), {
				status: 400,
				headers: { 'Content-Type': 'application/json' }
			});
		}
		if (!boardId || typeof boardId !== 'string') {
			return new Response(JSON.stringify({ error: 'boardId is required.' }), {
				status: 400,
				headers: { 'Content-Type': 'application/json' }
			});
		}
	} catch {
		return new Response(JSON.stringify({ error: 'Invalid request body.' }), {
			status: 400,
			headers: { 'Content-Type': 'application/json' }
		});
	}

	if (countCards(board) > 500) {
		return new Response(JSON.stringify({ error: 'Board is too large to analyze.' }), {
			status: 400,
			headers: { 'Content-Type': 'application/json' }
		});
	}

	const cookie = request.headers.get('cookie') ?? '';
	const apiUrl = (env.API_URL ?? '').replace(/\/$/, '');

	const client = new Anthropic({
		apiKey: env.MINIMAX_API_KEY,
		baseURL: 'https://api.minimax.io/anthropic'
	});

	const encoder = new TextEncoder();

	return new Response(
		new ReadableStream({
			async start(controller) {
				const emit = (data: string) => {
					controller.enqueue(encoder.encode(`data: ${data}\n\n`));
				};

				try {
					const messages: Anthropic.MessageParam[] = [
						{
							role: 'user',
							content: `${message}\n\nCurrent board snapshot:\n${JSON.stringify(board, null, 2)}`
						}
					];

					for (let turn = 0; turn < MAX_TURNS; turn++) {
						const response = await client.messages.create({
							model: 'minimax-m3',
							max_tokens: 4096,
							system: SYSTEM_PROMPT,
							tools: TOOLS,
							messages
						});

						for (const block of response.content) {
							if (block.type === 'text' && block.text) {
								emit(JSON.stringify({ text: block.text }));
							}
						}

						const toolCalls = response.content.filter(
							(b): b is Anthropic.ToolUseBlock => b.type === 'tool_use'
						);

						if (response.stop_reason !== 'tool_use' || toolCalls.length === 0) {
							break;
						}

						messages.push({ role: 'assistant', content: response.content });

						const toolResults: Anthropic.ToolResultBlockParam[] = [];
						for (const toolCall of toolCalls) {
							const toolName = toolCall.name as ToolName;
							emit(JSON.stringify({ tool_call: toolName }));
							try {
								const result = await executeTool(
									toolName,
									toolCall.input as Record<string, unknown>,
									apiUrl,
									cookie,
									boardId,
									boardType
								);
								toolResults.push({
									type: 'tool_result',
									tool_use_id: toolCall.id,
									content: JSON.stringify(result)
								});
								emit(JSON.stringify({ tool_done: toolName }));
							} catch (err) {
								const errMsg = err instanceof Error ? err.message : 'Tool call failed';
								toolResults.push({
									type: 'tool_result',
									tool_use_id: toolCall.id,
									is_error: true,
									content: errMsg
								});
								emit(JSON.stringify({ tool_error: toolName }));
							}
						}

						messages.push({ role: 'user', content: toolResults });
					}

					emit('[DONE]');
				} catch {
					emit(JSON.stringify({ error: 'Agent failed. Please try again.' }));
					emit('[DONE]');
				} finally {
					controller.close();
				}
			}
		}),
		{
			headers: {
				'Content-Type': 'text/event-stream',
				'Cache-Control': 'no-cache',
				Connection: 'keep-alive'
			}
		}
	);
};
