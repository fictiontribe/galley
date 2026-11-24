import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    // `@brand` too: the install tests render the whole app, brand assets included.
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)), "@brand": fileURLToPath(new URL("../../brand", import.meta.url)) },
  },
  test: {
    include: ["test/**/*.test.ts"],
    environment: "node",
    // The screen tests render the whole app and wait for it to settle (test/install/harness.ts `until`): room for a loaded machine.
    testTimeout: 60_000,
  },
});
