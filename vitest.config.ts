import path from "node:path";

import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    // Integration tests share a single Postgres database and TRUNCATE between
    // cases. Running test files in parallel workers lets one file's teardown
    // wipe another's rows mid-test (a flaky cross-file race). Keep files
    // sequential — the suite is small, so the cost is negligible.
    fileParallelism: false,
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
  },
});
