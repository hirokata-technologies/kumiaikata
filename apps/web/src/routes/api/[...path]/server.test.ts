// The catch-all hands every /api/* request to the Hono app and returns its Response
// untouched. @kata/api is mocked: these tests cover the SvelteKit wiring only (the API
// itself is covered by apps/api's own suite).

import { beforeEach, describe, expect, it, vi } from 'vitest';

const fetchMock = vi.hoisted(() => vi.fn());
vi.mock('@kata/api', () => ({ app: { fetch: fetchMock } }));

const { fallback } = await import('./+server.js');

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const call = (request: Request) => fallback({ request } as any);

beforeEach(() => {
	fetchMock.mockReset();
});

describe('api/[...path]/+server.ts', () => {
	it('forwards the incoming Request to the Hono app and returns its Response as-is', async () => {
		const response = new Response('{"ok":true}', { status: 201 });
		fetchMock.mockResolvedValue(response);
		const request = new Request('https://kumiai.hirokata.dev/api/boards/personal', {
			method: 'POST',
			body: '{}',
		});

		const result = await call(request);

		expect(fetchMock).toHaveBeenCalledExactlyOnceWith(request);
		expect(result).toBe(response);
	});

	it('passes streaming bodies (SSE) through without buffering them', async () => {
		const stream = new ReadableStream<Uint8Array>();
		const response = new Response(stream, { headers: { 'content-type': 'text/event-stream' } });
		fetchMock.mockResolvedValue(response);

		const result = await call(new Request('https://kumiai.hirokata.dev/api/boards/b1/events'));

		expect(result.body).toBe(stream);
		expect(result.headers.get('content-type')).toBe('text/event-stream');
	});
});
