import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('$env/dynamic/public', () => ({ env: { PUBLIC_API_URL: 'https://api.test' } }));

const { getStats, searchWorkspace, listRecentProjects, touchRecentProject } =
	await import('./shell.js');

function mockFetch(body: unknown, status = 200) {
	const fetchMock = vi.fn(
		async (_url: string, _init: RequestInit) =>
			new Response(status === 204 ? null : JSON.stringify(body), { status }),
	);
	vi.stubGlobal('fetch', fetchMock);
	return fetchMock;
}

describe('shell api client', () => {
	beforeEach(() => {
		vi.unstubAllGlobals();
	});

	it('getStats issues a GET to /api/kumiai/stats', async () => {
		const stats = {
			tasksInProgress: 3,
			projectCounts: { backlog: 1, todo: 2, inProgress: 3, blocked: 0, done: 5 },
		};
		const fetchMock = mockFetch(stats);
		const result = await getStats();
		expect(result).toEqual(stats);
		expect(fetchMock.mock.calls[0][0]).toBe('https://api.test/api/kumiai/stats');
	});

	it('searchWorkspace URL-encodes the search term, including "&", "%" and spaces', async () => {
		const fetchMock = mockFetch({ goals: [], projects: [], requirements: [] });
		await searchWorkspace('50% off & more');
		expect(fetchMock.mock.calls[0][0]).toBe(
			'https://api.test/api/kumiai/search?q=50%25%20off%20%26%20more',
		);
	});

	it('listRecentProjects issues a GET to /api/kumiai/recent-projects', async () => {
		const fetchMock = mockFetch([]);
		await listRecentProjects();
		expect(fetchMock.mock.calls[0][0]).toBe('https://api.test/api/kumiai/recent-projects');
	});

	it('touchRecentProject POSTs { projectId } and resolves to null on 204', async () => {
		const fetchMock = mockFetch(undefined, 204);
		const result = await touchRecentProject('p1');
		expect(result).toBeNull();
		const [url, init] = fetchMock.mock.calls[0];
		expect(url).toBe('https://api.test/api/kumiai/recent-projects');
		expect(init.method).toBe('POST');
		expect(init.body).toBe(JSON.stringify({ projectId: 'p1' }));
	});
});
