import { defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		environment: "node",
		// Serial execution — tests share a single Postgres connection pool
		fileParallelism: false,
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
