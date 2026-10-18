import { describe, it, expect } from "vitest";
import { formatKey, kumiaiPriorityOf, GUILD_PRIORITY_OF } from "./guild-vocab.js";
import { toIsoUtc } from "./guild.js";

describe("formatKey", () => {
	it("zero-pads to three digits", () => {
		expect(formatKey("TASK", 1)).toBe("TASK-001");
		expect(formatKey("REQ", 42)).toBe("REQ-042");
		expect(formatKey("GOAL", 999)).toBe("GOAL-999");
	});

	it("writes numbers past 999 in full", () => {
		expect(formatKey("TASK", 1000)).toBe("TASK-1000");
	});

	it("rejects a non-positive or fractional number", () => {
		expect(() => formatKey("BUG", 0)).toThrow(RangeError);
		expect(() => formatKey("BUG", 1.5)).toThrow(RangeError);
	});
});

describe("project priority mapping", () => {
	it("maps Kumiai priority to the guild's 1-5 and back, with 5 stored as low", () => {
		expect(GUILD_PRIORITY_OF.urgent).toBe(1);
		expect(GUILD_PRIORITY_OF.low).toBe(4);
		expect(kumiaiPriorityOf(1)).toBe("urgent");
		expect(kumiaiPriorityOf(2)).toBe("high");
		expect(kumiaiPriorityOf(3)).toBe("medium");
		expect(kumiaiPriorityOf(4)).toBe("low");
		expect(kumiaiPriorityOf(5)).toBe("low");
	});
});

describe("toIsoUtc", () => {
	it("reads a raw timestamp string as UTC", () => {
		expect(toIsoUtc("2026-10-18 09:00:00")).toBe("2026-10-18T09:00:00Z");
		expect(toIsoUtc("2026-10-18 09:00:00.123")).toBe("2026-10-18T09:00:00.123Z");
	});

	it("keeps an explicit offset and passes Dates through", () => {
		expect(toIsoUtc("2026-10-18T10:00:00+01:00")).toBe("2026-10-18T09:00:00Z");
		expect(toIsoUtc(new Date("2026-10-18T09:00:00Z"))).toBe("2026-10-18T09:00:00Z");
	});

	it("returns null for nothing or garbage", () => {
		expect(toIsoUtc(null)).toBeNull();
		expect(toIsoUtc(undefined)).toBeNull();
		expect(toIsoUtc("not a date")).toBeNull();
	});
});
