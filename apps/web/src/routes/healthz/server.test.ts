import { beforeEach, describe, expect, it, vi } from 'vitest';

const fetchMock = vi.hoisted(() => vi.fn());
vi.mock('@kata/api', () => ({ app: { fetch: fetchMock } }));

const { GET } = await import('./+server.js');

beforeEach(() => {
	fetchMock.mockReset();
});

describe('healthz/+server.ts', () => {
	it('returns the Hono /healthz response (200 when the database is reachable)', async () => {
		fetchMock.mockResolvedValue(Response.json({ ok: true, db: true }));
		const request = new Request('https://kumiai.hirokata.dev/healthz');

		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const res = await GET({ request } as any);

		expect(fetchMock).toHaveBeenCalledExactlyOnceWith(request);
		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({ ok: true, db: true });
	});

	it('propagates a 503 when the database is unreachable', async () => {
		fetchMock.mockResolvedValue(Response.json({ ok: false, db: false }, { status: 503 }));

		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const res = await GET({ request: new Request('https://kumiai.hirokata.dev/healthz') } as any);

		expect(res.status).toBe(503);
	});
});
