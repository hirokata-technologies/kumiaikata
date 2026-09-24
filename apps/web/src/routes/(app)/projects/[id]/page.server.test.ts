// Integration test for REQ-001 US-2 AC2 / US-3 edge case: project detail
// load — renders the project, degrades to a not-found state instead of
// crashing, and best-effort touches recent-projects on success.
//
// This module imports `$env/dynamic/private`, a SvelteKit virtual module
// the vitest config does not provide (no sveltekit() plugin — filed as
// BUG-004/BUG-007). Mocking it here, per test file, is the established
// non-invasive workaround. `load()` is called directly against a minimal
// fake RequestEvent.

import { describe, expect, it, vi } from 'vitest';

vi.mock('$env/dynamic/private', () => ({ env: { API_URL: 'https://api.test' } }));

const { load } = await import('./+page.server.js');

const PROJECT_BODY = { id: 'p1', title: 'Project One', priority: 'medium' };

function jsonResponse(body: unknown, ok = true) {
	return { ok, json: async () => body } as Response;
}

function makeEvent(overrides: { id?: string; cookie?: string; fetch: ReturnType<typeof vi.fn> }) {
	return {
		params: { id: overrides.id ?? 'p1' },
		request: {
			headers: {
				get: (name: string) => (name === 'cookie' ? (overrides.cookie ?? '') : null),
			},
		},
		fetch: overrides.fetch,
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
		expect(result).toEqual({ notFound: false, project: PROJECT_BODY });
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
		expect(fetchMock).toHaveBeenCalledTimes(2);
		const [postUrl, postInit] = fetchMock.mock.calls[1] as [string, RequestInit];
		expect(postUrl).toBe('https://api.test/api/kumiai/recent-projects');
		expect(postInit.method).toBe('POST');
		expect(postInit.body).toBe(JSON.stringify({ projectId: 'p1' }));
	});

	it('forwards the request cookie header on the recent-projects POST', async () => {
		const fetchMock = vi.fn(async (url: string, _init?: RequestInit) => {
			if (url.endsWith('/api/kumiai/projects/p1')) return jsonResponse(PROJECT_BODY);
			return jsonResponse(null);
		});
		await load(makeEvent({ id: 'p1', cookie: 'session=xyz', fetch: fetchMock }));
		const [, postInit] = fetchMock.mock.calls[1] as [string, RequestInit];
		expect((postInit.headers as Record<string, string>).cookie).toBe('session=xyz');
	});

	it('does not fail the page load when the recent-projects POST itself rejects (best-effort touch)', async () => {
		const fetchMock = vi.fn(async (url: string) => {
			if (url.endsWith('/api/kumiai/projects/p1')) return jsonResponse(PROJECT_BODY);
			throw new Error('touch failed');
		});
		const result = await load(makeEvent({ id: 'p1', fetch: fetchMock }));
		expect(result).toEqual({ notFound: false, project: PROJECT_BODY });
	});
});
