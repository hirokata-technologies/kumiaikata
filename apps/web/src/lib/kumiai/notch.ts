export const NOTCH_SEGMENTS = 10;
export const NOTCH_ON = 'var(--ink-2)';
export const NOTCH_OFF = 'var(--paper-3)';

/**
 * Renders effort only — an integer 1-10, always exactly 10 segments. Impact is a
 * completely different control (a 0-100% width progress bar) and must not be routed
 * through here.
 *
 * Segment `i` (1-indexed) is on when `i <= effort`. Non-integer input is floored, input
 * below 0 clamps to 0, above 10 clamps to 10, and `NaN` is treated as 0.
 */
export function notchBar(effort: number): boolean[] {
	const normalized = Number.isNaN(effort) ? 0 : Math.min(NOTCH_SEGMENTS, Math.max(0, Math.floor(effort)));
	return Array.from({ length: NOTCH_SEGMENTS }, (_, index) => index + 1 <= normalized);
}
