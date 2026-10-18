// Integration test for REQ-001 US-2 AC2 / US-3 edge case: project detail
// load — renders the project, degrades to a not-found state instead of
// crashing, and best-effort touches recent-projects on success.
//
// `load()` is called directly against a minimal fake RequestEvent.

import { describe, expect, it, vi } from 'vitest';

const { load } = await import('./+page.server.js');

const PROJECT_BODY = { id: 'p1', goalId: 'g1', title: 'Project One', priority: 'medium' };
const GOAL_BODY = { id: 'g1', workspaceId: 'w1', title: 'Goal' };

function jsonResponse(body: unknown, ok = true) {
	return { ok, json: async () => body } as Response;
}

function makeEvent(overrides: {
	id?: string;
	fetch: ReturnType<typeof vi.fn>;
	activeWorkspaceId?: string | null;
	cookieSet?: ReturnType<typeof vi.fn>;
}) {
	return {
		params: { id: overrides.id ?? 'p1' },
		fetch: overrides.fetch,
		parent: async () => ({
			activeWorkspaceId: overrides.activeWorkspaceId === undefined ? 'w1' : overrides.activeWorkspaceId,
		}),
		cookies: { set: overrides.cookieSet ?? vi.fn() },
		url: { pathname: '/projects/p1' },
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
	} as any;
}

describe('projects/[id]/+page.server.ts — success path', () => {
	it('returns { notFound: false, project } when the GET succeeds', async () => {
		const fetchMock = vi.fn(async (url: string) => {
			if (url.endsWith('/api/kumiai/projects/p1')) return jsonResponse(PROJECT_BODY);
			return jsonResponse(null); // recent-projects POST
		});
		const result = await load(makeEvent({ fetch: fetchMock }));
		expect(result).toMatchObject({ notFound: false, project: PROJECT_BODY });
	});

	it('also returns the joined workspace the detail view renders requirements from', async () => {
		const goal = { id: 'g1', title: 'Goal' };
		const fetchMock = vi.fn(async (url: string) => {
			if (url.endsWith('/api/kumiai/projects/p1')) return jsonResponse(PROJECT_BODY);
			if (url.endsWith('/api/kumiai/goals/g1')) return jsonResponse(GOAL_BODY);
			if (url.startsWith('/api/kumiai/goals')) return jsonResponse([goal]);
			if (url.startsWith('/api/kumiai/')) return jsonResponse([]);
			return jsonResponse(null);
		});
		const result = await load(makeEvent({ fetch: fetchMock }));
		expect(result).toMatchObject({ failed: false, workspace: { goals: [goal], tasks: [] } });
	});

	it('flags failed: true instead of throwing when the workspace lists cannot be loaded', async () => {
		const fetchMock = vi.fn(async (url: string) => {
			if (url.endsWith('/api/kumiai/projects/p1')) return jsonResponse(PROJECT_BODY);
			return jsonResponse(null, false);
		});
		const result = await load(makeEvent({ fetch: fetchMock }));
		expect(result).toMatchObject({ notFound: false, failed: true });
	});
});

describe('projects/[id]/+page.server.ts — workspace of the project', () => {
	const fetchFor = (goalWorkspace: string) =>
		vi.fn(async (url: string, _init?: RequestInit) => {
			if (url.endsWith('/api/kumiai/projects/p1')) return jsonResponse(PROJECT_BODY);
			if (url.endsWith('/api/kumiai/goals/g1')) return jsonResponse({ ...GOAL_BODY, workspaceId: goalWorkspace });
			if (url.startsWith('/api/kumiai/')) return jsonResponse([]);
			return jsonResponse(null);
		});

	it('scopes the joined workspace to the active workspace', async () => {
		const fetchMock = fetchFor('w1');
		await load(makeEvent({ fetch: fetchMock }));
		expect(fetchMock).toHaveBeenCalledWith('/api/kumiai/goals?workspaceId=w1');
	});

	it("switches to the project's workspace and reloads when it differs from the active one", async () => {
		const cookieSet = vi.fn();
		await expect(
			load(makeEvent({ fetch: fetchFor('w2'), cookieSet })),
		).rejects.toMatchObject({ status: 303, location: '/projects/p1' });
		expect(cookieSet).toHaveBeenCalledWith(
			'kumiai_workspace',
			'w2',
			expect.objectContaining({ path: '/', httpOnly: false }),
		);
	});

	it('does not touch recent projects before moving workspace', async () => {
		const fetchMock = fetchFor('w2');
		await expect(load(makeEvent({ fetch: fetchMock }))).rejects.toBeDefined();
		expect(fetchMock.mock.calls.some(([, init]) => init?.method === 'POST')).toBe(false);
	});

	it('does not redirect when there is no active workspace to compare with', async () => {
		const result = await load(makeEvent({ fetch: fetchFor('w2'), activeWorkspaceId: null }));
		expect(result).toMatchObject({ notFound: false });
	});
});

describe('projects/[id]/+page.server.ts — not-found path (US-3 edge case)', () => {
	it('returns { notFound: true, project: null } when the GET responds ok: false (404)', async () => {
		const fetchMock = vi.fn(async () => jsonResponse(null, false));
		const result = await load(makeEvent({ fetch: fetchMock }));
		expect(result).toEqual({ notFound: true, project: null });
	});

	it('does not issue the recent-projects POST when the project GET 404s', async () => {
		const fetchMock = vi.fn(async () => jsonResponse(null, false));
		await load(makeEvent({ fetch: fetchMock }));
		expect(fetchMock).toHaveBeenCalledTimes(1);
	});

	it('returns { notFound: true, project: null } when the GET throws (network error), no throw escapes load', async () => {
		const fetchMock = vi.fn(async () => { throw new Error('network error'); });
		const result = await load(makeEvent({ fetch: fetchMock }));
		expect(result).toEqual({ notFound: true, project: null });
	});
});

describe('projects/[id]/+page.server.ts — recent-projects touch (US-2 AC2)', () => {
	it('issues a POST /api/kumiai/recent-projects with { projectId: params.id } on a successful load', async () => {
		const fetchMock = vi.fn(async (url: string, _init?: RequestInit) => {
			if (url.endsWith('/api/kumiai/projects/p1')) return jsonResponse(PROJECT_BODY);
			return jsonResponse(null);
		});
		await load(makeEvent({ id: 'p1', fetch: fetchMock }));
		const posts = fetchMock.mock.calls.filter(([url]) => url === '/api/kumiai/recent-projects');
		expect(posts).toHaveLength(1);
		const [postUrl, postInit] = posts[0] as [string, RequestInit];
		expect(postUrl).toBe('/api/kumiai/recent-projects');
		expect(postInit.method).toBe('POST');
		expect(postInit.body).toBe(JSON.stringify({ projectId: 'p1' }));
	});

	it('does not fail the page load when the recent-projects POST itself rejects (best-effort touch)', async () => {
		const fetchMock = vi.fn(async (url: string) => {
			if (url.endsWith('/api/kumiai/projects/p1')) return jsonResponse(PROJECT_BODY);
			throw new Error('touch failed');
		});
		const result = await load(makeEvent({ id: 'p1', fetch: fetchMock }));
		expect(result).toMatchObject({ notFound: false, project: PROJECT_BODY });
	});
});
