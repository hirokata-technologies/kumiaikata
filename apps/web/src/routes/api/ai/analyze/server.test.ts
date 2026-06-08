// Unit tests for the POST /api/ai/analyze handler.
//
// Strategy:
//   - $env/dynamic/private is a SvelteKit virtual module; we stub it with vi.mock
//     so tests control whether MINIMAX_API_KEY is set.
//   - @anthropic-ai/sdk is mocked so no real HTTP calls are made.
//   - $lib/ai/board-context is the real implementation (imported via the $lib alias
//     configured in vitest.config.ts), except for countCards which is used inside
//     the handler — we let it run against the real board payloads we supply.
//
// Each test constructs a minimal Request and calls the exported POST handler directly.

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Hoisted mutable state shared between vi.mock factories and tests.
// vi.hoisted runs before the vi.mock calls so the vars are in scope.
// ---------------------------------------------------------------------------

const { envStore, mockState } = vi.hoisted(() => {
	const envStore: { MINIMAX_API_KEY: string | undefined } = { MINIMAX_API_KEY: 'test-key-123' };
	const mockState: {
		streamFn: (() => AsyncIterable<unknown>) | null;
		streamError: Error | null;
	} = { streamFn: null, streamError: null };
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
	const createMock = vi.fn(async function () {
		if (mockState.streamError) throw mockState.streamError;
		if (mockState.streamFn) return mockState.streamFn();
		// Default: a single-token stream
		return (async function* () {
			yield { type: 'content_block_delta', delta: { type: 'text_delta', text: 'Default' } };
		})();
	});

	function AnthropicMock() {
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

function makeRequest(body: unknown): Request {
	return new Request('http://localhost/api/ai/analyze', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify(body)
	});
}

/** Build a BoardContext with N cards in a single column. */
function makeBoardContext(cardCount: number): BoardContext {
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

/** Collect all SSE data lines from a streaming Response. */
async function collectSSELines(response: Response): Promise<string[]> {
	const text = await response.text();
	return text
		.split('\n')
		.filter((line) => line.startsWith('data: '))
		.map((line) => line.slice('data: '.length));
}

// ---------------------------------------------------------------------------
// Reset per-test mutable state
// ---------------------------------------------------------------------------

beforeEach(() => {
	envStore.MINIMAX_API_KEY = 'test-key-123';
	mockState.streamFn = null;
	mockState.streamError = null;
});

// ---------------------------------------------------------------------------
// Guard: missing API key (US-2 AC-1)
// ---------------------------------------------------------------------------

describe('POST /api/ai/analyze — missing API key', () => {
	it('returns 500 with "AI is not configured." when MINIMAX_API_KEY is absent', async () => {
		envStore.MINIMAX_API_KEY = undefined;

		const res = await POST({ request: makeRequest({ board: makeBoardContext(1) }) } as Parameters<typeof POST>[0]);

		expect(res.status).toBe(500);
		const body = await res.json();
		expect(body).toMatchObject({ error: 'AI is not configured.' });
	});

	it('returns 500 with "AI is not configured." when MINIMAX_API_KEY is an empty string', async () => {
		envStore.MINIMAX_API_KEY = '';

		const res = await POST({ request: makeRequest({ board: makeBoardContext(1) }) } as Parameters<typeof POST>[0]);

		expect(res.status).toBe(500);
		const body = await res.json();
		expect(body).toMatchObject({ error: 'AI is not configured.' });
	});
});

// ---------------------------------------------------------------------------
// Guard: invalid board payload
// ---------------------------------------------------------------------------

describe('POST /api/ai/analyze — invalid board payload', () => {
	it('returns 400 when the request body is not valid JSON', async () => {
		const req = new Request('http://localhost/api/ai/analyze', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: 'not-json{'
		});
		const res = await POST({ request: req } as Parameters<typeof POST>[0]);

		expect(res.status).toBe(400);
		expect(await res.json()).toMatchObject({ error: 'Invalid request body.' });
	});

	it('returns 400 when the "board" key is missing from the request body', async () => {
		const res = await POST({ request: makeRequest({ other: 'data' }) } as Parameters<typeof POST>[0]);

		expect(res.status).toBe(400);
		expect(await res.json()).toMatchObject({ error: 'Invalid board payload.' });
	});

	it('returns 400 when board is null', async () => {
		const res = await POST({ request: makeRequest({ board: null }) } as Parameters<typeof POST>[0]);

		expect(res.status).toBe(400);
		expect(await res.json()).toMatchObject({ error: 'Invalid board payload.' });
	});

	it('returns 400 when board is a string instead of an object', async () => {
		const res = await POST({ request: makeRequest({ board: 'not-an-object' }) } as Parameters<typeof POST>[0]);

		expect(res.status).toBe(400);
		expect(await res.json()).toMatchObject({ error: 'Invalid board payload.' });
	});

	it('returns 400 when board.columns is not an array', async () => {
		const res = await POST({ request: makeRequest({ board: { columns: 'bad' } }) } as Parameters<typeof POST>[0]);

		expect(res.status).toBe(400);
		expect(await res.json()).toMatchObject({ error: 'Invalid board payload.' });
	});

	it('returns 400 when board.columns is null', async () => {
		const res = await POST({ request: makeRequest({ board: { columns: null } }) } as Parameters<typeof POST>[0]);

		expect(res.status).toBe(400);
		expect(await res.json()).toMatchObject({ error: 'Invalid board payload.' });
	});
});

// ---------------------------------------------------------------------------
// Guard: board > 500 cards
// ---------------------------------------------------------------------------

describe('POST /api/ai/analyze — board exceeds 500-card limit', () => {
	it('returns 400 with "Board is too large to analyze." when the board has 501 cards', async () => {
		const res = await POST({ request: makeRequest({ board: makeBoardContext(501) }) } as Parameters<typeof POST>[0]);

		expect(res.status).toBe(400);
		expect(await res.json()).toMatchObject({ error: 'Board is too large to analyze.' });
	});

	it('does NOT reject a board with exactly 500 cards (boundary — should proceed past the card-limit guard)', async () => {
		// With exactly 500 cards the limit guard must pass; the board-empty guard also passes.
		// The mock SDK returns successfully, so we expect a streaming 200.
		const res = await POST({ request: makeRequest({ board: makeBoardContext(500) }) } as Parameters<typeof POST>[0]);

		// Must not be a card-limit 400
		const body = await res.clone().json().catch(() => null);
		if (body && typeof body === 'object' && 'error' in body) {
			expect((body as { error: string }).error).not.toBe('Board is too large to analyze.');
		}
		expect(res.status).not.toBe(400);
	});
});

// ---------------------------------------------------------------------------
// Guard: empty board (US-3 AC-2)
// ---------------------------------------------------------------------------

describe('POST /api/ai/analyze — empty board (no cards)', () => {
	it('returns 400 with "There is nothing to analyze yet." when the board has 0 cards', async () => {
		const res = await POST({ request: makeRequest({ board: makeBoardContext(0) }) } as Parameters<typeof POST>[0]);

		expect(res.status).toBe(400);
		expect(await res.json()).toMatchObject({ error: 'There is nothing to analyze yet.' });
	});

	it('returns 400 for a board with multiple empty columns', async () => {
		const board: BoardContext = {
			columns: [
				{ name: 'Todo', cards: [] },
				{ name: 'Done', cards: [] }
			]
		};
		const res = await POST({ request: makeRequest({ board }) } as Parameters<typeof POST>[0]);

		expect(res.status).toBe(400);
		expect(await res.json()).toMatchObject({ error: 'There is nothing to analyze yet.' });
	});
});

// ---------------------------------------------------------------------------
// Happy path: valid board produces a streaming SSE response (US-1 AC-1/2)
// ---------------------------------------------------------------------------

describe('POST /api/ai/analyze — valid board produces streaming response', () => {
	it('returns 200 with Content-Type text/event-stream for a valid board', async () => {
		const res = await POST({ request: makeRequest({ board: makeBoardContext(2) }) } as Parameters<typeof POST>[0]);

		expect(res.status).toBe(200);
		expect(res.headers.get('Content-Type')).toContain('text/event-stream');
	});

	it('includes Cache-Control: no-cache header', async () => {
		const res = await POST({ request: makeRequest({ board: makeBoardContext(1) }) } as Parameters<typeof POST>[0]);

		expect(res.headers.get('Cache-Control')).toBe('no-cache');
	});

	it('streams text delta events then a [DONE] sentinel', async () => {
		mockState.streamFn = async function* () {
			yield { type: 'content_block_delta', delta: { type: 'text_delta', text: 'Hello' } };
			yield { type: 'content_block_delta', delta: { type: 'text_delta', text: ' world' } };
		};

		const res = await POST({ request: makeRequest({ board: makeBoardContext(1) }) } as Parameters<typeof POST>[0]);
		const lines = await collectSSELines(res);

		expect(lines).toContain(JSON.stringify({ text: 'Hello' }));
		expect(lines).toContain(JSON.stringify({ text: ' world' }));
		expect(lines).toContain('[DONE]');
	});

	it('does NOT stream events for non-text-delta event types', async () => {
		mockState.streamFn = async function* () {
			yield { type: 'message_start', message: {} };
			yield { type: 'content_block_start', content_block: { type: 'text', text: '' } };
			yield { type: 'content_block_delta', delta: { type: 'text_delta', text: 'Only this' } };
			yield { type: 'message_stop' };
		};

		const res = await POST({ request: makeRequest({ board: makeBoardContext(1) }) } as Parameters<typeof POST>[0]);
		const lines = await collectSSELines(res);

		const textLines = lines.filter((l) => l !== '[DONE]');
		expect(textLines).toHaveLength(1);
		expect(textLines[0]).toBe(JSON.stringify({ text: 'Only this' }));
	});

	it('always terminates the stream with [DONE]', async () => {
		mockState.streamFn = async function* () {
			yield { type: 'content_block_delta', delta: { type: 'text_delta', text: 'Done check' } };
		};

		const res = await POST({ request: makeRequest({ board: makeBoardContext(1) }) } as Parameters<typeof POST>[0]);
		const lines = await collectSSELines(res);

		expect(lines[lines.length - 1]).toBe('[DONE]');
	});
});

// ---------------------------------------------------------------------------
// Error path: Anthropic SDK call fails (US-3 AC-1)
// ---------------------------------------------------------------------------

describe('POST /api/ai/analyze — Anthropic SDK call failure', () => {
	it('returns 500 with "Analysis failed. Please try again." when the SDK call throws', async () => {
		mockState.streamError = new Error('Network timeout');

		const res = await POST({ request: makeRequest({ board: makeBoardContext(1) }) } as Parameters<typeof POST>[0]);

		expect(res.status).toBe(500);
		expect(await res.json()).toMatchObject({ error: 'Analysis failed. Please try again.' });
	});

	it('does not leak the original error message in the response body', async () => {
		mockState.streamError = new Error('Secret internal error details');

		const res = await POST({ request: makeRequest({ board: makeBoardContext(1) }) } as Parameters<typeof POST>[0]);
		const body = await res.json();

		expect(JSON.stringify(body)).not.toContain('Secret internal error details');
	});
});

// ---------------------------------------------------------------------------
// Error path: stream interrupted mid-response (US-3 AC-3)
// ---------------------------------------------------------------------------

describe('POST /api/ai/analyze — stream interrupted mid-response', () => {
	it('streams an error event and [DONE] when iteration throws mid-stream', async () => {
		mockState.streamFn = async function* () {
			yield { type: 'content_block_delta', delta: { type: 'text_delta', text: 'Partial...' } };
			throw new Error('Connection reset');
		};

		const res = await POST({ request: makeRequest({ board: makeBoardContext(1) }) } as Parameters<typeof POST>[0]);
		const lines = await collectSSELines(res);

		expect(lines).toContain('[DONE]');

		const errorLine = lines.find((l) => {
			try {
				const obj = JSON.parse(l);
				return typeof obj === 'object' && obj !== null && 'error' in obj;
			} catch {
				return false;
			}
		});
		expect(errorLine).toBeDefined();
		expect(JSON.parse(errorLine!)).toMatchObject({ error: 'Analysis was interrupted.' });
	});
});
