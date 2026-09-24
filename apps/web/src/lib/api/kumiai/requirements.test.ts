import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('$env/dynamic/public', () => ({ env: { PUBLIC_API_URL: 'https://api.test' } }));

const { listRequirements, getRequirement, createRequirement, updateRequirement, deleteRequirement } =
	await import('./requirements.js');

function mockFetch(body: unknown, status = 200) {
	const fetchMock = vi.fn(
		async (_url: string, _init: RequestInit) =>
			new Response(status === 204 ? null : JSON.stringify(body), { status }),
	);
	vi.stubGlobal('fetch', fetchMock);
	return fetchMock;
}

describe('requirements api client', () => {
	beforeEach(() => {
		vi.unstubAllGlobals();
	});

	it('listRequirements issues a GET to /api/kumiai/requirements', async () => {
		const fetchMock = mockFetch([]);
		await listRequirements();
		expect(fetchMock.mock.calls[0][0]).toBe('https://api.test/api/kumiai/requirements');
	});

	it('getRequirement issues a GET to /api/kumiai/requirements/:id', async () => {
		const fetchMock = mockFetch({ id: 'r1' });
		await getRequirement('r1');
		expect(fetchMock.mock.calls[0][0]).toBe('https://api.test/api/kumiai/requirements/r1');
	});

	it('createRequirement POSTs a serialized body', async () => {
		const input = { title: 'Req', status: 'todo' as const, priority: 3 as const };
		const fetchMock = mockFetch({ id: 'r1', ...input });
		await createRequirement(input);
		const [url, init] = fetchMock.mock.calls[0];
		expect(url).toBe('https://api.test/api/kumiai/requirements');
		expect(init.method).toBe('POST');
		expect(init.body).toBe(JSON.stringify(input));
	});

	it('updateRequirement PATCHes /api/kumiai/requirements/:id with a partial body', async () => {
		const fetchMock = mockFetch({ id: 'r1', title: 'Renamed' });
		await updateRequirement('r1', { title: 'Renamed' });
		const [url, init] = fetchMock.mock.calls[0];
		expect(url).toBe('https://api.test/api/kumiai/requirements/r1');
		expect(init.method).toBe('PATCH');
		expect(init.body).toBe(JSON.stringify({ title: 'Renamed' }));
	});

	it('deleteRequirement issues a DELETE and resolves to null on 204', async () => {
		const fetchMock = mockFetch(undefined, 204);
		const result = await deleteRequirement('r1');
		expect(result).toBeNull();
		const [url, init] = fetchMock.mock.calls[0];
		expect(url).toBe('https://api.test/api/kumiai/requirements/r1');
		expect(init.method).toBe('DELETE');
	});
});
