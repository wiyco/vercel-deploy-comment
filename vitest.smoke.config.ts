import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    fileParallelism: false,
    include: [
      "__tests__/e2e/**/*.smoke.test.ts",
    ],
    maxWorkers: 1,
  },
});
