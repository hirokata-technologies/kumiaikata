import { describe, expect, it } from 'vitest';
import { NAV_PLANNING, isActive } from './nav-config.js';

describe('NAV_PLANNING', () => {
	it('has the Goals & Projects and Impact & effort entries', () => {
		expect(NAV_PLANNING.map((e) => [e.label, e.href])).toEqual([
			['Goals & Projects', '/roadmap'],
			['Impact & effort', '/matrix'],
		]);
	});
});

describe('isActive', () => {
	it('matches an exact path', () => {
		expect(isActive('/roadmap', '/roadmap')).toBe(true);
	});

	it('matches a nested path under the href', () => {
		expect(isActive('/projects/abc123', '/projects')).toBe(true);
	});

	it('does not false-positive on a sibling route with a shared prefix', () => {
		expect(isActive('/roadmaps', '/roadmap')).toBe(false);
	});

	it('does not match an unrelated route', () => {
		expect(isActive('/matrix', '/roadmap')).toBe(false);
	});

	it('matches the root path only exactly', () => {
		expect(isActive('/', '/')).toBe(true);
		expect(isActive('/roadmap', '/')).toBe(false);
	});
});
