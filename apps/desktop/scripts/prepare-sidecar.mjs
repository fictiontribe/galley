#!/usr/bin/env node
// Produces what the packaged app runs its server with (`tauri build` runs
// this first, through tauri.bundle.conf.json's beforeBuildCommand):
//
//   src-tauri/binaries/<slug>-node-<target triple>[.exe]   a Node.js runtime (externalBin)
//   src-tauri/resources/server/                            the CLI bundle (resources → server/)
//       <slug>.mjs, web/, starters/, overlay.js, NODE-LICENSE.txt
//
// Why Node and not a single executable from `bun build --compile`: the
// compiled binary can't serve a single request (Bun 1.1.17 rejects the
// Response objects @hono/node-server hands it), so it fails the end-to-end
// flow at the first step. See README "How the server is bundled".
//
// Environment
//   GALLEY_NODE_BINARY      Node executable to bundle (default: the one running this script).
//                           Must match the target's OS and CPU.
//   GALLEY_NODE_LICENSE     Its LICENSE file, when it isn't beside the binary.
//   GALLEY_SKIP_WEB_BUILD=1 Use packages/web/dist as it is.
//   TAURI_ENV_TARGET_TRIPLE Set by `tauri build`; otherwise asked from rustc.
import { execFileSync } from "node:child_process";
import { chmodSync, copyFileSync, cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const desktop = join(here, "..");
const repo = join(desktop, "..", "..");
const tauriDir = join(desktop, "src-tauri");
const cliDist = join(repo, "packages", "cli", "dist");
const MIN_NODE = [20, 11, 0];

const fail = (message) => {
  console.error(`✗ ${message}`);
  process.exit(1);
};
// On Windows pnpm is a .cmd file, which Node starts only through a shell. The arguments are fixed words, never input.
const run = (command, args, options = {}) => execFileSync(command, args, { stdio: "inherit", cwd: repo, shell: process.platform === "win32", ...options });

// The product slug, from the one place it is defined.
const brand = readFileSync(join(repo, "packages", "core", "src", "brand.ts"), "utf8");
const slug = /slug:\s*"([^"]+)"/.exec(brand)?.[1] ?? fail("couldn't read the product slug from packages/core/src/brand.ts");

function targetTriple() {
  if (process.env.TAURI_ENV_TARGET_TRIPLE) return process.env.TAURI_ENV_TARGET_TRIPLE;
  try {
    return execFileSync("rustc", ["--print", "host-tuple"], { encoding: "utf8" }).trim();
  } catch {
    // rustc older than 1.84 has no host-tuple; its -Vv output names the host.
    try {
      return /^host: (\S+)$/m.exec(execFileSync("rustc", ["-Vv"], { encoding: "utf8" }))?.[1] ?? fail("rustc didn't name its host target.");
    } catch {
      return fail("Couldn't run rustc to find the target triple. Put Rust on PATH, or set TAURI_ENV_TARGET_TRIPLE.");
    }
  }
}

const triple = targetTriple();

console.log(`  target ${triple}${process.env.TAURI_ENV_TARGET_TRIPLE ? " (from tauri build)" : " (this machine)"}`);
const windows = triple.includes("windows");
const tripleArch = triple.split("-")[0];
const nodeArch = { aarch64: "arm64", x86_64: "x64", i686: "ia32" }[tripleArch];
const tripleOs = triple.includes("apple-darwin") ? "darwin" : windows ? "win32" : triple.includes("linux") ? "linux" : null;
const nodeBinary = resolve(process.env.GALLEY_NODE_BINARY ?? process.execPath);

// ── 1. The Node runtime ──────────────────────────────────────────────────
const nodeInfo = JSON.parse(
  execFileSync(nodeBinary, ["-p", "JSON.stringify({ version: process.versions.node, arch: process.arch, platform: process.platform })"], { encoding: "utf8" })
);
const version = nodeInfo.version.split(".").map(Number);
const firstDifference = version.findIndex((part, i) => part !== MIN_NODE[i]);

if (firstDifference >= 0 && version[firstDifference] < MIN_NODE[firstDifference]) {
  fail(`Node ${nodeInfo.version} is too old to bundle; the server needs ${MIN_NODE.join(".")} or later.`);
}
if (nodeInfo.platform !== tripleOs || nodeInfo.arch !== nodeArch) {
  fail(`${nodeBinary} is Node for ${nodeInfo.platform}-${nodeInfo.arch}, but the app is being built for ${triple}. Set GALLEY_NODE_BINARY to a matching Node executable.`);
}
if (nodeInfo.version.split(".")[0] % 2 === 1) {
  console.warn(`! Node ${nodeInfo.version} is not an LTS release; bundle an even-numbered (LTS) Node for builds you ship.`);
}

const binaries = join(tauriDir, "binaries");
const sidecar = join(binaries, `${slug}-node-${triple}${windows ? ".exe" : ""}`);

mkdirSync(binaries, { recursive: true });
rmSync(sidecar, { force: true });
copyFileSync(nodeBinary, sidecar);
chmodSync(sidecar, 0o755);

// The licence ships with the runtime. Official archives keep it beside bin/.
const licenseCandidates = [
  process.env.GALLEY_NODE_LICENSE,
  join(dirname(nodeBinary), "LICENSE"),
  join(dirname(nodeBinary), "..", "LICENSE"),
  join(dirname(nodeBinary), "..", "share", "doc", "node", "LICENSE"),
].filter(Boolean);
const licenseFile = licenseCandidates.find((file) => existsSync(file));
let license = licenseFile ? readFileSync(licenseFile, "utf8") : null;

if (!license) {
  const url = `https://raw.githubusercontent.com/nodejs/node/v${nodeInfo.version}/LICENSE`;

  try {
    const response = await fetch(url);

    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    license = await response.text();
    console.log(`  Node's LICENSE wasn't beside the binary; fetched it from ${url}`);
  } catch (error) {
    fail(`Node's LICENSE isn't beside ${nodeBinary} and couldn't be fetched (${error.message}). Set GALLEY_NODE_LICENSE to its path.`);
  }
}
console.log(`✓ Node ${nodeInfo.version} (${nodeInfo.platform}-${nodeInfo.arch}) → ${sidecar}`);

// ── 2. The web UI and the CLI bundle ────────────────────────────────────
const hadCliDist = existsSync(cliDist);

if (process.env.GALLEY_SKIP_WEB_BUILD !== "1") run("pnpm", ["--filter", "@galley/web", "build"]);
if (!existsSync(join(repo, "packages", "web", "dist", "index.html"))) fail("The web UI isn't built (packages/web/dist/index.html is missing), and an app without it would show nothing.");
run("pnpm", ["--filter", "galley-cms", "build"]);

const server = join(tauriDir, "resources", "server");

rmSync(server, { recursive: true, force: true });
mkdirSync(server, { recursive: true });
cpSync(cliDist, server, { recursive: true });
if (!existsSync(join(server, `${slug}.mjs`)) || !existsSync(join(server, "web", "index.html"))) fail(`The bundle in ${server} is incomplete.`);
writeFileSync(
  join(server, "NODE-LICENSE.txt"),
  `The ${slug}-node executable bundled with this app is Node.js ${nodeInfo.version}, unmodified (https://nodejs.org).\nIts licence and the licences of the components it includes follow.\n\n${license}`
);
// bin/galley.js prefers dist/ over the TypeScript sources, so don't leave a
// bundle behind for development runs that didn't have one before.
if (!hadCliDist) rmSync(cliDist, { recursive: true, force: true });

console.log(`✓ server bundle → ${server}`);
