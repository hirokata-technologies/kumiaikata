import { sveltekit } from "@sveltejs/kit/vite";
import { defineConfig } from "vitest/config";
import { playwright } from "@vitest/browser-playwright";
import { resolve } from "path";

// Browser-mode component tests are named `*.svelte.test.ts` and live under
// src/lib/components/**. The glob is anchored to that directory (not a bare
// src/**/*.svelte.test.ts) so that node-environment `*.svelte.ts` rune-module tests
// living elsewhere under src/lib (e.g. src/lib/settings.svelte.test.ts,
// src/lib/workspace.svelte.test.ts from REQ-001 TASK-019) are never captured by it.
const BROWSER_TEST_GLOB = "src/lib/components/**/*.svelte.test.ts";

export default defineConfig({
	// Needed for SvelteKit's virtual modules (e.g. $env/dynamic/public) to resolve in
	// tests -- vitest.config.ts is a separate Vite config from vite.config.ts and does
	// not inherit its plugins.
	plugins: [sveltekit()],
	resolve: {
		alias: {
			$lib: resolve(__dirname, "src/lib"),
		},
	},
	test: {
		// Coverage is a root-level `test` option in Vitest 4 -- it is not configurable
		// per-project -- so it stays here and applies across both projects below.
		coverage: {
			provider: "v8",
			include: ["src/lib/**/*.ts"],
			exclude: [
				"src/lib/types.ts",
				"src/lib/index.ts",
				"src/lib/api/**",
				"src/lib/components/**",
				"src/lib/assets/**",
				"src/lib/ai.ts",
				"src/lib/auth-client.ts",
				"**/*.test.ts",
			],
			thresholds: {
				lines: 70,
				branches: 70,
				functions: 70,
				statements: 70,
			},
		},
		projects: [
			{
				extends: true,
				test: {
					name: "unit",
					environment: "node",
					include: ["src/**/*.{test,spec}.ts"],
					exclude: [BROWSER_TEST_GLOB],
				},
			},
			{
				extends: true,
				test: {
					name: "browser",
					include: [BROWSER_TEST_GLOB],
					setupFiles: ["./vitest-setup-browser.ts"],
					browser: {
						enabled: true,
						headless: true,
						// Desktop by default; below 768px the app shell collapses its sidebar.
						viewport: { width: 1280, height: 800 },
						provider: playwright(),
						instances: [{ browser: "chromium" }],
					},
				},
			},
		],
	},
});
