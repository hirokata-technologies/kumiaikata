import { describe, it, expect } from 'vitest';
import { notchBar, NOTCH_SEGMENTS } from './notch.js';

describe('notchBar', () => {
	it('always returns length 10', () => {
		expect(notchBar(0)).toHaveLength(NOTCH_SEGMENTS);
		expect(notchBar(5)).toHaveLength(NOTCH_SEGMENTS);
		expect(notchBar(10)).toHaveLength(NOTCH_SEGMENTS);
		expect(notchBar(-3)).toHaveLength(NOTCH_SEGMENTS);
		expect(notchBar(99)).toHaveLength(NOTCH_SEGMENTS);
	});

	it('returns all-false for effort = 0', () => {
		expect(notchBar(0)).toEqual(Array(10).fill(false));
	});

	it('returns all-true for effort = 10', () => {
		expect(notchBar(10)).toEqual(Array(10).fill(true));
	});

	it('turns on segments 1..effort and leaves the rest off', () => {
		expect(notchBar(4)).toEqual([true, true, true, true, false, false, false, false, false, false]);
	});

	it('clamps negative input to 0', () => {
		expect(notchBar(-5)).toEqual(Array(10).fill(false));
	});

	it('clamps above-range input to 10', () => {
		expect(notchBar(15)).toEqual(Array(10).fill(true));
	});

	it('floors fractional input', () => {
		expect(notchBar(4.9)).toEqual(notchBar(4));
	});

	it('treats NaN as 0', () => {
		expect(notchBar(NaN)).toEqual(Array(10).fill(false));
	});
});
