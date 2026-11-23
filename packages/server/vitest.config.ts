import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    // Many tests make real git repositories and builds; on a busy or small machine (CI) they need room.
    testTimeout: process.env.CI ? 120_000 : 60_000,
    hookTimeout: process.env.CI ? 120_000 : 60_000,
  },
});
