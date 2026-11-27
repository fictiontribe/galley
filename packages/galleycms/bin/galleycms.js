#!/usr/bin/env node
// @ts-check
// npx galleycms [command] [options]
import { spawn } from "node:child_process";
import { findGalley, MISSING_GALLEY, nodeProblem } from "../index.js";

const problem = nodeProblem(process.versions.node);

if (problem) {
  process.stderr.write(`${problem}\n`);
  process.exit(1);
}

const galley = findGalley(import.meta.url);

if (!galley) {
  process.stderr.write(`${MISSING_GALLEY}\n`);
  process.exit(1);
}

// One process for the whole flow, with this terminal: prompts, progress and
// Ctrl+C all go straight to `galley`.
// Under Bun, Galley still runs on Node, which the starters need.
const runtime = /** @type {NodeJS.ProcessVersions & { bun?: string }} */ (process.versions).bun ? "node" : process.execPath;
const child = spawn(runtime, [galley.bin, ...process.argv.slice(2)], { stdio: "inherit", env: process.env });

// Ctrl+C reaches the child from the terminal itself; other signals are passed on.
process.on("SIGINT", () => {});
for (const signal of /** @type {const} */ (["SIGTERM", "SIGHUP"])) process.on(signal, () => child.kill(signal));
child.on("error", (error) => {
  process.stderr.write(
    runtime === "node"
      ? "Galley runs on Node, and Node isn't installed on this computer. Install the current LTS version from https://nodejs.org, then run the same command again.\n"
      : `Galley couldn't be started: ${error.message}\n`
  );
  process.exit(1);
});
child.on("exit", (code, signal) => process.exit(code ?? (signal === "SIGINT" ? 130 : 1)));
