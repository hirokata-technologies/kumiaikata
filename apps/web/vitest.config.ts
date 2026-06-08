import { defineConfig } from "vitest/config";
import { resolve } from "path";

export default defineConfig({
	resolve: {
		alias: {
			$lib: resolve(__dirname, "src/lib"),
		},
	},
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
