import { beforeEach, describe, expect, it, vi } from 'vitest';


const { listPlans, getPlan, createPlan, updatePlan, deletePlan } = await import('./plans.js');

function mockFetch(body: unknown, status = 200) {
	const fetchMock = vi.fn(
		async (_url: string, _init: RequestInit) =>
			new Response(status === 204 ? null : JSON.stringify(body), { status }),
	);
	vi.stubGlobal('fetch', fetchMock);
	return fetchMock;
}

describe('plans api client', () => {
	beforeEach(() => {
		vi.unstubAllGlobals();
	});

	it('listPlans issues a GET to /api/kumiai/plans', async () => {
		const fetchMock = mockFetch([]);
		await listPlans();
		expect(fetchMock.mock.calls[0][0]).toBe('/api/kumiai/plans');
	});

	it('getPlan issues a GET to /api/kumiai/plans/:id', async () => {
		const fetchMock = mockFetch({ id: 'pl1' });
		await getPlan('pl1');
		expect(fetchMock.mock.calls[0][0]).toBe('/api/kumiai/plans/pl1');
	});

	it('createPlan POSTs a serialized body', async () => {
		const input = {
			requirementId: 'r1',
			title: 'Plan',
			status: 'todo' as const,
			approval: 'pending' as const,
		};
		const fetchMock = mockFetch({ id: 'pl1', ...input });
		await createPlan(input);
		const [url, init] = fetchMock.mock.calls[0];
		expect(url).toBe('/api/kumiai/plans');
		expect(init.method).toBe('POST');
		expect(init.body).toBe(JSON.stringify(input));
	});

	it('updatePlan PATCHes /api/kumiai/plans/:id with a partial body', async () => {
		const fetchMock = mockFetch({ id: 'pl1', approval: 'approved' });
		await updatePlan('pl1', { approval: 'approved' });
		const [url, init] = fetchMock.mock.calls[0];
		expect(url).toBe('/api/kumiai/plans/pl1');
		expect(init.method).toBe('PATCH');
		expect(init.body).toBe(JSON.stringify({ approval: 'approved' }));
	});

	it('deletePlan issues a DELETE and resolves to null on 204', async () => {
		const fetchMock = mockFetch(undefined, 204);
		const result = await deletePlan('pl1');
		expect(result).toBeNull();
		const [url, init] = fetchMock.mock.calls[0];
		expect(url).toBe('/api/kumiai/plans/pl1');
		expect(init.method).toBe('DELETE');
	});
});
