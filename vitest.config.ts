import path from "node:path";

import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  test: {
    // Server code is the bulk of the suite, so node stays the default.
    // Component tests opt into the browser environment per file with a
    // `// @vitest-environment jsdom` docblock.
    environment: "node",
    include: ["src/**/*.test.{ts,tsx}"],
    setupFiles: ["./vitest.setup.ts"],
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
