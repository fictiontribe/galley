#!/usr/bin/env node
// Runs the bundled CLI when it has been built (dist/galley.mjs); inside the
// monorepo, runs the TypeScript entry through tsx instead.
import { existsSync } from "node:fs";

// Kept in step with "engines" in package.json and MIN_NODE in src/commands/doctor.ts.
const [major, minor] = process.versions.node.split(".").map(Number);

if (major < 20 || (major === 20 && minor < 11)) {
  process.stderr.write(`Galley needs Node 20.11 or newer, and this computer has Node ${process.versions.node}. Install the current LTS version from https://nodejs.org, then run the same command again.\n`);
  process.exit(1);
}

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
