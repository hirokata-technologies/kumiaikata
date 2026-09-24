import { beforeEach, describe, expect, it, vi } from 'vitest';

// apiFetch (in ../client.js) imports `$env/dynamic/public`, a SvelteKit virtual module
// the vitest config does not provide (no sveltekit() plugin in vitest.config.ts — it is
// a separate config from vite.config.ts). Mocking it here, per test file, is the
// non-invasive workaround: it does not touch vitest.config.ts or client.ts, both out of
// this ticket's file set.
vi.mock('$env/dynamic/public', () => ({ env: { PUBLIC_API_URL: 'https://api.test' } }));

const { listGoals, getGoal, createGoal, updateGoal, deleteGoal } = await import('./goals.js');
const { ApiError } = await import('../client.js');

function mockFetch(body: unknown, status = 200) {
	const fetchMock = vi.fn(
		async (_url: string, _init: RequestInit) =>
			new Response(status === 204 ? null : JSON.stringify(body), { status }),
	);
	vi.stubGlobal('fetch', fetchMock);
	return fetchMock;
}

describe('goals api client', () => {
	beforeEach(() => {
		vi.unstubAllGlobals();
	});

	it('listGoals issues a GET to /api/kumiai/goals', async () => {
		const goal = {
			id: 'g1',
			teamId: 't1',
			title: 'Goal',
			body: '',
			status: 'todo',
			priority: 3,
			createdAt: '',
			updatedAt: '',
		};
		const fetchMock = mockFetch([goal]);
		const result = await listGoals();
		expect(result).toEqual([goal]);
		expect(fetchMock).toHaveBeenCalledTimes(1);
		const [url, init] = fetchMock.mock.calls[0];
		expect(url).toBe('https://api.test/api/kumiai/goals');
		expect(init.method).toBeUndefined();
	});

	it('getGoal issues a GET to /api/kumiai/goals/:id', async () => {
		const fetchMock = mockFetch({ id: 'g1' });
		await getGoal('g1');
		expect(fetchMock.mock.calls[0][0]).toBe('https://api.test/api/kumiai/goals/g1');
	});

	it('createGoal POSTs a serialized body', async () => {
		const input = { title: 'New goal', status: 'todo' as const, priority: 2 as const };
		const fetchMock = mockFetch({ id: 'g2', ...input });
		await createGoal(input);
		const [url, init] = fetchMock.mock.calls[0];
		expect(url).toBe('https://api.test/api/kumiai/goals');
		expect(init.method).toBe('POST');
		expect(init.body).toBe(JSON.stringify(input));
	});

	it('updateGoal PATCHes /api/kumiai/goals/:id with a partial body', async () => {
		const fetchMock = mockFetch({ id: 'g1', title: 'Renamed' });
		await updateGoal('g1', { title: 'Renamed' });
		const [url, init] = fetchMock.mock.calls[0];
		expect(url).toBe('https://api.test/api/kumiai/goals/g1');
		expect(init.method).toBe('PATCH');
		expect(init.body).toBe(JSON.stringify({ title: 'Renamed' }));
	});

	it('deleteGoal issues a DELETE and resolves to null on 204', async () => {
		const fetchMock = mockFetch(undefined, 204);
		const result = await deleteGoal('g1');
		expect(result).toBeNull();
		const [url, init] = fetchMock.mock.calls[0];
		expect(url).toBe('https://api.test/api/kumiai/goals/g1');
		expect(init.method).toBe('DELETE');
	});

	it('rejects with an ApiError carrying status and code on a non-OK response', async () => {
		mockFetch({ error: { code: 'NOT_FOUND', message: 'Goal not found' } }, 404);
		await expect(listGoals()).rejects.toMatchObject({
			status: 404,
			code: 'NOT_FOUND',
			message: 'Goal not found',
		});
	});

	it('the rejection is an instance of ApiError', async () => {
		mockFetch({ error: { code: 'NOT_FOUND', message: 'Goal not found' } }, 404);
		await expect(listGoals()).rejects.toBeInstanceOf(ApiError);
	});
});
