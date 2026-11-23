#!/usr/bin/env node
// Runs the bundled CLI when it has been built (dist/galley.mjs); inside the
// monorepo, runs the TypeScript entry through tsx instead.
import { existsSync } from "node:fs";

const bundle = new URL("../dist/galley.mjs", import.meta.url);

if (existsSync(bundle)) {
  await import(bundle.href);
} else {
  let register;

  try {
    ({ register } = await import("tsx/esm/api"));
  } catch {
    process.stderr.write("This copy of the CLI hasn't been built, and tsx isn't available to run it from source.\nRun `pnpm install` in the repository, or `pnpm --filter galley-cms build`.\n");
    process.exit(1);
  }
  register();
  await import(new URL("../src/bin.ts", import.meta.url).href);
}
