import { describe, it, expect } from 'vitest';
import { deriveTargetWindowLabel, formatTargetWindow } from './target-window.js';
import type { TargetWindow } from './types.js';

describe('deriveTargetWindowLabel', () => {
	it('formats a week as "Week 39"', () => {
		expect(deriveTargetWindowLabel('week', 39)).toBe('Week 39');
	});

	it('formats a month as its full English name', () => {
		expect(deriveTargetWindowLabel('month', 10)).toBe('October');
		expect(deriveTargetWindowLabel('month', 1)).toBe('January');
		expect(deriveTargetWindowLabel('month', 12)).toBe('December');
	});

	it('formats a quarter as "Q4"', () => {
		expect(deriveTargetWindowLabel('quarter', 4)).toBe('Q4');
	});

	it('falls back to a safe non-empty label for out-of-range month/quarter numbers', () => {
		expect(deriveTargetWindowLabel('month', 13)).toBe('Month 13');
		expect(deriveTargetWindowLabel('month', 0)).toBe('Month 0');
		expect(deriveTargetWindowLabel('quarter', 5)).toBe('Quarter 5');
		expect(deriveTargetWindowLabel('quarter', 0)).toBe('Quarter 0');
	});

	it('falls back to a safe non-empty label for an unrecognised kind rather than throwing', () => {
		const bogus = 'fortnight' as unknown as Parameters<typeof deriveTargetWindowLabel>[0];
		expect(() => deriveTargetWindowLabel(bogus, 3)).not.toThrow();
		expect(deriveTargetWindowLabel(bogus, 3)).toBe('fortnight 3');
	});
});

describe('formatTargetWindow', () => {
	it.each([
		[{ kind: 'week', label: 'Week 39', year: 2026, number: 39 }, 'Week 39'],
		[{ kind: 'month', label: 'October', year: 2026, number: 10 }, 'October'],
		[{ kind: 'quarter', label: 'Q4', year: 2026, number: 4 }, 'Q4']
	] as const)('formats %o as %s', (tw, expected) => {
		expect(formatTargetWindow(tw as TargetWindow)).toBe(expected);
	});
});
