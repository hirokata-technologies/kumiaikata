// Root landing redirect: /login when signed out, /week when the active workspace has a
// goal with a project, /roadmap otherwise.
//
// `load()` is called directly with a minimal fake RequestEvent (locals, fetch, cookies), per the
// test plan's established pattern (BUG-004's $env/dynamic workaround does
// not apply here — this file imports no `$env` module). `redirect()`
// throws, so each case catches the thrown Redirect and asserts its shape.

import { describe, it, expect } from 'vitest';
import { isRedirect } from '@sveltejs/kit';

const { load } = await import('./+page.server.js');

function run(locals: unknown, lists: Record<string, unknown>) {
	const fetch = async (path: string) => {
		const key = Object.keys(lists).find((k) => path.startsWith(k));
		return { ok: key !== undefined, json: async () => lists[key ?? ''] };
	};
	// @ts-expect-error - minimal fake RequestEvent
	return load({ locals, fetch, cookies: { get: () => undefined } }).then(
		() => undefined,
		(err: unknown) => err
	);
}

const user = { id: 'u1', email: 'a@hirokata.dev' };
const workspaces = [{ id: 'w1', isDefault: true }];

describe('root +page.server.ts — landing redirect', () => {
	it('redirects 303 to /login when locals.user is absent (auth guard)', async () => {
		const caught = await run({}, {});
		expect(isRedirect(caught)).toBe(true);
		expect((caught as { status: number }).status).toBe(303);
		expect((caught as { location: string }).location).toBe('/login');
	});

	it('redirects to /week when a goal and a project exist', async () => {
		const caught = await run(
			{ user },
			{
				'/api/kumiai/workspaces': workspaces,
				'/api/kumiai/goals': [{ id: 'g1' }],
				'/api/kumiai/projects': [{ id: 'p1', goalId: 'g1' }]
			}
		);
		expect((caught as { location: string }).location).toBe('/week');
	});

	it('redirects to /roadmap when there are no goals', async () => {
		const caught = await run(
			{ user },
			{
				'/api/kumiai/workspaces': workspaces,
				'/api/kumiai/goals': [],
				'/api/kumiai/projects': [{ id: 'p1', goalId: 'g1' }]
			}
		);
		expect((caught as { location: string }).location).toBe('/roadmap');
	});

	it('redirects to /roadmap when a goal has no project', async () => {
		const caught = await run(
			{ user },
			{
				'/api/kumiai/workspaces': workspaces,
				'/api/kumiai/goals': [{ id: 'g1' }],
				'/api/kumiai/projects': []
			}
		);
		expect((caught as { location: string }).location).toBe('/roadmap');
	});
});
