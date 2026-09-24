import { describe, it, expect } from 'vitest';
import { approvalPill } from './approval.js';
import type { PlanApproval } from './types.js';

describe('approvalPill', () => {
	it('resolves approved', () => {
		expect(approvalPill('approved')).toEqual({
			bg: 'var(--success-soft)',
			fg: 'var(--success)',
			label: 'Plan approved'
		});
	});

	it('resolves pending', () => {
		expect(approvalPill('pending')).toEqual({
			bg: 'var(--warning-soft)',
			fg: 'var(--warning)',
			label: 'Awaiting approval'
		});
	});

	it('resolves rejected', () => {
		expect(approvalPill('rejected')).toEqual({
			bg: 'var(--danger-soft)',
			fg: 'var(--danger)',
			label: 'Plan rejected'
		});
	});

	it('resolves null and undefined to "No plan"', () => {
		const expected = { bg: 'var(--paper-1)', fg: 'var(--fg-4)', label: 'No plan' };
		expect(approvalPill(null)).toEqual(expected);
		expect(approvalPill(undefined)).toEqual(expected);
	});

	it('keeps rejected distinct from null/No-plan on bg, fg and label so the fallthrough cannot quietly return', () => {
		const rejected = approvalPill('rejected');
		const noPlan = approvalPill(null);
		expect(rejected.bg).not.toBe(noPlan.bg);
		expect(rejected.fg).not.toBe(noPlan.fg);
		expect(rejected.label).not.toBe(noPlan.label);
	});

	it.each(['nonsense', ''])('falls back to "No plan" for unrecognised input %s without throwing', (input) => {
		const bogus = input as unknown as PlanApproval;
		expect(() => approvalPill(bogus)).not.toThrow();
		expect(approvalPill(bogus)).toEqual({
			bg: 'var(--paper-1)',
			fg: 'var(--fg-4)',
			label: 'No plan'
		});
	});
});
