// Reference date for all time-dependent tests: 2026-05-26T12:00:00Z (Tuesday)
// With a fixed clock, date arithmetic results are fully deterministic regardless of wall-clock time.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
	todayISO,
	parseISO,
	daysBetween,
	formatDue,
	getPresetDate,
	parseDueFromText,
	pickLabels,
	deepCloneColumns,
	SEED_COLUMNS,
} from "./data.js";

const REF_DATE = new Date("2026-05-26T12:00:00Z");

beforeEach(() => {
	vi.useFakeTimers();
	vi.setSystemTime(REF_DATE);
});

afterEach(() => {
	vi.useRealTimers();
});

// ---------------------------------------------------------------------------
// todayISO
// ---------------------------------------------------------------------------

describe("todayISO", () => {
	it("returns a string matching YYYY-MM-DD format", () => {
		expect(todayISO()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
	});

	it("returns today's date in local time (2026-05-26 with fixed clock)", () => {
		// The fixed system time is 2026-05-26T12:00:00Z — local date is 2026-05-26.
		expect(todayISO()).toBe("2026-05-26");
	});
});

// ---------------------------------------------------------------------------
// parseISO
// ---------------------------------------------------------------------------

describe("parseISO", () => {
	it("parses 2026-06-15 into a Date with year=2026, month=5 (0-indexed), day=15", () => {
		const d = parseISO("2026-06-15");
		expect(d.getFullYear()).toBe(2026);
		expect(d.getMonth()).toBe(5); // 0-indexed: June = 5
		expect(d.getDate()).toBe(15);
	});
});

// ---------------------------------------------------------------------------
// daysBetween
// ---------------------------------------------------------------------------

describe("daysBetween", () => {
	it("returns 6 for dates 2026-05-20 to 2026-05-26", () => {
		expect(daysBetween(new Date(2026, 4, 20), new Date(2026, 4, 26))).toBe(6);
	});

	it("returns 0 when both dates are the same", () => {
		expect(daysBetween(new Date(2026, 4, 26), new Date(2026, 4, 26))).toBe(0);
	});

	it("returns a negative value when a is after b", () => {
		expect(daysBetween(new Date(2026, 4, 26), new Date(2026, 4, 20))).toBe(-6);
	});
});

// ---------------------------------------------------------------------------
// formatDue
// ---------------------------------------------------------------------------

describe("formatDue", () => {
	it("returns null for undefined input", () => {
		expect(formatDue(undefined)).toBeNull();
	});

	it("returns tone='overdue' and 'Xd overdue' for a date in the past (diff < -1)", () => {
		// 2026-05-23 is 3 days before today (2026-05-26)
		const result = formatDue("2026-05-23");
		expect(result).not.toBeNull();
		expect(result!.tone).toBe("overdue");
		expect(result!.label).toBe("3d overdue");
		expect(result!.diff).toBe(-3);
	});

	it("returns tone='overdue' and 'Yesterday' for diff=-1", () => {
		const result = formatDue("2026-05-25");
		expect(result).not.toBeNull();
		expect(result!.tone).toBe("overdue");
		expect(result!.label).toBe("Yesterday");
		expect(result!.diff).toBe(-1);
	});

	it("returns tone='today' and label='Today' for diff=0", () => {
		const result = formatDue("2026-05-26");
		expect(result).not.toBeNull();
		expect(result!.tone).toBe("today");
		expect(result!.label).toBe("Today");
		expect(result!.diff).toBe(0);
	});

	it("returns tone='soon' and label='Tomorrow' for diff=1", () => {
		const result = formatDue("2026-05-27");
		expect(result).not.toBeNull();
		expect(result!.tone).toBe("soon");
		expect(result!.label).toBe("Tomorrow");
		expect(result!.diff).toBe(1);
	});

	it("returns tone='soon' and a weekday abbreviation for diff in 2-6", () => {
		// 2026-05-29 is Friday (3 days from Tuesday 2026-05-26)
		const result = formatDue("2026-05-29");
		expect(result).not.toBeNull();
		expect(result!.tone).toBe("soon");
		expect(result!.label).toBe("Fri");
		expect(result!.diff).toBe(3);
	});

	it("returns tone='later' and a month/day label for diff >= 7", () => {
		// 2026-06-05 is 10 days away
		const result = formatDue("2026-06-05");
		expect(result).not.toBeNull();
		expect(result!.tone).toBe("later");
		expect(result!.label).toBe("Jun 5");
		expect(result!.diff).toBe(10);
	});

	it("includes the year in the label when the due date is in a future year", () => {
		const result = formatDue("2027-01-15");
		expect(result).not.toBeNull();
		expect(result!.tone).toBe("later");
		expect(result!.label).toContain("2027");
	});
});

// ---------------------------------------------------------------------------
// getPresetDate
// ---------------------------------------------------------------------------

describe("getPresetDate", () => {
	it("returns today's ISO date for preset='today'", () => {
		expect(getPresetDate("today")).toBe("2026-05-26");
	});

	it("returns tomorrow's ISO date for preset='tomorrow'", () => {
		expect(getPresetDate("tomorrow")).toBe("2026-05-27");
	});

	it("returns the next Saturday for preset='weekend' (ref date is Tuesday 2026-05-26)", () => {
		// Tuesday → Saturday is 4 days: (6 - 2 + 7) % 7 = 4; 4 ≠ 0 so daysToSat = 4
		expect(getPresetDate("weekend")).toBe("2026-05-30");
	});

	it("returns a date 7 days from today for preset='nextweek'", () => {
		expect(getPresetDate("nextweek")).toBe("2026-06-02");
	});

	it("returns empty string for an unknown preset", () => {
		expect(getPresetDate("unknown")).toBe("");
	});
});

// ---------------------------------------------------------------------------
// parseDueFromText
// ---------------------------------------------------------------------------

describe("parseDueFromText", () => {
	it("returns today's ISO date for 'today'", () => {
		expect(parseDueFromText("today")).toBe("2026-05-26");
	});

	it("returns tomorrow's ISO date for 'tomorrow'", () => {
		expect(parseDueFromText("tomorrow")).toBe("2026-05-27");
	});

	it("returns a date 7 days from today for 'next week'", () => {
		expect(parseDueFromText("next week")).toBe("2026-06-02");
	});

	it("returns a date 3 days from today for 'in 3 days'", () => {
		expect(parseDueFromText("in 3 days")).toBe("2026-05-29");
	});

	it("handles 'in 1 day' (singular)", () => {
		expect(parseDueFromText("in 1 day")).toBe("2026-05-27");
	});

	it("returns the ISO date for 'Jun 15' in the current year", () => {
		// Jun is in the future relative to May 2026, so year = 2026
		expect(parseDueFromText("Jun 15")).toBe("2026-06-15");
	});

	it("returns null for text with no recognisable date pattern", () => {
		expect(parseDueFromText("no date here")).toBeNull();
	});

	it("returns next weekday occurrence for a named weekday (Friday from Tuesday)", () => {
		// Today is Tuesday (2026-05-26). Next Friday = 3 days away → 2026-05-29
		expect(parseDueFromText("by friday")).toBe("2026-05-29");
	});

	it("adds 7 days for a weekday that is today (edge case: same weekday)", () => {
		// Today is Tuesday. Asking for 'tuesday' should return next Tuesday (+7 days).
		expect(parseDueFromText("tuesday")).toBe("2026-06-02");
	});
});

// ---------------------------------------------------------------------------
// pickLabels
// ---------------------------------------------------------------------------

describe("pickLabels", () => {
	it("returns an array containing 'social' for social text", () => {
		const labels = pickLabels("call Maya for dinner");
		expect(labels).toContain("social");
	});

	it("returns an array containing 'finance' for finance text", () => {
		const labels = pickLabels("pay quarterly tax bill");
		expect(labels).toContain("finance");
	});

	it("returns an array containing at least one relevant label for 'buy gym equipment'", () => {
		// 'buy' matches /errand/, 'gym' matches /health/. pickLabels returns up to 2.
		const labels = pickLabels("buy gym equipment");
		const relevant = new Set(["errand", "health"]);
		const hasRelevant = labels.some((l) => relevant.has(l));
		expect(hasRelevant).toBe(true);
	});

	it("returns ['errand'] as the default fallback when no pattern matches", () => {
		const labels = pickLabels("something completely unrelated");
		expect(labels).toEqual(["errand"]);
	});

	it("returns at most 2 labels", () => {
		// "call Maya to pay the bill and go to the gym" would match multiple labels
		const labels = pickLabels("call Maya to pay the bill and go to the gym");
		expect(labels.length).toBeLessThanOrEqual(2);
	});
});

// ---------------------------------------------------------------------------
// deepCloneColumns
// ---------------------------------------------------------------------------

describe("deepCloneColumns", () => {
	it("returns a deep clone — mutating a card's labels in the clone does not affect the original", () => {
		const original = SEED_COLUMNS;
		const clone = deepCloneColumns(original);

		// Mutate the clone
		clone[0].cards[0].labels.push("work" as never);

		// Original should be unaffected
		expect(original[0].cards[0].labels).not.toContain("work");
	});

	it("produces a new array (not the same reference)", () => {
		const clone = deepCloneColumns(SEED_COLUMNS);
		expect(clone).not.toBe(SEED_COLUMNS);
		expect(clone[0]).not.toBe(SEED_COLUMNS[0]);
		expect(clone[0].cards[0]).not.toBe(SEED_COLUMNS[0].cards[0]);
	});
});
