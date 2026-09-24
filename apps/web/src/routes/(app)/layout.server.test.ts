// Integration test for REQ-001 US-3 AC1 / US-2 AC4: the (app) group's
// shared shell load — auth guard, parallel cookie-forwarded fetch of
// stats/recent-projects/team, degrading to empty defaults on failure.
//
// This module imports `$env/dynamic/private`, a SvelteKit virtual module
// the vitest config does not provide (no sveltekit() plugin in
// vitest.config.ts — filed as BUG-004/BUG-007). Mocking it here, per test
// file, is the established non-invasive workaround (mirrors
// `$lib/api/kumiai/goals.test.ts`'s `$env/dynamic/public` mock). `fetch` is
// the load event's 3rd-arg fetch, stubbed per test; `load()` is called
// directly against a minimal fake RequestEvent, not through SvelteKit's
// runtime.

import { describe, expect, it, vi } from 'vitest';
import type { KumiaiStats, RecentProject } from '$lib/api/kumiai/types.js';
import type { TeamInfo } from '$lib/api/types.js';

vi.mock('$env/dynamic/private', () => ({ env: { API_URL: 'https://api.test' } }));

const { load } = await import('./+layout.server.js');

/** The load function's declared `./$types` return type widens to `void` (the redirect
 *  overload), so accessing the resolved shape's properties needs this narrowing cast. */
interface LoadResult {
	user: unknown;
	stats: KumiaiStats;
	recentProjects: RecentProject[];
	team: TeamInfo | null;
}

const STATS_BODY = {
	tasksInProgress: 4,
	projectCounts: { backlog: 1, todo: 2, inProgress: 3, blocked: 0, done: 5 },
};
const RECENT_PROJECTS_BODY = [{ id: 'p1', title: 'Project One', priority: 'medium' }];
const TEAM_BODY = { id: 't1', name: 'hirokata.dev' };

function jsonResponse(body: unknown, ok = true) {
	return {
		ok,
		json: async () => body,
	} as Response;
}

/** Routes each outbound fetch call by URL suffix, so per-endpoint behavior can be overridden. */
function makeFetch(overrides: Record<string, () => Promise<Response>> = {}) {
	return vi.fn(async (url: string, _init?: RequestInit) => {
		if (url.endsWith('/api/kumiai/stats')) {
			return overrides.stats ? overrides.stats() : jsonResponse(STATS_BODY);
		}
		if (url.endsWith('/api/kumiai/recent-projects')) {
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
	cookie?: string;
	fetch: ReturnType<typeof makeFetch>;
}) {
	return {
		locals: { user: overrides.user },
		request: {
			headers: {
				get: (name: string) => (name === 'cookie' ? (overrides.cookie ?? '') : null),
			},
		},
		fetch: overrides.fetch,
		url: { pathname: '/week' },
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
	} as any;
}

describe('(app)/+layout.server.ts — auth guard (US-3 AC1)', () => {
	it('redirects 303 to /login when locals.user is absent', async () => {
		const event = makeEvent({ user: undefined, fetch: makeFetch() });
		await expect(load(event)).rejects.toMatchObject({ status: 303, location: '/login' });
	});
});

describe('(app)/+layout.server.ts — happy path', () => {
	it('returns { user, stats, recentProjects, team } from the JSON bodies when all three fetches succeed', async () => {
		const user = { id: 'u1', email: 'a@hirokata.dev' };
		const event = makeEvent({ user, fetch: makeFetch() });
		const result = (await load(event)) as LoadResult;
		expect(result).toEqual({
			user,
			stats: STATS_BODY,
			recentProjects: RECENT_PROJECTS_BODY,
			team: TEAM_BODY,
		});
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

describe('(app)/+layout.server.ts — cookie forwarding', () => {
	it('forwards the incoming request cookie header verbatim to all three outbound fetches', async () => {
		const fetchMock = makeFetch();
		const event = makeEvent({
			user: { id: 'u1', email: 'a@hirokata.dev' },
			cookie: 'session=abc123',
			fetch: fetchMock,
		});
		await load(event);
		expect(fetchMock).toHaveBeenCalledTimes(3);
		for (const call of fetchMock.mock.calls) {
			const init = call[1] as RequestInit;
			expect((init.headers as Record<string, string>).cookie).toBe('session=abc123');
		}
	});
});
