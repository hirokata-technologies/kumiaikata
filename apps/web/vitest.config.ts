import { defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		environment: "node",
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
	},
});
