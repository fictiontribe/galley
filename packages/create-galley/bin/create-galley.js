#!/usr/bin/env node
// @ts-check
// npm create galley@latest [name] -- [--starter <name>] [--no-open] [--no-install]
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { findGalley, galleyArguments, MISSING_GALLEY, nodeProblem, USAGE } from "../index.js";

const problem = nodeProblem(process.versions.node);

if (problem) {
  process.stderr.write(`${problem}\n`);
  process.exit(1);
}

const argv = process.argv.slice(2);

if (argv[0] === "--version" || argv[0] === "-v") {
  process.stdout.write(`${JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")).version}\n`);
  process.exit(0);
}

const galley = findGalley(import.meta.url);

if (!galley) {
  process.stderr.write(`${MISSING_GALLEY}\n`);
  process.exit(1);
}
if (argv.includes("--help") || argv.includes("-h")) {
  process.stdout.write(`${USAGE}\n\n`);
}

// One process for the whole flow, with this terminal: the picker, the
// progress and Ctrl+C all go straight to `galley new`.
// Under `bun create` (when Bun runs this file itself) Galley still runs on Node, which the starters need.
const runtime = /** @type {NodeJS.ProcessVersions & { bun?: string }} */ (process.versions).bun ? "node" : process.execPath;
const child = spawn(runtime, [galley.bin, ...galleyArguments(argv, process.env, galley.starters)], { stdio: "inherit", env: process.env });

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
