import { describe, it, expect } from 'vitest';
import { quadrantOf, QUADRANT_LABELS } from './quadrant.js';

describe('quadrantOf', () => {
	it('resolves impact = 50, effort = 5 to quick-win (both boundaries inclusive)', () => {
		expect(quadrantOf(50, 5)).toBe('quick-win');
	});

	it('resolves high impact, low effort to quick-win', () => {
		expect(quadrantOf(80, 2)).toBe('quick-win');
	});

	it('resolves high impact, high effort to big-bet', () => {
		expect(quadrantOf(80, 8)).toBe('big-bet');
	});

	it('resolves low impact, low effort to fill-in', () => {
		expect(quadrantOf(20, 2)).toBe('fill-in');
	});

	it('resolves low impact, high effort to money-pit', () => {
		expect(quadrantOf(20, 8)).toBe('money-pit');
	});
});

describe('QUADRANT_LABELS', () => {
	it('has a label for every quadrant', () => {
		expect(QUADRANT_LABELS).toEqual({
			'quick-win': 'Quick win',
			'big-bet': 'Big bet',
			'fill-in': 'Fill-in',
			'money-pit': 'Money pit'
		});
	});
});
