// @ts-check
/**
 * galleycms: `npx galleycms [command] [options]` — unscoped alias for
 * `galley-cms`. It hands every argument straight to `galley` from the
 * `galley-cms` package installed beside it, after checking that Node is new
 * enough to run it.
 *
 * Written as plain JavaScript that old versions of Node can still parse, so
 * that on one of them the person gets a sentence, not a syntax error.
 */
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

/** The oldest Node galley-cms runs on (its package.json "engines"). */
export const MIN_NODE = "20.11.0";

/**
 * @param {string} version e.g. "18.19.0" or "v18.19.0"
 * @param {string} minimum
 * @returns {boolean}
 */
export function olderThan(version, minimum) {
  const a = version.replace(/^v/, "").split(".").map((part) => parseInt(part, 10) || 0);
  const b = minimum.split(".").map((part) => parseInt(part, 10) || 0);

  for (let i = 0; i < 3; i += 1) {
    if ((a[i] || 0) !== (b[i] || 0)) return (a[i] || 0) < (b[i] || 0);
  }
  return false;
}

/**
 * @param {string} version
 * @returns {string | null} what to tell the person, or null when this Node will do
 */
export function nodeProblem(version) {
  return olderThan(version, MIN_NODE)
    ? `Galley needs Node ${MIN_NODE.replace(/\.0$/, "")} or newer, and this computer has Node ${version.replace(/^v/, "")}. Install the current LTS version from https://nodejs.org, then run the same command again.`
    : null;
}

/**
 * Where galley-cms's CLI entrypoint is.
 *
 * @param {string} from a file inside galleycms
 * @returns {{ bin: string } | null}
 */
export function findGalley(from) {
  let manifestPath;

  try {
    manifestPath = createRequire(from).resolve("galley-cms/package.json");
  } catch {
    return null;
  }
  const root = dirname(manifestPath);
  let binPath = "bin/galley.js";

  try {
    const pkg = JSON.parse(readFileSync(manifestPath, "utf8"));

    if (typeof pkg.bin === "string") binPath = pkg.bin;
    else if (pkg.bin && typeof pkg.bin.galley === "string") binPath = pkg.bin.galley;
    else if (pkg.bin && typeof pkg.bin["galley-cms"] === "string") binPath = pkg.bin["galley-cms"];
  } catch {
    // Fall back to galley-cms's standard bin path.
  }
  return { bin: join(root, binPath) };
}

export const MISSING_GALLEY =
  "galleycms couldn't find Galley itself (the galley-cms package that should be installed with it). Run the same command again; if it still says this, run `npx galley-cms` instead.";
