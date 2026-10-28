import { deriveTargetWindowLabel } from './target-window.js';
import type { TargetWindow, TargetWindowKind } from './types.js';

/** A concrete period the UI can ask about: ISO week 1-53, month 1-12 or quarter 1-4 of a year. */
export interface PeriodSelection {
	kind: TargetWindowKind;
	year: number;
	number: number;
}

export interface CalendarRow {
	/** ISO week number of the row. */
	no: number;
	/** ISO week-year of the row (differs from the displayed year around New Year). */
	year: number;
	days: Array<{ n: number; dim: boolean }>;
}

const DAY_MS = 86_400_000;

/** ISO 8601 week and week-year of a local date. */
export function isoWeek(date: Date): { year: number; week: number } {
	const t = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
	const day = t.getUTCDay() || 7;
	t.setUTCDate(t.getUTCDate() + 4 - day);
	const yearStart = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
	return {
		year: t.getUTCFullYear(),
		week: Math.ceil(((t.getTime() - yearStart.getTime()) / DAY_MS + 1) / 7)
	};
}

/** Monday (local midnight) of an ISO week. */
export function isoWeekStart(year: number, week: number): Date {
	const jan4 = new Date(year, 0, 4);
	const day = (jan4.getDay() + 6) % 7;
	return new Date(year, 0, 4 - day + (week - 1) * 7);
}

/** The six Monday-first week rows that cover a month in the calendar picker. `month` is 1-12. */
export function weekCalendarRows(year: number, month: number): CalendarRow[] {
	const m = month - 1;
	const offset = (new Date(year, m, 1).getDay() + 6) % 7;
	return Array.from({ length: 6 }, (_, w) => {
		const rowStart = new Date(year, m, 1 - offset + w * 7);
		const iso = isoWeek(rowStart);
		const days = Array.from({ length: 7 }, (_, i) => {
			const d = new Date(year, m, 1 - offset + w * 7 + i);
			return { n: d.getDate(), dim: d.getMonth() !== m };
		});
		return { no: iso.week, year: iso.year, days };
	});
}

const quarterOfMonth = (month: number) => Math.floor((month - 1) / 3) + 1;

/**
 * The calendar year, month and quarter a target window falls into. A week resolves by its
 * Thursday (the ISO rule that decides which year a week belongs to), a month by itself and
 * a quarter has no month or week.
 */
function periodOf(tw: TargetWindow): {
	year: number;
	month: number | null;
	quarter: number;
	week: number | null;
} {
	if (tw.kind === 'week') {
		const thursday = isoWeekStart(tw.year, tw.number);
		thursday.setDate(thursday.getDate() + 3);
		const month = thursday.getMonth() + 1;
		return { year: thursday.getFullYear(), month, quarter: quarterOfMonth(month), week: tw.number };
	}
	if (tw.kind === 'month') {
		return { year: tw.year, month: tw.number, quarter: quarterOfMonth(tw.number), week: null };
	}
	return { year: tw.year, month: null, quarter: tw.number, week: null };
}

/**
 * Whether a target window sits inside a period. A week target matches its own week, its month
 * and its quarter; a month target matches its month and quarter; a quarter target only its
 * quarter — so "This week" never shows work that is only committed to a month.
 */
export function matchesPeriod(tw: TargetWindow | null, period: PeriodSelection): boolean {
	if (!tw) return false;
	const p = periodOf(tw);
	if (period.kind === 'quarter') return p.year === period.year && p.quarter === period.number;
	if (period.kind === 'month') return p.year === period.year && p.month === period.number;
	return tw.kind === 'week' && tw.year === period.year && p.week === period.number;
}

/** The period that contains `now`, for the given granularity. */
export function currentPeriod(kind: TargetWindowKind, now: Date): PeriodSelection {
	if (kind === 'week') {
		const { year, week } = isoWeek(now);
		return { kind, year, number: week };
	}
	if (kind === 'month') return { kind, year: now.getFullYear(), number: now.getMonth() + 1 };
	return { kind, year: now.getFullYear(), number: quarterOfMonth(now.getMonth() + 1) };
}

export function toTargetWindow(period: PeriodSelection): TargetWindow {
	return { ...period, label: deriveTargetWindowLabel(period.kind, period.number) };
}

/** "Week 39 2026" | "October 2026" | "Q4 2026". */
export function periodLabel(period: PeriodSelection): string {
	return `${deriveTargetWindowLabel(period.kind, period.number)} ${period.year}`;
}
