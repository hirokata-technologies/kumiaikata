/* roadmap.ts — pure helpers + constants for the horizontal planning timeline.
   The board only stores a single due date per task, so the timeline seeds a
   ~2-week span ending on the due date and lets the user drag/resize it. Those
   overrides are persisted locally (per board). Months run left→right, split
   into four week segments (W1–W4) that drags snap to. */

import { parseISO } from './data.js';

export type RoadmapDensity = 'compact' | 'comfortable' | 'spacious';
export type RoadmapLayout = 'swimlane' | 'unified';

export interface SpanSchedule {
	start: string; // YYYY-MM-DD
	due: string; // YYYY-MM-DD
}

export type ScheduleMap = Record<string, SpanSchedule>;

export interface RoadmapDims {
	monthW: number;
	cardW: number;
	cardH: number;
	rail: number;
	gap: number;
	pad: number;
	minW: number;
}

export const RM_DIMS: Record<RoadmapDensity, RoadmapDims> = {
	compact: { monthW: 200, cardW: 176, cardH: 64, rail: 176, gap: 8, pad: 12, minW: 72 },
	comfortable: { monthW: 256, cardW: 206, cardH: 82, rail: 196, gap: 10, pad: 14, minW: 88 },
	spacious: { monthW: 320, cardW: 232, cardH: 100, rail: 216, gap: 12, pad: 17, minW: 104 },
};

export const RM_MONTHS = [
	'January', 'February', 'March', 'April', 'May', 'June',
	'July', 'August', 'September', 'October', 'November', 'December',
];

export const RM_WEEK_DAYS = [1, 8, 15, 22]; // month split into 4 week segments
export const RM_DEFAULT_SPAN = 13; // days — a ~2-week default span ending on the due date

export function rmStartOfDay(d: Date): Date {
	return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

export function rmDaysInMonth(y: number, m: number): number {
	return new Date(y, m + 1, 0).getDate();
}

export function rmAddDays(date: Date, n: number): Date {
	return new Date(date.getFullYear(), date.getMonth(), date.getDate() + n);
}

export function rmIso(date: Date): string {
	return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

/** Short "Sep 15" formatting from an ISO date. */
export function rmFullDate(iso: string): string {
	const d = parseISO(iso);
	if (!d || Number.isNaN(d.getTime())) return '';
	return `${RM_MONTHS[d.getMonth()].slice(0, 3)} ${d.getDate()}`;
}

/** A week range label for the heat tooltip — `b` is the exclusive next-segment start. */
export function rmWeekRange(a: Date, b: Date): string {
	const end = rmAddDays(b, -1);
	const fm = RM_MONTHS[a.getMonth()].slice(0, 3);
	const tm = RM_MONTHS[end.getMonth()].slice(0, 3);
	return a.getMonth() === end.getMonth()
		? `${fm} ${a.getDate()} – ${end.getDate()}`
		: `${fm} ${a.getDate()} – ${tm} ${end.getDate()}`;
}

export interface PackItem {
	left: number;
	width: number;
	row?: number;
	[key: string]: unknown;
}

/** Greedy row packing — sort by start, drop each bar into the first row whose
    last bar ends before it (plus a gap). Returns the packed items + row count. */
export function packLane<T extends PackItem>(items: T[], gap: number): { items: T[]; rows: number } {
	const sorted = [...items].sort((a, b) => a.left - b.left);
	const rowsRight: number[] = [];
	for (const it of sorted) {
		let row = rowsRight.findIndex((r) => it.left >= r + gap);
		if (row === -1) {
			row = rowsRight.length;
			rowsRight.push(0);
		}
		rowsRight[row] = it.left + it.width;
		it.row = row;
	}
	return { items: sorted, rows: Math.max(1, rowsRight.length) };
}

// --- local persistence (per board) ---
const SCHED_PREFIX = 'kata_roadmap_sched_';

export function loadSchedule(boardId: string): ScheduleMap {
	try {
		if (typeof localStorage === 'undefined' || !boardId) return {};
		const raw = localStorage.getItem(SCHED_PREFIX + boardId);
		if (!raw) return {};
		const parsed = JSON.parse(raw);
		return parsed && typeof parsed === 'object' ? parsed : {};
	} catch {
		return {};
	}
}

export function saveSchedule(boardId: string, sched: ScheduleMap): void {
	try {
		if (typeof localStorage === 'undefined' || !boardId) return;
		localStorage.setItem(SCHED_PREFIX + boardId, JSON.stringify(sched));
	} catch {
		// QuotaExceeded / blocked — in-memory schedule still applies for the session
	}
}
