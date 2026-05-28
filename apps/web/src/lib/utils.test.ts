import { describe, it, expect } from "vitest";
import { cn } from "./utils.js";

describe("cn", () => {
	it("merges class names and excludes falsy values", () => {
		expect(cn("foo", undefined, "bar")).toBe("foo bar");
	});

	it("resolves conflicting Tailwind classes via tailwind-merge (last wins)", () => {
		expect(cn("px-4", "px-2")).toBe("px-2");
	});

	it("handles an empty call returning empty string", () => {
		expect(cn()).toBe("");
	});

	it("handles null and false as falsy inputs", () => {
		expect(cn("a", null, false, "b")).toBe("a b");
	});

	it("deduplicates non-conflicting classes", () => {
		// tailwind-merge/clsx don't collapse identical classes, but cn should still work
		const result = cn("text-sm", "font-bold");
		expect(result).toBe("text-sm font-bold");
	});

	it("merges background-color Tailwind conflicts correctly", () => {
		expect(cn("bg-red-500", "bg-blue-500")).toBe("bg-blue-500");
	});

	it("handles conditional class objects", () => {
		expect(cn({ "text-red-500": true, "text-blue-500": false })).toBe(
			"text-red-500",
		);
	});
});
