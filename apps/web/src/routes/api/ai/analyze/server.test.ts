// Unit tests for the POST /api/ai/analyze handler (agentic mode).
//
// Strategy:
//   - $env/dynamic/private is stubbed so tests control MINIMAX_API_KEY / API_URL.
//   - @anthropic-ai/sdk is mocked so no real HTTP calls are made.
//   - fetch is stubbed globally to intercept tool execution API calls.
//
// Each test constructs a minimal Request and calls the exported POST handler directly.

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Hoisted mutable state
// ---------------------------------------------------------------------------

const { envStore, mockState } = vi.hoisted(() => {
	const envStore: { MINIMAX_API_KEY: string | undefined; API_URL: string } = {
		MINIMAX_API_KEY: 'test-key-123',
		API_URL: 'http://localhost:8787'
	};

	type CreateResult =
		| { content: { type: 'text'; text: string }[]; stop_reason: string }
		| {
				content: (
					| { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> }
					| { type: 'text'; text: string }
				)[];
				stop_reason: string;
		  };

	const mockState: {
		createResults: CreateResult[];
		createError: Error | null;
	} = {
		createResults: [
			{ content: [{ type: 'text', text: 'Default response.' }], stop_reason: 'end_turn' }
		],
		createError: null
	};

	return { envStore, mockState };
});

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------

vi.mock('$env/dynamic/private', () => ({
	get env() {
		return envStore;
	}
}));

vi.mock('@anthropic-ai/sdk', () => {
	let callCount = 0;
	const createMock = vi.fn(async function () {
		if (mockState.createError) throw mockState.createError;
		const result =
			mockState.createResults[callCount] ??
			mockState.createResults[mockState.createResults.length - 1]!;
		callCount++;
		return result;
	});

	function AnthropicMock() {
		callCount = 0;
		return { messages: { create: createMock } };
	}
	AnthropicMock.prototype = {};
	return { default: AnthropicMock };
});

// ---------------------------------------------------------------------------
// Import the handler AFTER the mocks are registered
// ---------------------------------------------------------------------------

import { POST } from './+server.js';
import type { BoardContext } from '$lib/ai/board-context.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeRequest(body: unknown, cookie = ''): Request {
	return new Request('http://localhost/api/ai/analyze', {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json',
			...(cookie && { Cookie: cookie })
		},
		body: JSON.stringify(body)
	});
}

function makeBoard(cardCount: number): BoardContext {
	return {
		columns: [
			{
				name: 'Todo',
				cards: Array.from({ length: cardCount }, (_, i) => ({
					title: `Card ${i + 1}`,
					labels: []
				}))
			}
		]
	};
}

async function collectSSELines(response: Response): Promise<string[]> {
	const text = await response.text();
	return text
		.split('\n')
		.filter((line) => line.startsWith('data: '))
		.map((line) => line.slice('data: '.length));
}

const VALID_BODY = {
	board: makeBoard(1),
	boardId: 'board_abc',
	boardType: 'personal',
	message: 'Analyze'
};

// ---------------------------------------------------------------------------
// Reset per-test state
// ---------------------------------------------------------------------------

beforeEach(() => {
	envStore.MINIMAX_API_KEY = 'test-key-123';
	envStore.API_URL = 'http://localhost:8787';
	mockState.createResults = [
		{ content: [{ type: 'text', text: 'Default response.' }], stop_reason: 'end_turn' }
	];
	mockState.createError = null;

	vi.stubGlobal(
		'fetch',
		vi.fn(async () => ({
			ok: true,
			status: 200,
			json: async () => ({})
		}))
	);
});

// ---------------------------------------------------------------------------
// Guard: missing API key
// ---------------------------------------------------------------------------

describe('POST /api/ai/analyze — missing API key', () => {
	it('returns 500 when MINIMAX_API_KEY is absent', async () => {
		envStore.MINIMAX_API_KEY = undefined;
		const res = await POST({ request: makeRequest(VALID_BODY) } as Parameters<typeof POST>[0]);
		expect(res.status).toBe(500);
		expect(await res.json()).toMatchObject({ error: 'AI is not configured.' });
	});

	it('returns 500 when MINIMAX_API_KEY is empty string', async () => {
		envStore.MINIMAX_API_KEY = '';
		const res = await POST({ request: makeRequest(VALID_BODY) } as Parameters<typeof POST>[0]);
		expect(res.status).toBe(500);
		expect(await res.json()).toMatchObject({ error: 'AI is not configured.' });
	});
});

// ---------------------------------------------------------------------------
// Guard: invalid payload
// ---------------------------------------------------------------------------

describe('POST /api/ai/analyze — invalid payload', () => {
	it('returns 400 for non-JSON body', async () => {
		const req = new Request('http://localhost/api/ai/analyze', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: 'not-json{'
		});
		expect((await POST({ request: req } as Parameters<typeof POST>[0])).status).toBe(400);
	});

	it('returns 400 when board is missing', async () => {
		const res = await POST({
			request: makeRequest({ boardId: 'board_abc' })
		} as Parameters<typeof POST>[0]);
		expect(res.status).toBe(400);
		expect(await res.json()).toMatchObject({ error: 'Invalid board payload.' });
	});

	it('returns 400 when board.columns is not an array', async () => {
		const res = await POST({
			request: makeRequest({ board: { columns: 'bad' }, boardId: 'board_abc' })
		} as Parameters<typeof POST>[0]);
		expect(res.status).toBe(400);
	});

	it('returns 400 when boardId is missing', async () => {
		const res = await POST({
			request: makeRequest({ board: makeBoard(1) })
		} as Parameters<typeof POST>[0]);
		expect(res.status).toBe(400);
		expect(await res.json()).toMatchObject({ error: 'boardId is required.' });
	});
});

// ---------------------------------------------------------------------------
// Guard: board too large
// ---------------------------------------------------------------------------

describe('POST /api/ai/analyze — board too large', () => {
	it('returns 400 when board has 501 cards', async () => {
		const res = await POST({
			request: makeRequest({ board: makeBoard(501), boardId: 'board_abc' })
		} as Parameters<typeof POST>[0]);
		expect(res.status).toBe(400);
		expect(await res.json()).toMatchObject({ error: 'Board is too large to analyze.' });
	});

	it('does not reject exactly 500 cards', async () => {
		const res = await POST({
			request: makeRequest({ board: makeBoard(500), boardId: 'board_abc' })
		} as Parameters<typeof POST>[0]);
		const body = await res.clone().json().catch(() => null);
		if (body && typeof body === 'object' && 'error' in body) {
			expect((body as { error: string }).error).not.toBe('Board is too large to analyze.');
		}
		expect(res.status).not.toBe(400);
	});
});

// ---------------------------------------------------------------------------
// Happy path: text-only response
// ---------------------------------------------------------------------------

describe('POST /api/ai/analyze — text-only response', () => {
	it('returns 200 with text/event-stream', async () => {
		const res = await POST({ request: makeRequest(VALID_BODY) } as Parameters<typeof POST>[0]);
		expect(res.status).toBe(200);
		expect(res.headers.get('Content-Type')).toContain('text/event-stream');
	});

	it('includes Cache-Control: no-cache', async () => {
		const res = await POST({ request: makeRequest(VALID_BODY) } as Parameters<typeof POST>[0]);
		expect(res.headers.get('Cache-Control')).toBe('no-cache');
	});

	it('streams the text and ends with [DONE]', async () => {
		mockState.createResults = [
			{ content: [{ type: 'text', text: 'Hello world' }], stop_reason: 'end_turn' }
		];
		const res = await POST({ request: makeRequest(VALID_BODY) } as Parameters<typeof POST>[0]);
		const lines = await collectSSELines(res);
		expect(lines).toContain(JSON.stringify({ text: 'Hello world' }));
		expect(lines[lines.length - 1]).toBe('[DONE]');
	});
});

// ---------------------------------------------------------------------------
// Agentic loop: tool use
// ---------------------------------------------------------------------------

describe('POST /api/ai/analyze — tool use', () => {
	it('emits tool_call and tool_done for a successful tool', async () => {
		mockState.createResults = [
			{
				content: [{ type: 'tool_use', id: 'tu_1', name: 'get_board', input: {} }],
				stop_reason: 'tool_use'
			},
			{
				content: [{ type: 'text', text: 'Board retrieved.' }],
				stop_reason: 'end_turn'
			}
		];

		const res = await POST({ request: makeRequest(VALID_BODY) } as Parameters<typeof POST>[0]);
		const lines = await collectSSELines(res);

		expect(lines).toContain(JSON.stringify({ tool_call: 'get_board' }));
		expect(lines).toContain(JSON.stringify({ tool_done: 'get_board' }));
		expect(lines).toContain(JSON.stringify({ text: 'Board retrieved.' }));
		expect(lines[lines.length - 1]).toBe('[DONE]');
	});

	it('emits tool_error when the API call fails', async () => {
		mockState.createResults = [
			{
				content: [
					{ type: 'tool_use', id: 'tu_2', name: 'delete_card', input: { cardId: 'bad_id' } }
				],
				stop_reason: 'tool_use'
			},
			{
				content: [{ type: 'text', text: 'Could not delete.' }],
				stop_reason: 'end_turn'
			}
		];

		vi.stubGlobal(
			'fetch',
			vi.fn(async () => ({
				ok: false,
				status: 404,
				json: async () => ({ error: { message: 'Card not found.' } })
			}))
		);

		const res = await POST({ request: makeRequest(VALID_BODY) } as Parameters<typeof POST>[0]);
		const lines = await collectSSELines(res);
		expect(lines).toContain(JSON.stringify({ tool_call: 'delete_card' }));
		expect(lines).toContain(JSON.stringify({ tool_error: 'delete_card' }));
	});
});

// ---------------------------------------------------------------------------
// Error path: SDK failure
// ---------------------------------------------------------------------------

describe('POST /api/ai/analyze — SDK failure', () => {
	it('emits an error frame when the SDK call throws', async () => {
		mockState.createError = new Error('Network timeout');
		const res = await POST({ request: makeRequest(VALID_BODY) } as Parameters<typeof POST>[0]);
		expect(res.status).toBe(200);
		const lines = await collectSSELines(res);
		const errorLine = lines.find((l) => {
			try {
				return 'error' in (JSON.parse(l) as object);
			} catch {
				return false;
			}
		});
		expect(errorLine).toBeDefined();
		expect(JSON.parse(errorLine!)).toMatchObject({ error: 'Agent failed. Please try again.' });
	});

	it('does not leak internal error details', async () => {
		mockState.createError = new Error('Secret internal details');
		const res = await POST({ request: makeRequest(VALID_BODY) } as Parameters<typeof POST>[0]);
		const body = await res.text();
		expect(body).not.toContain('Secret internal details');
	});
});
