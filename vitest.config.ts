import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: { extensions: [".ts", ".js"] },
  test: {
    globals: true,
    environment: "node",
    include: ["tests/**/*.test.ts"],
    coverage: { provider: "v8", reporter: ["text", "lcov"] },
  },
});
