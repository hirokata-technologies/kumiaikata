import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('$env/dynamic/public', () => ({ env: { PUBLIC_API_URL: 'https://api.test' } }));

const { listTasks, getTask, createTask, updateTask, deleteTask } = await import('./tasks.js');

function mockFetch(body: unknown, status = 200) {
	const fetchMock = vi.fn(
		async (_url: string, _init: RequestInit) =>
			new Response(status === 204 ? null : JSON.stringify(body), { status }),
	);
	vi.stubGlobal('fetch', fetchMock);
	return fetchMock;
}

describe('tasks api client', () => {
	beforeEach(() => {
		vi.unstubAllGlobals();
	});

	it('listTasks issues a GET to /api/kumiai/tasks', async () => {
		const fetchMock = mockFetch([]);
		await listTasks();
		expect(fetchMock.mock.calls[0][0]).toBe('https://api.test/api/kumiai/tasks');
	});

	it('getTask issues a GET to /api/kumiai/tasks/:id', async () => {
		const fetchMock = mockFetch({ id: 't1' });
		await getTask('t1');
		expect(fetchMock.mock.calls[0][0]).toBe('https://api.test/api/kumiai/tasks/t1');
	});

	it('createTask POSTs a serialized body', async () => {
		const input = {
			requirementId: 'r1',
			title: 'Task',
			status: 'todo' as const,
			priority: 3 as const,
		};
		const fetchMock = mockFetch({ id: 't1', ...input });
		await createTask(input);
		const [url, init] = fetchMock.mock.calls[0];
		expect(url).toBe('https://api.test/api/kumiai/tasks');
		expect(init.method).toBe('POST');
		expect(init.body).toBe(JSON.stringify(input));
	});

	it('updateTask PATCHes /api/kumiai/tasks/:id with a partial body', async () => {
		const fetchMock = mockFetch({ id: 't1', status: 'blocked' });
		await updateTask('t1', { status: 'blocked' });
		const [url, init] = fetchMock.mock.calls[0];
		expect(url).toBe('https://api.test/api/kumiai/tasks/t1');
		expect(init.method).toBe('PATCH');
		expect(init.body).toBe(JSON.stringify({ status: 'blocked' }));
	});

	it('deleteTask issues a DELETE and resolves to null on 204', async () => {
		const fetchMock = mockFetch(undefined, 204);
		const result = await deleteTask('t1');
		expect(result).toBeNull();
		const [url, init] = fetchMock.mock.calls[0];
		expect(url).toBe('https://api.test/api/kumiai/tasks/t1');
		expect(init.method).toBe('DELETE');
	});
});
