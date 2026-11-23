// Builds the overlay into one small, dependency-free IIFE: dist/overlay.js.
// `node build.mjs` from the package; src/node.ts also calls buildOverlay()
// when dist is missing or older than the sources.
import { mkdirSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const here = dirname(fileURLToPath(import.meta.url));

export const OUT_FILE = join(here, "dist", "overlay.js");

export async function buildOverlay() {
  mkdirSync(dirname(OUT_FILE), { recursive: true });
  await build({
    entryPoints: [join(here, "src", "main.ts")],
    outfile: OUT_FILE,
    bundle: true,
    format: "iife",
    platform: "browser",
    target: ["es2020"],
    minify: true,
    legalComments: "none",
    banner: { js: "/* galley overlay */" },
    logLevel: "warning",
  });
  return OUT_FILE;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const out = await buildOverlay();
  console.log(`✓ dist/overlay.js (${(statSync(out).size / 1024).toFixed(1)} KB)`);
}
