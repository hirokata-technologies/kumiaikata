import { defineConfig } from "vitest/config";
export default defineConfig({
  test: {
    environment: "node",
    setupFiles: ["./test/setup.ts"],
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      exclude: [
        "src/index.ts",
        "src/better-auth.ts",
        "src/provisioning.ts",
        "src/middleware.ts",
        "**/*.test.ts",
      ],
      thresholds: { lines: 95, branches: 85, functions: 95, statements: 95 },
    },
  },
});
