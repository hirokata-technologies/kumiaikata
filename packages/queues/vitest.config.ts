import { defineConfig } from "vitest/config";
export default defineConfig({
  test: {
    environment: "node",
    setupFiles: ["./test/setup.ts"],
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      exclude: ["src/index.ts", "src/workers.ts", "**/*.test.ts"],
      thresholds: { lines: 90, branches: 45, functions: 90, statements: 90 },
    },
  },
});
