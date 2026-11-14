import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";
export default defineConfig({
  test: {
    deps: { interopDefault: false },
    root: fileURLToPath(new URL(".", import.meta.url)),
    environment: "node",
    setupFiles: ["./tests/history-test-env.ts"],
    include: ["tests/d1-*.test.ts", "tests/outlayer-*.test.ts"],
    fileParallelism: false,
    testTimeout: 30000,
    hookTimeout: 30000,
  },
});
