import { describe, it, expect } from 'vitest';
import { statusPill } from './status.js';

describe('statusPill', () => {
	it.each([
		['backlog', 'var(--paper-1)', 'var(--fg-4)', 'Backlog'],
		['todo', 'var(--paper-1)', 'var(--fg-3)', 'To do'],
		['in-progress', 'var(--success-soft)', 'var(--success)', 'In progress'],
		['blocked', 'var(--danger-soft)', 'var(--danger)', 'Blocked'],
		['done', 'var(--paper-2)', 'var(--fg-3)', 'Done'],
		['failed', 'var(--danger-soft)', 'var(--danger)', 'Failed'],
		['waived', 'var(--paper-2)', 'var(--fg-4)', 'Waived']
	] as const)('resolves %s to { bg: %s, fg: %s, label: %s }', (status, bg, fg, label) => {
		expect(statusPill(status)).toEqual({ bg, fg, label });
	});

	it('gives backlog and todo the same background but a different foreground', () => {
		expect(statusPill('backlog').bg).toBe(statusPill('todo').bg);
		expect(statusPill('backlog').fg).not.toBe(statusPill('todo').fg);
	});

	it('gives failed the same colouring as blocked, distinguished only by label', () => {
		const failed = statusPill('failed');
		const blocked = statusPill('blocked');
		expect(failed.bg).toBe(blocked.bg);
		expect(failed.fg).toBe(blocked.fg);
		expect(failed.label).not.toBe(blocked.label);
	});

	it('falls back to a neutral pill with the raw value as label for unknown input', () => {
		expect(statusPill('nonsense')).toEqual({
			bg: 'var(--paper-1)',
			fg: 'var(--fg-4)',
			label: 'nonsense'
		});
	});

	it('falls back to a neutral pill with an empty label for empty string', () => {
		expect(statusPill('')).toEqual({ bg: 'var(--paper-1)', fg: 'var(--fg-4)', label: '' });
	});
});
