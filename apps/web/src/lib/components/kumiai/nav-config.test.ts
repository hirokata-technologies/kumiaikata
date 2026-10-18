import { describe, expect, it } from 'vitest';
import { NAV_PLANNING, NAV_VIEWS, isActive } from './nav-config.js';

describe('NAV_VIEWS', () => {
	it('has the four Views entries with the exact labels, routes and badges', () => {
		expect(NAV_VIEWS.map((e) => [e.label, e.href, e.badge])).toEqual([
			['This week', '/week', undefined],
			['Backlog', '/backlog', 'backlog'],
			['To do', '/todo', 'todo'],
			['In progress', '/board', 'inProgress'],
		]);
	});
});

describe('NAV_PLANNING', () => {
	it('has the Impact & effort and Roadmap entries', () => {
		expect(NAV_PLANNING.map((e) => [e.label, e.href])).toEqual([
			['Roadmap', '/roadmap'],
			['Impact & effort', '/matrix'],
		]);
	});
});

describe('isActive', () => {
	it('matches an exact path', () => {
		expect(isActive('/week', '/week')).toBe(true);
	});

	it('matches a nested path under the href', () => {
		expect(isActive('/projects/abc123', '/projects')).toBe(true);
	});

	it('does not false-positive on a sibling route with a shared prefix', () => {
		expect(isActive('/weekly', '/week')).toBe(false);
	});

	it('does not match an unrelated route', () => {
		expect(isActive('/board', '/week')).toBe(false);
	});

	it('matches the root path only exactly', () => {
		expect(isActive('/', '/')).toBe(true);
		expect(isActive('/week', '/')).toBe(false);
	});
});
