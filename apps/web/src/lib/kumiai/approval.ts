import type { Pill, PlanApproval } from './types.js';

const APPROVAL_PILLS: Record<PlanApproval, Pill> = {
	approved: { bg: 'var(--success-soft)', fg: 'var(--success)', label: 'Plan approved' },
	pending: { bg: 'var(--warning-soft)', fg: 'var(--warning)', label: 'Awaiting approval' },
	rejected: { bg: 'var(--danger-soft)', fg: 'var(--danger)', label: 'Plan rejected' }
};

const NO_PLAN_PILL: Pill = { bg: 'var(--paper-1)', fg: 'var(--fg-4)', label: 'No plan' };

/**
 * `rejected` is deliberately NOT the prototype's behaviour: the prototype's two-way
 * ternary has no `rejected` branch, so a rejected plan silently falls through and renders
 * as "No plan" — a plan someone actively refused becomes indistinguishable from one that
 * was never written. This function keeps all three real states distinct.
 */
export function approvalPill(approval: PlanApproval | null | undefined): Pill {
	if (approval == null) return NO_PLAN_PILL;
	return APPROVAL_PILLS[approval] ?? NO_PLAN_PILL;
}
