import { describe, it, expect } from "vitest";
import { appendAfter, insertBetween, reorderToMatch } from "./fractional.js";
import { AppError } from "../http/error.js";

describe("appendAfter", () => {
	it("returns a non-empty string when called with null (first key)", () => {
		const key = appendAfter(null);
		expect(typeof key).toBe("string");
		expect(key.length).toBeGreaterThan(0);
	});

	it("returns a key that sorts after 'a0'", () => {
		const key = appendAfter("a0");
		expect(key > "a0").toBe(true);
	});
});

describe("insertBetween", () => {
	it("returns a key k such that 'a0' < k < 'a1'", () => {
		const key = insertBetween("a0", "a1");
		expect(key > "a0").toBe(true);
		expect(key < "a1").toBe(true);
	});

	it("returns a key that sorts before 'a0' when lower bound is null", () => {
		const key = insertBetween(null, "a0");
		expect(key < "a0").toBe(true);
	});
});

describe("reorderToMatch", () => {
	const makeItems = (ids: string[], positions: string[]) =>
		ids.map((id, i) => ({ _id: id, position: positions[i] }));

	it("returns updates that produce the desired sort order [C, A, B]", () => {
		const items = makeItems(["A", "B", "C"], ["a0", "a1", "a2"]);
		const updates = reorderToMatch(items, ["C", "A", "B"]);

		// Apply the updates to a copy of items
		const posMap = new Map(items.map((item) => [item._id, item.position]));
		for (const u of updates) {
			posMap.set(u.id, u.position);
		}

		// Sort by the new positions and verify order matches [C, A, B]
		const sorted = [...items].sort((x, y) => {
			const px = posMap.get(x._id) ?? x.position;
			const py = posMap.get(y._id) ?? y.position;
			return px < py ? -1 : px > py ? 1 : 0;
		});

		expect(sorted.map((item) => item._id)).toEqual(["C", "A", "B"]);
	});

	it("throws AppError with VALIDATION_ERROR when desiredId is not in items", () => {
		const items = makeItems(["A", "B"], ["a0", "a1"]);
		expect(() => reorderToMatch(items, ["A", "X"])).toThrow(AppError);

		try {
			reorderToMatch(items, ["A", "X"]);
		} catch (err) {
			expect(err).toBeInstanceOf(AppError);
			expect((err as AppError).code).toBe("VALIDATION_ERROR");
		}
	});

	it("documents actual behaviour when called with same order: returns N updates (positions regenerated)", () => {
		// BUG-010 context: reorderToMatch calls generateNKeysBetween(null, null, N) which
		// always produces fresh keys. Since existing positions differ from regenerated ones,
		// all N items receive updates even when the order hasn't changed.
		// This is the documented behaviour, not an optimisation bug.
		const items = makeItems(["A", "B", "C"], ["a0", "a1", "a2"]);
		const updates = reorderToMatch(items, ["A", "B", "C"]);
		expect(updates.length).toBe(3); // all positions are regenerated
	});
});
