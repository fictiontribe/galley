#!/usr/bin/env node
// The kit is TypeScript source inside the monorepo; run it through tsx,
// which also lets the adapter under test be a .ts file.
let register;

try {
  ({ register } = await import("tsx/esm/api"));
} catch {
  process.stderr.write("galley-adapter-check needs tsx to run from source. Run `pnpm install` in the repository.\n");
  process.exit(2);
}
register();
await import(new URL("../src/bin.ts", import.meta.url).href);
