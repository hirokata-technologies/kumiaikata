// Integration seam: legacy railway.json files are left untouched (US-2 AC3).
// Deleting them is PROJ-005's job, not this requirement's — this is a
// regression guard against a future change accidentally removing them
// early. Real filesystem, no mocks.
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

describe("legacy railway.json files are left in place", () => {
	it("apps/api/railway.json still exists on disk", () => {
		expect(existsSync(path.join(ROOT, "apps", "api", "railway.json"))).toBe(true);
	});

	it("apps/kata-relay-service/railway.json still exists on disk", () => {
		expect(existsSync(path.join(ROOT, "apps", "kata-relay-service", "railway.json"))).toBe(true);
	});
});
