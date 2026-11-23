#!/usr/bin/env node
// Writes the exact tree of a starter's public template repository:
//
//   node scripts/export-starter.mjs [starter] [targetDir] [--repo owner/name]
//   node scripts/export-starter.mjs --list
//
// `starter` is a folder under starters/ (default astro-starter); `targetDir`
// defaults to /tmp/<package name>. The tree is:
//
// - the starter, without anything installed or built (node_modules, dist,
//   .astro, lockfiles, logs, .env files) and without starter-notice.json;
// - its vendored site kit (src/galley/), checked against the kit in
//   packages/astro — a stale copy fails the export, so what ships is what
//   was built and tested (run `node packages/astro/scripts/vendor.mjs
//   starters/<starter>` to refresh it);
// - the files only a template repository has, from
//   docs/astro-catalog/template/ (the GitHub Pages workflow, issue templates,
//   editor recommendations), with the repository's name filled in;
// - the demo notice, from the starter's starter-notice.json, added to
//   src/data/site.json as `starterNotice` (the copy inside this repository,
//   which `galley new` uses, has no notice);
// - package.json checked for anything that only works inside this monorepo;
// - a LICENSE (required) and the README, whose deploy buttons and
//   `create astro` commands name the repository (docs/deploy.md, "The hosts'
//   own one-click buttons").
//
// The output is deterministic: the same sources give byte-identical trees.
// Re-running into a previous export (or a clone of the template repository)
// replaces everything except `.git` and `node_modules`, so the next step is a
// plain commit.
//
// A starter's repository is fictiontribe/<package name> unless `--repo` or
// the STARTER_REPOSITORY environment variable says otherwise; every mention
// of the default (README, notice, workflow) is rewritten to it.

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseArgs } from "node:util";

const OWNER = "fictiontribe";
const DEFAULT_STARTER = "astro-starter";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const STARTERS = join(ROOT, "starters");
const OVERLAY = join(ROOT, "docs/astro-catalog/template");
const VENDOR = join(ROOT, "packages/astro/scripts/vendor.mjs");
/** Written in the overlay where the repository's owner/name goes. */
const REPOSITORY_TOKEN = "__REPOSITORY__";

/** Never exported: installed or built output, local state, and lockfiles (each package manager writes its own). */
const SKIP_NAMES = new Set([
  "node_modules",
  "dist",
  ".astro",
  ".vite",
  ".netlify",
  ".vercel",
  ".wrangler",
  ".DS_Store",
  ".idea",
  "package-lock.json",
  "npm-shrinkwrap.json",
  "pnpm-lock.yaml",
  "yarn.lock",
  "bun.lock",
  "bun.lockb",
]);
const SKIP_PATTERNS = [/\.log$/, /^\.env(\..*)?$/, /\.tsbuildinfo$/];
/** Only meaningful inside this repository; merged into site.json instead. */
const STARTER_ONLY = new Set(["starter-notice.json"]);
/** package.json fields that only mean something to pnpm or this workspace. */
const MONOREPO_FIELDS = ["packageManager", "pnpm", "workspaces", "publishConfig"];
const TEXT = /\.(md|mdx|json|jsonc|ya?ml|toml|ts|mts|js|mjs|astro|css|svg|txt|html)$|^(LICENSE|\.gitignore)$/;

function fail(message) {
  console.error(`export-starter: ${message}`);
  process.exit(1);
}

const starters = () =>
  readdirSync(STARTERS)
    .filter((name) => existsSync(join(STARTERS, name, "package.json")))
    .sort();

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: { repo: { type: "string" }, list: { type: "boolean" }, help: { type: "boolean", short: "h" } },
});

if (values.help) {
  console.log("Usage: node scripts/export-starter.mjs [starter] [targetDir] [--repo owner/name]");
  console.log("       node scripts/export-starter.mjs --list\n");
  console.log(`Writes a starter's template repository to targetDir (default /tmp/<package name>).`);
  console.log(`Starters: ${starters().join(", ")} (default ${DEFAULT_STARTER}).`);
  process.exit(0);
}

if (values.list) {
  for (const name of starters()) {
    const pkg = JSON.parse(readFileSync(join(STARTERS, name, "package.json"), "utf8"));
    console.log(`${name.padEnd(20)} ${pkg.name.padEnd(26)} ${OWNER}/${pkg.name}`);
  }
  process.exit(0);
}

// The first argument is a starter when it names one; otherwise it is the
// target folder (the older one-starter form: export-starter.mjs [targetDir]).
const args = [...positionals];
const starterName = args.length > 0 && starters().includes(args[0]) ? args.shift() : DEFAULT_STARTER;
if (args.length > 1) fail(`too many arguments. Usage: node scripts/export-starter.mjs [starter] [targetDir] [--repo owner/name]`);
const STARTER = join(STARTERS, starterName);
if (!existsSync(join(STARTER, "package.json"))) fail(`no starter at ${STARTER}.`);

const sourcePkg = JSON.parse(readFileSync(join(STARTER, "package.json"), "utf8"));
const PACKAGE_NAME = sourcePkg.name;
if (typeof PACKAGE_NAME !== "string" || !/^[a-z0-9][a-z0-9-]*$/.test(PACKAGE_NAME)) fail(`starters/${starterName}/package.json needs a plain lowercase name.`);
const DEFAULT_REPOSITORY = `${OWNER}/${PACKAGE_NAME}`;
const repository = values.repo ?? process.env.STARTER_REPOSITORY ?? DEFAULT_REPOSITORY;
if (!/^[\w.-]+\/[\w.-]+$/.test(repository)) fail(`“${repository}” isn't an owner/name pair, like ${DEFAULT_REPOSITORY}.`);
const target = resolve(args[0] ?? `/tmp/${PACKAGE_NAME}`);

// ── Collect ────────────────────────────────────────────────────────────────

/** @type {Map<string, Buffer>} repo-relative POSIX path → contents */
const files = new Map();

function skipped(name) {
  return SKIP_NAMES.has(name) || SKIP_PATTERNS.some((pattern) => pattern.test(name));
}

function collect(from, into = "") {
  for (const name of readdirSync(from).sort()) {
    if (skipped(name)) continue;
    const path = join(from, name);
    const key = into ? `${into}/${name}` : name;
    const info = statSync(path);

    if (info.isDirectory()) collect(path, key);
    else if (info.isFile()) files.set(key, readFileSync(path));
  }
}

collect(STARTER);
for (const name of STARTER_ONLY) files.delete(name);
const fromStarter = new Set(files.keys());
collect(OVERLAY);
for (const key of fromStarter) {
  if (existsSync(join(OVERLAY, ...key.split("/")))) {
    fail(`${key} is in both the starter and docs/astro-catalog/template; keep it in one place.`);
  }
}

for (const required of ["LICENSE", "README.md", ".gitignore"]) {
  if (!files.has(required)) fail(`starters/${starterName} has no ${required}; a template repository needs one.`);
}

// ── The vendored site kit: present and current, or absent ─────────────────

const kitFiles = [...files.keys()].filter((key) => key.startsWith("src/galley/"));
if (kitFiles.length > 0) {
  const { vendoredFiles } = await import(pathToFileURL(VENDOR).href);
  const expected = vendoredFiles();
  const stale = [];

  for (const [file, text] of Object.entries(expected)) {
    const have = files.get(`src/galley/${file}`);
    if (!have || have.toString("utf8") !== text) stale.push(file);
  }
  for (const key of kitFiles) {
    const file = key.slice("src/galley/".length);
    if (file !== "settings.json" && !(file in expected)) stale.push(`${file} (no longer in the kit)`);
  }
  if (!files.has("src/galley/settings.json")) stale.push("settings.json (missing)");
  if (stale.length > 0) {
    fail(
      `the site kit in starters/${starterName}/src/galley is out of date (${stale.slice(0, 4).join(", ")}${stale.length > 4 ? `, and ${stale.length - 4} more` : ""}).\n` +
        `  Refresh it, rebuild and check the starter, then export again:\n    node packages/astro/scripts/vendor.mjs starters/${starterName}`,
    );
  }
}

// ── package.json: nothing that only resolves inside the monorepo ──────────

const pkg = JSON.parse(files.get("package.json").toString("utf8"));

for (const field of MONOREPO_FIELDS) delete pkg[field];
for (const group of ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"]) {
  for (const [name, range] of Object.entries(pkg[group] ?? {})) {
    if (/^(workspace|link|file|portal|catalog):/.test(String(range))) {
      fail(`package.json ${group}.${name} is “${range}”, which only resolves inside this repository. Use a published version range.`);
    }
  }
}
for (const hook of ["preinstall", "install", "postinstall", "prepare"]) {
  if (pkg.scripts?.[hook]) fail(`package.json has a “${hook}” script; a template must install without running scripts.`);
}
files.set("package.json", Buffer.from(`${JSON.stringify(pkg, null, 2)}\n`));

// ── The demo notice ────────────────────────────────────────────────────────

const noticeFile = join(STARTER, "starter-notice.json");
let noticeApplied = false;

if (existsSync(noticeFile) && files.has("src/data/site.json")) {
  const site = JSON.parse(files.get("src/data/site.json").toString("utf8"));
  const notice = JSON.parse(readFileSync(noticeFile, "utf8"));
  const withNotice = {};

  // After footerText, so it reads beside the other site-wide text.
  for (const [key, value] of Object.entries(site)) {
    if (key === "starterNotice") continue;
    withNotice[key] = value;
    if (key === "footerText") withNotice.starterNotice = notice;
  }
  if (!("starterNotice" in withNotice)) withNotice.starterNotice = notice;
  files.set("src/data/site.json", Buffer.from(`${JSON.stringify(withNotice, null, 2)}\n`));
  noticeApplied = true;
}

// ── The repository's name, wherever it is written ─────────────────────────

/** owner/name → the GitHub Pages address of that repository. */
const pagesUrl = (ownerName) => {
  const [owner, name] = ownerName.split("/");
  return `https://${owner.toLowerCase()}.github.io/${name}/`;
};

const swaps = [[REPOSITORY_TOKEN, repository]];
if (repository !== DEFAULT_REPOSITORY) {
  swaps.push(
    [pagesUrl(DEFAULT_REPOSITORY), pagesUrl(repository)],
    // The Vercel button carries the repository address URL-encoded.
    [encodeURIComponent(`https://github.com/${DEFAULT_REPOSITORY}`), encodeURIComponent(`https://github.com/${repository}`)],
    [DEFAULT_REPOSITORY, repository],
  );
}

for (const [key, contents] of files) {
  if (!TEXT.test(key.split("/").pop())) continue;
  let text = contents.toString("utf8");
  const before = text;

  for (const [from, to] of swaps) text = text.split(from).join(to);
  if (text !== before) files.set(key, Buffer.from(text));
}

const readme = files.get("README.md").toString("utf8");
const deployButtons = readme.includes("deploy.workers.cloudflare.com/?url=") && readme.includes("vercel.com/new/clone?repository-url=");

// ── Write ──────────────────────────────────────────────────────────────────

if (existsSync(target)) {
  if (!statSync(target).isDirectory()) fail(`${target} is a file.`);
  // A clone keeps its history and its installed packages; everything else is replaced.
  const entries = readdirSync(target).filter((name) => name !== ".git" && name !== "node_modules");
  let previous = null;

  try {
    previous = JSON.parse(readFileSync(join(target, "package.json"), "utf8")).name;
  } catch {}
  if (entries.length > 0 && previous !== PACKAGE_NAME) {
    fail(`${target} already has files that aren't a previous export of ${PACKAGE_NAME}. Choose an empty or new folder.`);
  }
  for (const name of entries) rmSync(join(target, name), { recursive: true, force: true });
}

const keys = [...files.keys()].sort();
const digest = createHash("sha256");

for (const key of keys) {
  const path = join(target, ...key.split("/"));

  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, files.get(key), { mode: 0o644 });
  digest.update(`${key}\0`).update(files.get(key)).update("\0");
}

// ── Report ─────────────────────────────────────────────────────────────────

const size = (bytes) => (bytes < 1024 ? `${bytes} B` : `${(bytes / 1024).toFixed(1)} kB`);
const total = keys.reduce((sum, key) => sum + files.get(key).length, 0);

console.log(`Exported starters/${starterName} (${PACKAGE_NAME}) to ${target}${sep}`);
for (const key of keys) console.log(`  ${key.padEnd(58)} ${size(files.get(key).length).padStart(9)}`);
console.log(`${keys.length} files, ${size(total)} · tree sha256 ${digest.digest("hex").slice(0, 16)}`);
console.log(`  site kit: ${kitFiles.length > 0 ? `vendored, current (${kitFiles.length} files)` : "not used"}`);
console.log(`  demo notice: ${noticeApplied ? "added to src/data/site.json" : "none (no starter-notice.json)"}`);
console.log(`  deploy buttons in README: ${deployButtons ? "yes" : "no — add them (docs/deploy.md, “The hosts' own one-click buttons”)"}`);
console.log(`
Next steps (repository: ${repository})
  1. Create an empty public repository at https://github.com/${repository}
     (no README, licence or .gitignore — the export has them).
  2. Push the export:
       cd ${target}
       git init -b main && git add -A && git commit -m "${PACKAGE_NAME}"
       git remote add origin https://github.com/${repository}.git
       git push -u origin main
  3. Settings › Pages › Build and deployment › Source: GitHub Actions.
     Re-run "Deploy to GitHub Pages" from the Actions tab; the demo appears at
     ${pagesUrl(repository)}
  4. Settings › General › tick "Template repository", so people can press
     "Use this template". Add the description and the topics astro,
     astro-template, galley, cms (Settings › About).
  5. Check: npm create astro@latest -- --template ${repository}
`);
