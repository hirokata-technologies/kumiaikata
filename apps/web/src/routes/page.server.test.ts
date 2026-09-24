// Integration test for REQ-001 US-3 AC4: root landing redirects
// authenticated users to /week (a real behavior change from the
// pre-existing test-free file that used to render the old Kata board).
//
// `load()` is called directly with a minimal fake RequestEvent, per the
// test plan's established pattern (BUG-004's $env/dynamic workaround does
// not apply here — this file imports no `$env` module). `redirect()`
// throws, so each case catches the thrown Redirect and asserts its shape.

import { describe, it, expect } from 'vitest';
import { isRedirect } from '@sveltejs/kit';

const { load } = await import('./+page.server.js');

describe('root +page.server.ts — landing redirect', () => {
	it('redirects 303 to /login when locals.user is absent (auth guard)', () => {
		let caught: unknown;
		try {
			// @ts-expect-error - minimal fake RequestEvent, only `locals` is read
			load({ locals: {} });
		} catch (err) {
			caught = err;
		}
		expect(isRedirect(caught)).toBe(true);
		expect((caught as { status: number }).status).toBe(303);
		expect((caught as { location: string }).location).toBe('/login');
	});

	it('redirects 303 to /week when locals.user is present, not the old root board (US-3 AC4)', () => {
		let caught: unknown;
		try {
			// @ts-expect-error - minimal fake RequestEvent, only `locals` is read
			load({ locals: { user: { id: 'u1', email: 'a@hirokata.dev' } } });
		} catch (err) {
			caught = err;
		}
		expect(isRedirect(caught)).toBe(true);
		expect((caught as { status: number }).status).toBe(303);
		expect((caught as { location: string }).location).toBe('/week');
	});
});
