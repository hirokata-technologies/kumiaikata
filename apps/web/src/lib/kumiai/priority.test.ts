import { describe, it, expect } from 'vitest';
import { projectPriorityPill, priorityLevelPill } from './priority.js';

describe('projectPriorityPill', () => {
	it.each([
		['urgent', 'var(--danger-soft)', 'var(--danger)', '#9B3B2E', 'Urgent'],
		['high', 'var(--warning-soft)', 'var(--warning)', '#B07A2A', 'High'],
		['medium', 'var(--accent-soft)', 'var(--accent)', '#2E3A6B', 'Medium'],
		['low', 'var(--paper-2)', 'var(--fg-3)', '#76716A', 'Low']
	] as const)('resolves %s', (p, bg, fg, dotHex, label) => {
		expect(projectPriorityPill(p)).toEqual({ bg, fg, dotHex, label });
	});

	it.each(['nonsense', '', null, undefined])('falls back for %s without throwing', (input) => {
		expect(() => projectPriorityPill(input as unknown as string)).not.toThrow();
		const pill = projectPriorityPill(input as unknown as string);
		expect(pill.bg).toBe('var(--paper-1)');
		expect(pill.fg).toBe('var(--fg-4)');
		expect(pill.dotHex).toBe('#A8A29A');
		expect(pill.label).toBe(String(input));
	});
});

describe('priorityLevelPill', () => {
	it('reuses the word levels for 1-4 (1 = Urgent ... 4 = Low)', () => {
		expect(priorityLevelPill(1)).toEqual(projectPriorityPill('urgent'));
		expect(priorityLevelPill(2)).toEqual(projectPriorityPill('high'));
		expect(priorityLevelPill(3)).toEqual(projectPriorityPill('medium'));
		expect(priorityLevelPill(4)).toEqual(projectPriorityPill('low'));
	});

	it('defines level 5 as "Lowest", not present in the prototype', () => {
		expect(priorityLevelPill(5)).toEqual({
			bg: 'var(--paper-1)',
			fg: 'var(--fg-4)',
			dotHex: '#A8A29A',
			label: 'Lowest'
		});
	});

	it.each(['nonsense', '', null, undefined])('falls back for %s without throwing', (input) => {
		expect(() => priorityLevelPill(input as unknown as number)).not.toThrow();
		const pill = priorityLevelPill(input as unknown as number);
		expect(pill.bg).toBe('var(--paper-1)');
		expect(pill.fg).toBe('var(--fg-4)');
		expect(pill.dotHex).toBe('#A8A29A');
		expect(pill.label).toBe(String(input));
	});

	it('falls back for out-of-range numeric input', () => {
		expect(priorityLevelPill(0).label).toBe('0');
		expect(priorityLevelPill(6).label).toBe('6');
	});
});
