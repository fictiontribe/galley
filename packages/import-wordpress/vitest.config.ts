import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    // The end-to-end tests write real sites with git and run the starter's own build; on a busy machine that takes a while.
    testTimeout: 90_000,
    hookTimeout: 120_000,
  },
});
