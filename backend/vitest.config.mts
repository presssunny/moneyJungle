import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    environment: "node",
    // Parsing a real statement reads a file from disk and walks every row.
    testTimeout: 30_000,
    // The golden suites read the same fixtures; sequential keeps output readable.
    fileParallelism: false,
  },
});
