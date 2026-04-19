import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    coverage: {
      provider: "v8",
      reporter: [
        "text",
        "lcov",
      ],
      // Keep local coverage failures aligned with .octocov.yml.
      thresholds: {
        branches: 100,
        functions: 100,
        lines: 100,
        statements: 100,
      },
      include: [
        "src/**/*.ts",
      ],
      exclude: [
        "src/main.ts",
        "src/shared/types.ts",
      ],
    },
    include: [
      "__tests__/**/*.test.ts",
    ],
  },
});
