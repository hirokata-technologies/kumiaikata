import type { Pill } from './types.js';

export interface PriorityPill extends Pill {
	dotHex: string;
}

const FALLBACK_DOT_HEX = '#A8A29A';

/**
 * The four word-level priority pills, keyed by the word itself. `priorityLevelPill` reuses
 * these rows for levels 1-4 exactly (1 = Urgent ... 4 = Low).
 */
const PROJECT_PRIORITY_PILLS: Record<string, PriorityPill> = {
	urgent: { bg: 'var(--danger-soft)', fg: 'var(--danger)', dotHex: '#9B3B2E', label: 'Urgent' },
	high: { bg: 'var(--warning-soft)', fg: 'var(--warning)', dotHex: '#B07A2A', label: 'High' },
	medium: { bg: 'var(--accent-soft)', fg: 'var(--accent)', dotHex: '#2E3A6B', label: 'Medium' },
	low: { bg: 'var(--paper-2)', fg: 'var(--fg-3)', dotHex: '#76716A', label: 'Low' }
};

/** 1-4 map onto the word levels above; 5 ("Lowest") is ours — the prototype has only four. */
const PRIORITY_LEVEL_PILLS: Record<number, PriorityPill> = {
	1: PROJECT_PRIORITY_PILLS.urgent,
	2: PROJECT_PRIORITY_PILLS.high,
	3: PROJECT_PRIORITY_PILLS.medium,
	4: PROJECT_PRIORITY_PILLS.low,
	5: { bg: 'var(--paper-1)', fg: 'var(--fg-4)', dotHex: FALLBACK_DOT_HEX, label: 'Lowest' }
};

function fallback(raw: unknown): PriorityPill {
	return { bg: 'var(--paper-1)', fg: 'var(--fg-4)', dotHex: FALLBACK_DOT_HEX, label: String(raw) };
}

/** Project's word-enum priority (`urgent`/`high`/`medium`/`low`). Never throws. */
export function projectPriorityPill(p: string): PriorityPill {
	return PROJECT_PRIORITY_PILLS[p] ?? fallback(p);
}

/** Goal/Requirement/Task's numeric priority (1-5). Never throws. */
export function priorityLevelPill(n: number): PriorityPill {
	return PRIORITY_LEVEL_PILLS[n] ?? fallback(n);
}
