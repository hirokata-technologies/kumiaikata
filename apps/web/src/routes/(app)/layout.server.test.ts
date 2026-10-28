// Integration test for REQ-001 US-3 AC1 / US-2 AC4: the (app) group's
// shared shell load — auth guard, parallel same-origin fetch of
// stats/recent-projects/team, degrading to empty defaults on failure.
//
// `fetch` is the load event's 3rd-arg fetch, stubbed per test; `load()` is called
// directly against a minimal fake RequestEvent, not through SvelteKit's runtime.

import { describe, expect, it, vi } from 'vitest';
import type { KumiaiStats, RecentProject } from '$lib/api/kumiai/types.js';
import type { TeamInfo } from '$lib/api/types.js';

const { load } = await import('./+layout.server.js');

/** The load function's declared `./$types` return type widens to `void` (the redirect
 *  overload), so accessing the resolved shape's properties needs this narrowing cast. */
interface LoadResult {
	user: unknown;
	stats: KumiaiStats;
	recentProjects: RecentProject[];
	team: TeamInfo | null;
	workspaces: unknown[];
	activeWorkspaceId: string | null;
}

const STATS_BODY = {
	tasksInProgress: 4,
	projectCounts: { backlog: 1, todo: 2, inProgress: 3, blocked: 0, done: 5 },
};
const RECENT_PROJECTS_BODY = [{ id: 'p1', title: 'Project One', priority: 'medium' }];
const TEAM_BODY = { id: 't1', name: 'hirokata.dev' };
const WORKSPACES_BODY = [
	{ id: 'w-default', name: 'default', isDefault: true, goalCount: 0, projectCount: 0 },
	{ id: 'w-other', name: 'Other', isDefault: false, goalCount: 1, projectCount: 2 },
];

function jsonResponse(body: unknown, ok = true) {
	return {
		ok,
		json: async () => body,
	} as Response;
}

/** Routes each outbound fetch call by URL suffix, so per-endpoint behavior can be overridden. */
function makeFetch(overrides: Record<string, () => Promise<Response>> = {}) {
	return vi.fn(async (url: string, _init?: RequestInit) => {
		if (url.endsWith('/api/kumiai/workspaces')) {
			return overrides.workspaces ? overrides.workspaces() : jsonResponse(WORKSPACES_BODY);
		}
		if (url.includes('/api/kumiai/stats')) {
			return overrides.stats ? overrides.stats() : jsonResponse(STATS_BODY);
		}
		if (url.includes('/api/kumiai/recent-projects')) {
			return overrides.recentProjects
				? overrides.recentProjects()
				: jsonResponse(RECENT_PROJECTS_BODY);
		}
		if (url.endsWith('/api/teams/mine')) {
			return overrides.team ? overrides.team() : jsonResponse(TEAM_BODY);
		}
		throw new Error(`unexpected fetch: ${url}`);
	});
}

function makeEvent(overrides: {
	user?: unknown;
	fetch: ReturnType<typeof makeFetch>;
	workspaceCookie?: string;
}) {
	return {
		locals: { user: overrides.user },
		fetch: overrides.fetch,
		cookies: { get: (name: string) => (name === 'kumiai_workspace' ? overrides.workspaceCookie : undefined) },
		url: { pathname: '/roadmap' },
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
	} as any;
}

describe('(app)/+layout.server.ts — auth guard (US-3 AC1)', () => {
	it('redirects 303 to /login when locals.user is absent', async () => {
		const event = makeEvent({ user: undefined, fetch: makeFetch() });
		await expect(load(event)).rejects.toMatchObject({ status: 303, location: '/login' });
	});
});

describe('(app)/+layout.server.ts — onboarding gate', () => {
	it('redirects 303 to /onboarding when the user has not finished onboarding', async () => {
		const event = makeEvent({
			user: { id: 'u1', email: 'a@hirokata.dev', isOnboardingDone: false },
			fetch: makeFetch(),
		});
		await expect(load(event)).rejects.toMatchObject({ status: 303, location: '/onboarding' });
	});

	it('lets an onboarded user through', async () => {
		const event = makeEvent({
			user: { id: 'u1', email: 'a@hirokata.dev', isOnboardingDone: true },
			fetch: makeFetch(),
		});
		await expect(load(event)).resolves.toBeDefined();
	});
});

describe('(app)/+layout.server.ts — happy path', () => {
	it('returns { user, stats, recentProjects, team, workspaces, activeWorkspaceId } from the JSON bodies', async () => {
		const user = { id: 'u1', email: 'a@hirokata.dev' };
		const event = makeEvent({ user, fetch: makeFetch() });
		const result = (await load(event)) as LoadResult;
		expect(result).toEqual({
			user,
			stats: STATS_BODY,
			recentProjects: RECENT_PROJECTS_BODY,
			team: TEAM_BODY,
			workspaces: WORKSPACES_BODY,
			activeWorkspaceId: 'w-default',
		});
	});
});

describe('(app)/+layout.server.ts — active workspace', () => {
	const user = { id: 'u1', email: 'a@hirokata.dev' };

	it('uses the remembered workspace and scopes stats and recent projects to it', async () => {
		const fetch = makeFetch();
		const result = (await load(makeEvent({ user, fetch, workspaceCookie: 'w-other' }))) as LoadResult;
		expect(result.activeWorkspaceId).toBe('w-other');
		const urls = fetch.mock.calls.map(([url]) => url);
		expect(urls).toContain('/api/kumiai/stats?workspaceId=w-other');
		expect(urls).toContain('/api/kumiai/recent-projects?workspaceId=w-other');
	});

	it('falls back to the default workspace when the remembered one no longer exists', async () => {
		const result = (await load(
			makeEvent({ user, fetch: makeFetch(), workspaceCookie: 'deleted' }),
		)) as LoadResult;
		expect(result.activeWorkspaceId).toBe('w-default');
	});

	it('degrades to no workspaces and unscoped sidebar data when the list cannot be fetched', async () => {
		const fetch = makeFetch({ workspaces: async () => jsonResponse(null, false) });
		const result = (await load(makeEvent({ user, fetch }))) as LoadResult;
		expect(result.workspaces).toEqual([]);
		expect(result.activeWorkspaceId).toBeNull();
		const urls = fetch.mock.calls.map(([url]) => url);
		expect(urls).toContain('/api/kumiai/stats');
	});
});

describe('(app)/+layout.server.ts — degrade on failure (US-2 AC4 edge case)', () => {
	it('falls back stats to the zero-filled EMPTY_STATS shape on a network error, without throwing', async () => {
		const event = makeEvent({
			user: { id: 'u1', email: 'a@hirokata.dev' },
			fetch: makeFetch({ stats: async () => { throw new Error('network error'); } }),
		});
		const result = (await load(event)) as LoadResult;
		expect(result.stats).toEqual({
			tasksInProgress: 0,
			projectCounts: { backlog: 0, todo: 0, inProgress: 0, blocked: 0, done: 0 },
		});
	});

	it('falls back stats to EMPTY_STATS on a non-ok response, without throwing', async () => {
		const event = makeEvent({
			user: { id: 'u1', email: 'a@hirokata.dev' },
			fetch: makeFetch({ stats: async () => jsonResponse(null, false) }),
		});
		const result = (await load(event)) as LoadResult;
		expect(result.stats.tasksInProgress).toBe(0);
	});

	it('falls back recentProjects to [] when that fetch fails, without throwing', async () => {
		const event = makeEvent({
			user: { id: 'u1', email: 'a@hirokata.dev' },
			fetch: makeFetch({
				recentProjects: async () => { throw new Error('network error'); },
			}),
		});
		const result = (await load(event)) as LoadResult;
		expect(result.recentProjects).toEqual([]);
	});

	it('falls back team to null when that fetch fails, without throwing', async () => {
		const event = makeEvent({
			user: { id: 'u1', email: 'a@hirokata.dev' },
			fetch: makeFetch({ team: async () => { throw new Error('network error'); } }),
		});
		const result = (await load(event)) as LoadResult;
		expect(result.team).toBeNull();
	});
});

describe('(app)/+layout.server.ts — same-origin API calls', () => {
	it('requests the shell endpoints by relative path, so the load event fetch carries the session', async () => {
		const fetchMock = makeFetch();
		const event = makeEvent({ user: { id: 'u1', email: 'a@hirokata.dev' }, fetch: fetchMock });
		await load(event);
		expect(fetchMock.mock.calls.map((call) => call[0]).sort()).toEqual([
			'/api/kumiai/recent-projects?workspaceId=w-default',
			'/api/kumiai/stats?workspaceId=w-default',
			'/api/kumiai/workspaces',
			'/api/teams/mine',
		]);
	});
});
