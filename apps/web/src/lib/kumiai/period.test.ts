import { describe, it, expect } from 'vitest';
import {
	currentPeriod,
	describePeriod,
	isoWeek,
	isoWeekStart,
	matchesPeriod,
	toTargetWindow,
	weekCalendarRows
} from './period.js';
import type { TargetWindow } from './types.js';

const week = (number: number, year = 2026): TargetWindow => ({
	kind: 'week',
	label: `Week ${number}`,
	year,
	number
});

describe('isoWeek / isoWeekStart', () => {
	it('numbers 21 September 2026 as week 39', () => {
		expect(isoWeek(new Date(2026, 8, 21))).toEqual({ year: 2026, week: 39 });
	});

	it('puts 1 January 2027 in week 53 of 2026', () => {
		expect(isoWeek(new Date(2027, 0, 1))).toEqual({ year: 2026, week: 53 });
	});

	it('round-trips a week to its Monday', () => {
		const monday = isoWeekStart(2026, 39);
		expect([monday.getFullYear(), monday.getMonth(), monday.getDate()]).toEqual([2026, 8, 21]);
	});
});

describe('weekCalendarRows', () => {
	it('returns six Monday-first rows and flags days outside the month as dim', () => {
		const rows = weekCalendarRows(2026, 9);
		expect(rows).toHaveLength(6);
		expect(rows[0].days).toHaveLength(7);
		expect(rows[0].days[0].dim).toBe(true);
		expect(rows.some((r) => r.no === 39)).toBe(true);
	});
});

describe('matchesPeriod', () => {
	it('never matches a project with no target', () => {
		expect(matchesPeriod(null, { kind: 'week', year: 2026, number: 39 })).toBe(false);
	});

	it('matches a week target to its own week only', () => {
		expect(matchesPeriod(week(39), { kind: 'week', year: 2026, number: 39 })).toBe(true);
		expect(matchesPeriod(week(39), { kind: 'week', year: 2026, number: 40 })).toBe(false);
	});

	it('matches a week target to its month and quarter', () => {
		expect(matchesPeriod(week(39), { kind: 'month', year: 2026, number: 9 })).toBe(true);
		expect(matchesPeriod(week(39), { kind: 'quarter', year: 2026, number: 3 })).toBe(true);
		expect(matchesPeriod(week(39), { kind: 'quarter', year: 2026, number: 4 })).toBe(false);
	});

	it('does not show a month or quarter target under a specific week', () => {
		const month: TargetWindow = { kind: 'month', label: 'October', year: 2026, number: 10 };
		const quarter: TargetWindow = { kind: 'quarter', label: 'Q4', year: 2026, number: 4 };
		expect(matchesPeriod(month, { kind: 'week', year: 2026, number: 42 })).toBe(false);
		expect(matchesPeriod(month, { kind: 'quarter', year: 2026, number: 4 })).toBe(true);
		expect(matchesPeriod(quarter, { kind: 'month', year: 2026, number: 10 })).toBe(false);
	});

	it('keeps years apart', () => {
		expect(matchesPeriod(week(39, 2025), { kind: 'quarter', year: 2026, number: 3 })).toBe(false);
	});
});

describe('currentPeriod / toTargetWindow', () => {
	const now = new Date(2026, 9, 18);

	it('resolves the week, month and quarter containing a date', () => {
		expect(currentPeriod('week', now)).toEqual({ kind: 'week', year: 2026, number: 42 });
		expect(currentPeriod('month', now)).toEqual({ kind: 'month', year: 2026, number: 10 });
		expect(currentPeriod('quarter', now)).toEqual({ kind: 'quarter', year: 2026, number: 4 });
	});

	it('labels a selection the way the API stores it', () => {
		expect(toTargetWindow({ kind: 'month', year: 2026, number: 10 }).label).toBe('October');
	});
});

describe('describePeriod', () => {
	it('spells out a week from Monday to Sunday', () => {
		expect(describePeriod({ kind: 'week', year: 2026, number: 39 }).sub).toBe(
			'Monday 21 – Sunday 27 September 2026'
		);
	});

	it('names the starting month when a week crosses a month boundary', () => {
		expect(describePeriod({ kind: 'week', year: 2026, number: 40 }).sub).toBe(
			'Monday 28 September – Sunday 4 October 2026'
		);
	});

	it('titles months and quarters with the year', () => {
		expect(describePeriod({ kind: 'month', year: 2026, number: 10 }).title).toBe('October 2026');
		expect(describePeriod({ kind: 'quarter', year: 2026, number: 4 }).title).toBe('Q4 2026');
	});
});
