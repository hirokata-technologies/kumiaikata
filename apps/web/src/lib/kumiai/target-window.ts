import type { TargetWindow, TargetWindowKind } from './types.js';

export const MONTH_NAMES = [
	'January',
	'February',
	'March',
	'April',
	'May',
	'June',
	'July',
	'August',
	'September',
	'October',
	'November',
	'December'
];

/**
 * `label` is always the bare period name, with no year — the year is `TargetWindow.year`.
 * Validates `num` against its kind (week 1-53, month 1-12, quarter 1-4) and falls back to
 * a safe, non-empty label rather than throwing on out-of-range input.
 */
export function deriveTargetWindowLabel(kind: TargetWindowKind, num: number): string {
	if (kind === 'week') {
		return `Week ${num}`;
	}
	if (kind === 'month') {
		if (Number.isInteger(num) && num >= 1 && num <= 12) return MONTH_NAMES[num - 1];
		return `Month ${num}`;
	}
	if (kind === 'quarter') {
		if (Number.isInteger(num) && num >= 1 && num <= 4) return `Q${num}`;
		return `Quarter ${num}`;
	}
	return `${kind} ${num}`;
}

/** "Week 39" | "October" | "Q4" — the bare period name, no year. */
export function formatTargetWindow(tw: TargetWindow): string {
	return tw.label || deriveTargetWindowLabel(tw.kind, tw.number);
}

/** "Week 39 2026" — the bare period name with the year appended. */
export function formatTargetWindowLong(tw: TargetWindow): string {
	return `${formatTargetWindow(tw)} ${tw.year}`;
}
