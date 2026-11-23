// @ts-check
/**
 * create-galley: `npm create galley@latest [name] -- [options]` (and
 * `pnpm create galley`, `yarn create galley`, `bun create galley`). It hands
 * everything to `galley new` from the galley-cms package installed beside it,
 * so there is one way a site is made. What it adds: a Node check that works
 * on old versions, and putting back the options npm keeps for itself when
 * they come without the `--`.
 *
 * Written as plain JavaScript that old versions of Node can still parse, so
 * that on one of them the person gets a sentence, not a syntax error.
 */
import { readdirSync, readFileSync } from "node:fs";
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
    ? `Galley needs Node ${MIN_NODE.replace(/\.0$/, "")} or newer (its starters need 22.23.4), and this computer has Node ${version.replace(/^v/, "")}. Install the current LTS version from https://nodejs.org, then run the same command again.`
    : null;
}

/**
 * The options `galley new` takes that have a value; the rest are switches.
 * Only used to tell names from option values.
 */
const VALUE_OPTIONS = new Set(["--starter", "--look", "--dir", "--use", "--port", "-p"]);

/**
 * @param {string[]} args
 * @returns {string[]} the arguments that aren't options or option values
 */
function positionals(args) {
  /** @type {string[]} */
  const out = [];

  for (let i = 0; i < args.length; i += 1) {
    const arg = /** @type {string} */ (args[i]);

    if (arg === "--") continue;
    if (arg.startsWith("-")) {
      if (VALUE_OPTIONS.has(arg)) i += 1;
      continue;
    }
    out.push(arg);
  }
  return out;
}

/**
 * Turns create-galley's arguments into `galley new`'s.
 *
 * `npm create galley my-site --starter caddow` (without the `--`) reaches us
 * as `my-site caddow`: npm takes `--starter` as its own setting, sets
 * npm_config_starter=true and passes the value on as a name. The same goes
 * for --no-open and --no-install (npm_config_open="" and so on). When npm
 * ran us, those settings are put back as the options they were meant to be.
 * `starters` is the list of names that mean a starter (caddow, astro-editorial…),
 * to tell which leftover word was the starter's.
 *
 * @param {string[]} argv
 * @param {NodeJS.ProcessEnv} env
 * @param {string[]} starters
 * @returns {string[]}
 */
export function galleyArguments(argv, env, starters) {
  const args = argv.filter((arg) => arg !== "--");
  const byNpm = /^npm\//.test(env.npm_config_user_agent || "");

  if (!byNpm) return ["new", ...args];
  const has = (/** @type {string} */ option) => args.some((arg) => arg === option || arg.startsWith(`${option}=`));
  const extra = [];
  const kept = env.npm_config_starter;

  if (!has("--starter") && kept !== undefined && kept !== "") {
    if (kept !== "true") {
      // --starter=caddow keeps its value.
      extra.push("--starter", kept);
    } else {
      const words = positionals(args);
      const known = new Set(starters.map((name) => name.toLowerCase()));
      const starter = words.find((word) => known.has(word.toLowerCase())) ?? (words.length > 1 ? words[words.length - 1] : words[0]);

      if (starter !== undefined) {
        args.splice(args.indexOf(starter), 1);
        extra.push("--starter", starter);
      }
    }
  }
  for (const name of ["open", "install", "start"]) {
    const value = env[`npm_config_${name}`];

    if ((value === "" || value === "false") && !has(`--no-${name}`)) extra.push(`--no-${name}`);
  }
  return ["new", ...args, ...extra];
}

/**
 * Where galley-cms is, and the names its starters answer to.
 *
 * @param {string} from a file inside create-galley
 * @returns {{ bin: string; starters: string[] } | null}
 */
export function findGalley(from) {
  let root;

  try {
    root = dirname(createRequire(from).resolve("galley-cms/package.json"));
  } catch {
    return null;
  }
  /** @type {string[]} */
  const starters = [];
  const dir = join(root, "dist", "starters");

  try {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      starters.push(entry.name);
      try {
        const manifest = JSON.parse(readFileSync(join(dir, entry.name, "starter.json"), "utf8"));

        if (typeof manifest.short === "string") starters.push(manifest.short);
      } catch {
        // A starter without a manifest still answers to its folder.
      }
    }
  } catch {
    // Not built (inside the repository): no names to recognise, which only matters for npm's leftovers.
  }
  return { bin: join(root, "bin", "galley.js"), starters };
}

export const USAGE = `Usage: npm create galley@latest [name] -- [options]
       pnpm create galley [name] [options]   (also yarn create, bun create)

Makes a new site from one of Galley's starters, installs it and opens Galley
on it. The options are those of \`galley new\`:`;

export const MISSING_GALLEY =
  "create-galley couldn't find Galley itself (the galley-cms package that should be installed with it). Run the same command again; if it still says this, run `npx galley-cms new` instead.";
