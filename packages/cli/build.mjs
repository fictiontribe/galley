// Bundles CLI + server + engine into one ESM file, dist/galley.mjs, with the
// web UI, the starters and the overlay script beside it, so the result runs
// from any directory with plain `node dist/galley.mjs`. The site kit's files
// (for "Set it up for me") are embedded in the bundle, like the overlay.
//
// GALLEY_CLI_DIST=<dir> writes the bundle somewhere else (the bundle test
// builds into a temporary folder, so a dist/ that bin/galley.js would prefer
// over the sources is never left behind); the starters' archives then go
// beside it, in <dir>-starter-assets. GALLEY_CLI_STARTERS=<dir> takes the
// starters from another folder (a test's).
//
//   node build.mjs            the bundle, with the web UI if it has been built
//   node build.mjs --release  what `npm pack` ships (prepack): builds the web UI
//                             first and stops if any part is missing
//   node build.mjs --clean    removes dist/ again (postpack), so bin/galley.js
//                             goes back to running the sources
import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { filesUnder, keptFiles, sha256, STARTER_DOWNLOAD, starterArchive, starterAssetName } from "./scripts/starter-archive.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, "..", "..");
const dist = process.env.GALLEY_CLI_DIST ? resolve(process.env.GALLEY_CLI_DIST) : join(here, "dist");
const webPackage = join(repo, "packages", "web");
const webDist = join(webPackage, "dist");
const starters = process.env.GALLEY_CLI_STARTERS ? resolve(process.env.GALLEY_CLI_STARTERS) : join(repo, "starters");
/** The archives of the starters that are downloaded when used: the release's assets, never in the npm package. */
const assets = process.env.GALLEY_CLI_DIST ? `${dist}-starter-assets` : join(here, "starter-assets");
const SKIP = new Set(["node_modules", ".git", "dist", ".astro", ".DS_Store"]);
/** Never shipped inside a starter, whatever git or the folder holds. */
const NEVER = [/(^|\/)\.env(\..*)?$/, /\.log$/, /(^|\/)(package-lock\.json|pnpm-lock\.yaml|yarn\.lock|bun\.lockb?)$/, /\.map$/];
const release = process.argv.includes("--release");

rmSync(dist, { recursive: true, force: true });
if (process.argv.includes("--clean")) process.exit(0);
mkdirSync(dist, { recursive: true });

function fail(message) {
  console.error(`✗ ${message}`);
  process.exit(1);
}

if (release) {
  // The web UI is its own package; build it with its own Vite, so packing needs nothing installed globally.
  const viteRoot = dirname(createRequire(join(webPackage, "package.json")).resolve("vite/package.json"));
  const viteBin = JSON.parse(readFileSync(join(viteRoot, "package.json"), "utf8")).bin;

  execFileSync(process.execPath, [join(viteRoot, typeof viteBin === "string" ? viteBin : viteBin.vite), "build", "--logLevel", "warn"], { cwd: webPackage, stdio: "inherit" });
}

const { build } = await import("esbuild");

// The overlay is produced by its own package; run its real entry (through tsx) and embed the result.
const overlay = execFileSync(
  process.execPath,
  ["--import", "tsx", "--input-type=module", "-e", "const m = await import('@galley/overlay'); process.stdout.write(await m.overlaySource());"],
  { cwd: join(repo, "packages", "server"), encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }
);

const embedOverlay = {
  name: "embed-overlay",
  setup(context) {
    context.onResolve({ filter: /^@galley\/overlay$/ }, () => ({ path: "overlay", namespace: "galley-embedded" }));
    context.onLoad({ filter: /.*/, namespace: "galley-embedded" }, () => ({
      contents: `export async function overlaySource() { return ${JSON.stringify(overlay)}; }`,
      loader: "js",
    }));
  },
};

// The site kit, as its own vendoring script reads it today. The engine's
// site-kit/source.ts loads it from packages/astro at run time; in the bundle
// that module is replaced by the files themselves, so every shell that runs
// this bundle (npm, the desktop sidecar, the Docker image) has them.
const { kitBundle } = await import(pathToFileURL(join(repo, "packages", "astro", "scripts", "vendor.mjs")).href);
const kit = kitBundle();

const embedKit = {
  name: "embed-site-kit",
  setup(context) {
    context.onLoad({ filter: /[\\/]core[\\/]src[\\/]site-kit[\\/]source\.ts$/ }, () => ({
      contents: `export function loadKitBundle() { return Promise.resolve(${JSON.stringify(kit)}); }`,
      loader: "js",
    }));
  },
};

await build({
  entryPoints: [join(here, "src", "bin.ts")],
  outfile: join(dist, "galley.mjs"),
  bundle: true,
  platform: "node",
  target: "node20",
  format: "esm",
  sourcemap: false,
  legalComments: "none",
  // Native modules can't be bundled; the engine loads them lazily when present.
  external: ["sharp", "fsevents"],
  define: { __GALLEY_BUNDLED__: "true" },
  banner: {
    js: [
      "#!/usr/bin/env node",
      // Some bundled CommonJS dependencies call require() for Node built-ins.
      'import { createRequire as __galleyCreateRequire } from "node:module";',
      "const require = __galleyCreateRequire(import.meta.url);",
    ].join("\n"),
  },
  plugins: [embedOverlay, embedKit],
  logLevel: "warning",
});

if (existsSync(join(webDist, "index.html"))) {
  cpSync(webDist, join(dist, "web"), { recursive: true, filter: (source) => !source.endsWith(".map") });
} else if (release) {
  fail("The web UI didn't build, so there is nothing to pack.");
} else {
  console.warn("! The web UI isn't built, so the bundle will show the “not built” page. Run `pnpm --filter @galley/web build` first.");
}

// The starters as git has them — never what happens to be lying in the
// folders (an .env, a build, a log). Outside a git checkout, the folder
// minus what is never shipped.
let tracked = null;

try {
  tracked = execFileSync("git", ["ls-files", "-z", "--", "."], { cwd: starters, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] })
    .split("\0")
    .filter(Boolean);
} catch {
  if (release) fail("Packing needs a git checkout: the starters are copied as git has them.");
}
if (tracked) {
  for (const file of tracked) {
    if (NEVER.some((pattern) => pattern.test(file)) || !existsSync(join(starters, file))) continue;
    mkdirSync(dirname(join(dist, "starters", file)), { recursive: true });
    cpSync(join(starters, file), join(dist, "starters", file));
  }
} else {
  cpSync(starters, join(dist, "starters"), {
    recursive: true,
    filter: (source) => !SKIP.has(basename(source)) && !NEVER.some((pattern) => pattern.test(source)),
  });
}
if (release) {
  for (const id of readdirSync(join(dist, "starters"), { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => entry.name)) {
    for (const file of ["package.json", "starter.json", "galley.config.json"]) {
      if (!existsSync(join(dist, "starters", id, file))) fail(`starters/${id} has no ${file}.`);
    }
  }
}
// npm never packs a file named .gitignore, so a starter's travels as
// "gitignore" and scaffolding puts the dot back. Without it a new site's
// first version would take in node_modules.
(function renameGitignores(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);

    if (entry.isDirectory()) renameGitignores(path);
    else if (entry.name === ".gitignore") renameSync(path, join(dir, "gitignore"));
  }
})(join(dist, "starters"));

// A starter whose starter.json says "download": true doesn't travel inside the package: its archive goes to
// starter-assets/ (attached to the release by release.yml), and the bundle keeps only what shows the starter in the
// wizard and in `galley starters`, with a record of the archive — its name, size and SHA-256, checked after
// download — and the counts `galley starters` would otherwise read from the files (RELEASING.md, "How the starters
// travel").
rmSync(assets, { recursive: true, force: true });
// Which starter files are programs, as git records it: the same on every system, so the archive is too.
let programs = null;

try {
  programs = new Set(
    execFileSync("git", ["ls-files", "-s", "-z", "--", "."], { cwd: starters, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] })
      .split("\0")
      .filter((line) => line.startsWith("100755 "))
      .map((line) => line.slice(line.indexOf("\t") + 1))
  );
} catch {
  programs = null;
}
for (const id of readdirSync(join(dist, "starters"), { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => entry.name)) {
  const dir = join(dist, "starters", id);
  const manifestFile = join(dir, "starter.json");

  if (!existsSync(manifestFile)) continue;
  const manifest = JSON.parse(readFileSync(manifestFile, "utf8"));

  if (manifest.download !== true) continue;
  const files = filesUnder(dir);
  const archive = starterArchive(dir, programs ? (rel) => programs.has(`${id}/${rel}`) : undefined);
  const count = (folder, ending) => files.filter((file) => file.startsWith(`${folder}/`) && !file.slice(folder.length + 1).includes("/") && file.endsWith(ending)).length;
  const kept = keptFiles(manifest);

  mkdirSync(assets, { recursive: true });
  writeFileSync(join(assets, starterAssetName(id)), archive);
  for (const file of files) if (!kept.has(file)) rmSync(join(dir, ...file.split("/")));
  (function pruneEmpty(folder) {
    for (const entry of readdirSync(folder, { withFileTypes: true })) if (entry.isDirectory()) pruneEmpty(join(folder, entry.name));
    if (folder !== dir && readdirSync(folder).length === 0) rmSync(folder, { recursive: true });
  })(dir);
  const record = { asset: starterAssetName(id), bytes: archive.length, sha256: sha256(archive), sections: count("galley/sections", ".webp"), templates: count("galley/templates", ".md") };

  writeFileSync(join(dir, STARTER_DOWNLOAD), `${JSON.stringify(record, null, 2)}\n`);
  console.log(`✓ starters/${id} travels as ${record.asset} (${(archive.length / (1024 * 1024)).toFixed(1)} MB), downloaded when a site is made from it`);
}

writeFileSync(join(dist, "overlay.js"), overlay);
// Apache-2.0 travels with every copy; npm only picks up a LICENSE at the package root, which is the repository's.
for (const file of ["LICENSE", "NOTICE"]) cpSync(join(repo, file), join(dist, file));
const size = (statSync(join(dist, "galley.mjs")).size / (1024 * 1024)).toFixed(1);

console.log(`✓ dist/galley.mjs (${size} MB, site kit ${kit.version} embedded), starters${existsSync(join(dist, "web")) ? ", web UI" : ""} and overlay copied`);
