// Unit tests for roadmap.ts — pure helpers + constants for the horizontal
// planning timeline (date math, week-range labeling, greedy row packing, and
// the localStorage-backed per-board schedule persistence).

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
	RM_DIMS,
	RM_MONTHS,
	RM_WEEK_DAYS,
	RM_DEFAULT_SPAN,
	rmStartOfDay,
	rmDaysInMonth,
	rmAddDays,
	rmIso,
	rmFullDate,
	rmWeekRange,
	packLane,
	loadSchedule,
	saveSchedule,
	type PackItem,
} from './roadmap.js';

describe('constants', () => {
	it('defines dims for all three densities', () => {
		expect(Object.keys(RM_DIMS).sort()).toEqual(['comfortable', 'compact', 'spacious']);
		for (const density of Object.keys(RM_DIMS) as (keyof typeof RM_DIMS)[]) {
			const d = RM_DIMS[density];
			expect(d.monthW).toBeGreaterThan(0);
			expect(d.cardW).toBeGreaterThan(0);
			expect(d.cardH).toBeGreaterThan(0);
		}
	});

	it('lists 12 months', () => {
		expect(RM_MONTHS).toHaveLength(12);
		expect(RM_MONTHS[0]).toBe('January');
		expect(RM_MONTHS[11]).toBe('December');
	});

	it('splits a month into 4 week segments', () => {
		expect(RM_WEEK_DAYS).toEqual([1, 8, 15, 22]);
	});

	it('defaults the span to 13 days', () => {
		expect(RM_DEFAULT_SPAN).toBe(13);
	});
});

describe('rmStartOfDay', () => {
	it('strips the time component', () => {
		const d = new Date(2026, 8, 22, 14, 37, 9);
		const r = rmStartOfDay(d);
		expect(r.getFullYear()).toBe(2026);
		expect(r.getMonth()).toBe(8);
		expect(r.getDate()).toBe(22);
		expect(r.getHours()).toBe(0);
		expect(r.getMinutes()).toBe(0);
		expect(r.getSeconds()).toBe(0);
	});
});

describe('rmDaysInMonth', () => {
	it('returns 31 for January', () => {
		expect(rmDaysInMonth(2026, 0)).toBe(31);
	});

	it('returns 30 for April', () => {
		expect(rmDaysInMonth(2026, 3)).toBe(30);
	});

	it('returns 28 for February in a non-leap year', () => {
		expect(rmDaysInMonth(2026, 1)).toBe(28);
	});

	it('returns 29 for February in a leap year', () => {
		expect(rmDaysInMonth(2024, 1)).toBe(29);
	});
});

describe('rmAddDays', () => {
	it('adds positive days, rolling over month boundaries', () => {
		const d = new Date(2026, 8, 28); // Sep 28
		const r = rmAddDays(d, 5);
		expect(r.getMonth()).toBe(9); // October
		expect(r.getDate()).toBe(3);
	});

	it('adds negative days, rolling back over month boundaries', () => {
		const d = new Date(2026, 8, 2); // Sep 2
		const r = rmAddDays(d, -5);
		expect(r.getMonth()).toBe(7); // August
		expect(r.getDate()).toBe(28);
	});

	it('adds zero days as a no-op', () => {
		const d = new Date(2026, 8, 15);
		const r = rmAddDays(d, 0);
		expect(r.getFullYear()).toBe(2026);
		expect(r.getMonth()).toBe(8);
		expect(r.getDate()).toBe(15);
	});
});

describe('rmIso', () => {
	it('formats as YYYY-MM-DD with zero-padding', () => {
		expect(rmIso(new Date(2026, 0, 5))).toBe('2026-01-05');
	});

	it('does not pad double-digit month/day', () => {
		expect(rmIso(new Date(2026, 10, 22))).toBe('2026-11-22');
	});
});

describe('rmFullDate', () => {
	it('formats a valid ISO date as "Mon D"', () => {
		expect(rmFullDate('2026-09-15')).toBe('Sep 15');
	});

	it('formats January as "Jan"', () => {
		expect(rmFullDate('2026-01-01')).toBe('Jan 1');
	});

	it('returns an empty string for an invalid/unparseable date', () => {
		expect(rmFullDate('not-a-date')).toBe('');
	});

	it('returns an empty string for an empty string', () => {
		expect(rmFullDate('')).toBe('');
	});
});

describe('rmWeekRange', () => {
	it('renders a single-month range without repeating the month', () => {
		// segment [Sep 1, Sep 8) -> "Sep 1 – 7"
		const a = new Date(2026, 8, 1);
		const b = new Date(2026, 8, 8);
		expect(rmWeekRange(a, b)).toBe('Sep 1 – 7');
	});

	it('renders a cross-month range with both month names', () => {
		// segment [Sep 29, Oct 6) -> "Sep 29 – Oct 5"
		const a = new Date(2026, 8, 29);
		const b = new Date(2026, 9, 6);
		expect(rmWeekRange(a, b)).toBe('Sep 29 – Oct 5');
	});
});

describe('packLane', () => {
	it('packs non-overlapping items into a single row', () => {
		const items: PackItem[] = [
			{ left: 0, width: 10 },
			{ left: 20, width: 10 },
			{ left: 40, width: 10 },
		];
		const { items: packed, rows } = packLane(items, 2);
		expect(rows).toBe(1);
		expect(packed.every((it) => it.row === 0)).toBe(true);
	});

	it('pushes overlapping items into additional rows', () => {
		const items: PackItem[] = [
			{ left: 0, width: 20 },
			{ left: 5, width: 20 }, // overlaps first
			{ left: 10, width: 20 }, // overlaps both
		];
		const { items: packed, rows } = packLane(items, 2);
		expect(rows).toBe(3);
		const rowsUsed = new Set(packed.map((it) => it.row));
		expect(rowsUsed).toEqual(new Set([0, 1, 2]));
	});

	it('reuses an earlier row once its last bar has cleared, respecting the gap', () => {
		const items: PackItem[] = [
			{ left: 0, width: 10 }, // row 0, ends at 10
			{ left: 5, width: 10 }, // overlaps row 0 -> row 1
			{ left: 13, width: 10 }, // 13 >= 10 + gap(2) -> fits back in row 0
		];
		const { items: packed, rows } = packLane(items, 2);
		expect(rows).toBe(2);
		const third = packed.find((it) => it.left === 13);
		expect(third?.row).toBe(0);
	});

	it('sorts items by left position before packing', () => {
		const items: PackItem[] = [
			{ left: 30, width: 5, id: 'c' },
			{ left: 0, width: 5, id: 'a' },
			{ left: 15, width: 5, id: 'b' },
		];
		const { items: packed } = packLane(items, 1);
		expect(packed.map((it) => it.id)).toEqual(['a', 'b', 'c']);
	});

	it('returns rows = 1 even for an empty item list', () => {
		const { items: packed, rows } = packLane([], 2);
		expect(packed).toEqual([]);
		expect(rows).toBe(1);
	});
});

describe('loadSchedule / saveSchedule', () => {
	let store: Record<string, string>;
	const getItemMock = vi.fn<Storage['getItem']>((k: string) =>
		Object.prototype.hasOwnProperty.call(store, k) ? store[k]! : null,
	);
	const setItemMock = vi.fn<Storage['setItem']>((k: string, v: string) => {
		store[k] = v;
	});
	const mockStorage = {
		getItem: getItemMock,
		setItem: setItemMock,
		removeItem: vi.fn((k: string) => {
			delete store[k];
		}),
		clear: vi.fn(() => {
			store = {};
		}),
		key: vi.fn(() => null),
		length: 0,
	} as unknown as Storage;

	beforeEach(() => {
		store = {};
		getItemMock.mockClear();
		setItemMock.mockClear();
		vi.stubGlobal('localStorage', mockStorage);
	});

	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it('returns {} when localStorage is undefined', () => {
		vi.unstubAllGlobals();
		expect(loadSchedule('board-1')).toEqual({});
	});

	it('returns {} when boardId is empty', () => {
		expect(loadSchedule('')).toEqual({});
	});

	it('returns {} when nothing is stored for the board', () => {
		expect(loadSchedule('board-1')).toEqual({});
	});

	it('returns the parsed schedule when valid JSON is stored', () => {
		const sched = { 'task-1': { start: '2026-09-01', due: '2026-09-14' } };
		store['kata_roadmap_sched_board-1'] = JSON.stringify(sched);
		expect(loadSchedule('board-1')).toEqual(sched);
	});

	it('returns {} when the stored value is invalid JSON', () => {
		store['kata_roadmap_sched_board-1'] = '{not json';
		expect(loadSchedule('board-1')).toEqual({});
	});

	it('returns {} when the parsed value is not an object (e.g. a bare number)', () => {
		store['kata_roadmap_sched_board-1'] = '42';
		expect(loadSchedule('board-1')).toEqual({});
	});

	it('returns {} when getItem throws', () => {
		getItemMock.mockImplementationOnce(() => {
			throw new Error('blocked');
		});
		expect(loadSchedule('board-1')).toEqual({});
	});

	it('saves the schedule as JSON under the board-scoped key', () => {
		const sched = { 'task-1': { start: '2026-09-01', due: '2026-09-14' } };
		saveSchedule('board-1', sched);
		expect(store['kata_roadmap_sched_board-1']).toBe(JSON.stringify(sched));
	});

	it('is a no-op when localStorage is undefined', () => {
		vi.unstubAllGlobals();
		expect(() => saveSchedule('board-1', {})).not.toThrow();
	});

	it('is a no-op when boardId is empty', () => {
		saveSchedule('', { x: { start: 'a', due: 'b' } });
		expect(mockStorage.setItem).not.toHaveBeenCalled();
	});

	it('swallows a setItem failure (e.g. QuotaExceededError)', () => {
		setItemMock.mockImplementationOnce(() => {
			throw new Error('QuotaExceededError');
		});
		expect(() => saveSchedule('board-1', {})).not.toThrow();
	});

	it('round-trips a schedule through save then load', () => {
		const sched = { 'task-2': { start: '2026-10-01', due: '2026-10-10' } };
		saveSchedule('board-2', sched);
		expect(loadSchedule('board-2')).toEqual(sched);
	});
});
