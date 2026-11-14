import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts", "test/**/*.test.ts"],
    // Integration suites share one PostgreSQL test database, so files run one at a time.
    fileParallelism: false,
    testTimeout: 60_000,
    hookTimeout: 30_000,
    coverage: { provider: "v8", include: ["src/**/*.ts"], exclude: ["src/server.ts", "src/cli/**"] },
  },
});
