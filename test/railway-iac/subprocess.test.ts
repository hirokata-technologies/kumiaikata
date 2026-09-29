// Integration seam: `.railway/tsconfig.json` type-check and `.railway`
// lint, run as real subprocesses (`node:child_process`), no network, no
// Railway CLI, no Railway MCP tool. This is a config-syntax check, not the
// offline safety property the other suites prove — if `pnpm` is
// unavailable in the test environment, these skip with a clear message
// rather than failing the whole run.
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { describe, it, expect } from "vitest";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

function pnpmAvailable(): boolean {
	const probe = spawnSync("pnpm", ["--version"], { cwd: ROOT, encoding: "utf8" });
	return probe.status === 0;
}

const hasPnpm = pnpmAvailable();
const describeOrSkip = hasPnpm ? describe : describe.skip;

describeOrSkip("pnpm check:railway (tsc -p .railway/tsconfig.json)", () => {
	it("exits 0 from the repo root", () => {
		const result = spawnSync("pnpm", ["check:railway"], { cwd: ROOT, encoding: "utf8" });
		expect(result.status, `stdout:\n${result.stdout}\nstderr:\n${result.stderr}`).toBe(0);
	});
});

describeOrSkip("pnpm lint:railway (eslint .railway)", () => {
	it("exits 0 from the repo root, with no lint rules disabled", () => {
		const result = spawnSync("pnpm", ["lint:railway"], { cwd: ROOT, encoding: "utf8" });
		expect(result.status, `stdout:\n${result.stdout}\nstderr:\n${result.stderr}`).toBe(0);
	});
});

if (!hasPnpm) {
	console.warn("[railway-iac] pnpm is not available in this test environment — skipping check:railway/lint:railway");
}
