import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('$env/dynamic/public', () => ({ env: { PUBLIC_API_URL: 'https://api.test' } }));

const { listProjects, getProject, createProject, updateProject, deleteProject } =
	await import('./projects.js');

function mockFetch(body: unknown, status = 200) {
	const fetchMock = vi.fn(
		async (_url: string, _init: RequestInit) =>
			new Response(status === 204 ? null : JSON.stringify(body), { status }),
	);
	vi.stubGlobal('fetch', fetchMock);
	return fetchMock;
}

describe('projects api client', () => {
	beforeEach(() => {
		vi.unstubAllGlobals();
	});

	it('listProjects with no params issues a bare GET', async () => {
		const fetchMock = mockFetch([]);
		await listProjects();
		expect(fetchMock.mock.calls[0][0]).toBe('https://api.test/api/kumiai/projects');
	});

	it('listProjects encodes goalId and status as a query string', async () => {
		const fetchMock = mockFetch([]);
		await listProjects({ goalId: 'g 1', status: 'in-progress' });
		expect(fetchMock.mock.calls[0][0]).toBe(
			'https://api.test/api/kumiai/projects?goalId=g+1&status=in-progress',
		);
	});

	it('listProjects omits an undefined param from the query string', async () => {
		const fetchMock = mockFetch([]);
		await listProjects({ goalId: 'g1', status: undefined });
		expect(fetchMock.mock.calls[0][0]).toBe('https://api.test/api/kumiai/projects?goalId=g1');
	});

	it('getProject issues a GET to /api/kumiai/projects/:id', async () => {
		const fetchMock = mockFetch({ id: 'p1' });
		await getProject('p1');
		expect(fetchMock.mock.calls[0][0]).toBe('https://api.test/api/kumiai/projects/p1');
	});

	it('createProject POSTs a serialized body to /api/kumiai/projects', async () => {
		const input = {
			goalId: 'g1',
			title: 'New Project',
			status: 'todo' as const,
			priority: 'medium' as const,
			impact: 50,
			effort: 3,
		};
		const fetchMock = mockFetch({ id: 'p1', ...input });
		await createProject(input);
		const [url, init] = fetchMock.mock.calls[0];
		expect(url).toBe('https://api.test/api/kumiai/projects');
		expect(init.method).toBe('POST');
		expect(init.body).toBe(JSON.stringify(input));
	});

	it('updateProject PATCHes /api/kumiai/projects/:id', async () => {
		const fetchMock = mockFetch({ id: 'p1', blockedReason: 'waiting on design' });
		await updateProject('p1', { status: 'blocked', blockedReason: 'waiting on design' });
		const [url, init] = fetchMock.mock.calls[0];
		expect(url).toBe('https://api.test/api/kumiai/projects/p1');
		expect(init.method).toBe('PATCH');
		expect(init.body).toBe(
			JSON.stringify({ status: 'blocked', blockedReason: 'waiting on design' }),
		);
	});

	it('deleteProject issues a DELETE and resolves to null on 204', async () => {
		const fetchMock = mockFetch(undefined, 204);
		const result = await deleteProject('p1');
		expect(result).toBeNull();
		const [url, init] = fetchMock.mock.calls[0];
		expect(url).toBe('https://api.test/api/kumiai/projects/p1');
		expect(init.method).toBe('DELETE');
	});
});
