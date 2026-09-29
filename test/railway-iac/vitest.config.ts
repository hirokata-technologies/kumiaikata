import { defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		environment: "node",
		// No globalSetup, no Docker — unlike test/integration, this suite
		// evaluates .railway/railway.ts and its guards fully offline.
		testTimeout: 30_000,
		include: ["**/*.test.ts"],
	},
});
