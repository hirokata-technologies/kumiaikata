import type { Pill } from './types.js';

/**
 * One shared status -> pill map for Goal / Project / Requirement / Task, keyed by the
 * status word itself so the same word renders identically everywhere it appears.
 *
 * `backlog` and `todo` intentionally share a background and differ only in foreground —
 * that is the prototype's real value, not a copy-paste slip.
 *
 * `failed` and `waived` are Task-only words with no prototype equivalent: `failed` shares
 * `blocked`'s colouring (both are failure states) and is distinguished by its label;
 * `waived` is dimmer than `done` because it is finished-without-being-done.
 */
const STATUS_PILLS: Record<string, Pill> = {
	backlog: { bg: 'var(--paper-1)', fg: 'var(--fg-4)', label: 'Backlog' },
	todo: { bg: 'var(--paper-1)', fg: 'var(--fg-3)', label: 'To do' },
	'in-progress': { bg: 'var(--success-soft)', fg: 'var(--success)', label: 'In progress' },
	blocked: { bg: 'var(--danger-soft)', fg: 'var(--danger)', label: 'Blocked' },
	done: { bg: 'var(--paper-2)', fg: 'var(--fg-3)', label: 'Done' },
	failed: { bg: 'var(--danger-soft)', fg: 'var(--danger)', label: 'Failed' },
	waived: { bg: 'var(--paper-2)', fg: 'var(--fg-4)', label: 'Waived' }
};

const FALLBACK_BG = 'var(--paper-1)';
const FALLBACK_FG = 'var(--fg-4)';

/**
 * Resolves any status word to its pill. Takes a plain `string`, not a union, so it can be
 * handed unvalidated server data. Unknown or empty input returns a neutral fallback pill
 * with the raw value as the label — never throws.
 */
export function statusPill(status: string): Pill {
	const known = STATUS_PILLS[status];
	if (known) return known;
	return { bg: FALLBACK_BG, fg: FALLBACK_FG, label: status };
}
