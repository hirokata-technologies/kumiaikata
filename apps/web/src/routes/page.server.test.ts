// Root landing redirect: /login when signed out, /roadmap (Goals & Projects) otherwise.
//
// `load()` is called directly with a minimal fake RequestEvent (locals), per the
// test plan's established pattern (BUG-004's $env/dynamic workaround does
// not apply here — this file imports no `$env` module). `redirect()`
// throws, so each case catches the thrown Redirect and asserts its shape.

import { describe, it, expect } from 'vitest';
import { isRedirect } from '@sveltejs/kit';

const { load } = await import('./+page.server.js');

function run(locals: unknown): unknown {
	try {
		// @ts-expect-error - minimal fake RequestEvent
		load({ locals });
		return undefined;
	} catch (err) {
		return err;
	}
}

const user = { id: 'u1', email: 'a@hirokata.dev' };

describe('root +page.server.ts — landing redirect', () => {
	it('redirects 303 to /login when locals.user is absent (auth guard)', () => {
		const caught = run({});
		expect(isRedirect(caught)).toBe(true);
		expect((caught as { status: number }).status).toBe(303);
		expect((caught as { location: string }).location).toBe('/login');
	});

	it('redirects 303 to /roadmap when signed in', () => {
		const caught = run({ user });
		expect(isRedirect(caught)).toBe(true);
		expect((caught as { status: number }).status).toBe(303);
		expect((caught as { location: string }).location).toBe('/roadmap');
	});
});
