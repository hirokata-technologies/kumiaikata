// Integration seam: the legacy railway.json Config-as-Code files are GONE
// (US-1 AC1) — TASK-051 deleted them, superseded by `.railway/railway.ts`.
// This is a regression guard against a future change bringing either file
// back, or leaving surviving prose that still names a file that no longer
// exists. Real filesystem, real `git grep` subprocess, no mocks, no network.
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const THIS_FILE = path
	.relative(ROOT, fileURLToPath(import.meta.url))
	.split(path.sep)
	.join("/");

const SKIPPED_DIRS = new Set([
	".git",
	".guild",
	"node_modules",
	"dist",
	"build",
	".svelte-kit",
	".turbo",
	"coverage",
]);
const MAX_SCAN_BYTES = 2 * 1024 * 1024;

/** Filesystem fallback for environments where `git grep` is unavailable. */
function searchFilesystem(dir: string, found: string[] = []): string[] {
	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		if (entry.isDirectory()) {
			if (!SKIPPED_DIRS.has(entry.name)) searchFilesystem(path.join(dir, entry.name), found);
			continue;
		}
		if (!entry.isFile()) continue;
		const full = path.join(dir, entry.name);
		try {
			if (statSync(full).size > MAX_SCAN_BYTES) continue;
			if (/railway\.json/i.test(readFileSync(full, "utf8"))) {
				found.push(path.relative(ROOT, full).split(path.sep).join("/"));
			}
		} catch {
			// unreadable file: skip
		}
	}
	return found;
}

/**
 * Every file in the repository whose text contains "railway.json",
 * relative to ROOT, forward-slash separated. `git grep` exits 1 (not an
 * error) when it finds nothing, which this treats as "no hits". Any other
 * git failure (no git binary, not a repository, shallow or broken clone)
 * falls back to a filesystem search.
 */
function filesReferencingLegacyConfigName(): string[] {
	try {
		const output = execFileSync("git", ["grep", "-il", "railway\\.json"], {
			cwd: ROOT,
			encoding: "utf8",
			stdio: ["ignore", "pipe", "ignore"],
		});
		return output
			.split("\n")
			.map((line) => line.trim())
			.filter((line) => line.length > 0);
	} catch (error) {
		const err = error as { status?: number };
		if (err.status === 1) return [];
		return searchFilesystem(ROOT);
	}
}

describe("legacy railway.json files are removed and unreferenced", () => {
	it("apps/api/railway.json does not exist on disk", () => {
		expect(existsSync(path.join(ROOT, "apps", "api", "railway.json"))).toBe(false);
	});

	it("apps/kata-relay-service/railway.json does not exist on disk", () => {
		expect(existsSync(path.join(ROOT, "apps", "kata-relay-service", "railway.json"))).toBe(false);
	});

	it("no file in the repository references railway.json by name, outside this guard and .guild/", () => {
		const hits = filesReferencingLegacyConfigName().filter(
			(file) => file !== THIS_FILE && !file.startsWith(".guild/"),
		);
		expect(hits).toEqual([]);
	});
});
