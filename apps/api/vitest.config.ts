import { availableParallelism } from "node:os";
import { defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		environment: "node",
		// Test files run in parallel, each worker on its own clone of the migrated database
		// (test/global-setup.ts). Capped so workers x pool size stays under max_connections (100).
		maxWorkers: Math.max(1, Math.min(availableParallelism() - 1, 8)),
		// Migrates the test database once for the whole run
		globalSetup: ["./test/global-setup.ts"],
		setupFiles: [
			"./test/setup-env.ts",
			"./test/setup-mocks.ts",
			"./test/setup-db.ts",
		],
		coverage: {
			provider: "v8",
			include: ["src/**/*.ts"],
			exclude: [
				"src/env.ts",
				"src/auth/better-auth.ts",
				"src/db/schema/**",
				"src/db/client.ts",
				"src/storage/disk.ts",
				"src/storage/index.ts",
				"src/routes/sse.ts",
				"src/http/error.ts",
				"**/*.test.ts",
			],
			thresholds: {
				lines: 90,
				branches: 79,
				functions: 90,
				statements: 90,
			},
		},
	},
});
