#!/usr/bin/env node
// Checks the tarballs `npm pack` / `pnpm pack` made, before anything is
// published — the release workflow runs it, and so can anyone:
//
//   node packages/cli/scripts/verify-pack.mjs galley-cms-0.1.0.tgz create-galley-0.1.0.tgz galleycms-0.1.0.tgz
//
// For each tarball: the package.json is publishable (not private, no
// `workspace:` ranges, no install scripts, the fields npm shows); nothing is
// inside that shouldn't be public (tests, source maps, .env files, logs,
// native binaries, paths from the machine that built it, anything shaped
// like a key); the size is within its limit; and galley-cms carries every
// part it runs from and starts. Exits 1 with every problem listed.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { basename, dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const MB = 1024 * 1024;
/** Packed size limits. Above galley-cms's, starters should be fetched from the release instead of bundled (RELEASING.md). */
const LIMITS = { "galley-cms": Number(process.env.GALLEY_PACK_LIMIT_MB || 15) * MB, "create-galley": 64 * 1024, galleycms: 64 * 1024 };
const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
/** Every starter in the repository, and whether it is downloaded when used ("download": true) instead of bundled. */
const STARTERS = readdirSync(join(REPO, "starters"), { withFileTypes: true })
  .filter((entry) => entry.isDirectory() && existsSync(join(REPO, "starters", entry.name, "package.json")))
  .map((entry) => entry.name)
  .sort();
const DOWNLOADED = new Set(STARTERS.filter((id) => JSON.parse(readFileSync(join(REPO, "starters", id, "starter.json"), "utf8")).download === true));
/** Where build.mjs put the downloaded starters' archives, the release's assets. */
const ASSETS = resolve(process.env.GALLEY_STARTER_ASSETS || join(REPO, "packages", "cli", "starter-assets"));

const FORBIDDEN_FILES = [
  [/(^|\/)(test|tests|__tests__)\//, "a test folder"],
  [/\.(test|spec)\.[cm]?[jt]sx?$/, "a test file"],
  [/\.map$/, "a source map"],
  [/(^|\/)\.env(\..*)?$/, "an .env file"],
  [/(^|\/)node_modules\//, "installed packages"],
  [/(^|\/)\.git\//, "git history"],
  [/(^|\/)\.DS_Store$/, "macOS litter"],
  [/\.log$/, "a log"],
  [/\.tsbuildinfo$/, "TypeScript build state"],
  [/\.node$|(^|\/)binding\.gyp$/, "a native module"],
  [/(^|\/)(package-lock\.json|pnpm-lock\.yaml|yarn\.lock|bun\.lockb?)$/, "a lockfile"],
];
const SECRETS = [
  [/sk-ant-[A-Za-z0-9_-]{20,}/, "an Anthropic key"],
  [/sk-[A-Za-z0-9]{32,}/, "an API key"],
  [/AKIA[0-9A-Z]{16}/, "an AWS key"],
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----/, "a private key"],
  [/gh[pousr]_[A-Za-z0-9]{36}/, "a GitHub token"],
  [/npm_[A-Za-z0-9]{36}/, "an npm token"],
  [/xox[abposr]-[A-Za-z0-9-]{10,}/, "a Slack token"],
];
/** Paths that only exist on the machine that built the package. */
const LOCAL_PATHS = [
  [new RegExp(REPO.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")), "this checkout's path"],
  [new RegExp(homedir().replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "[\\\\/]"), "the builder's home folder"],
  [/\/Users\/[A-Za-z0-9._-]+\/(?:Desktop|Documents|Projects|Library|Developer|src|code|dev|work|repos|git)\//, "a macOS home folder"],
  [/\/home\/(?!runner\/work\b)[a-z][a-z0-9._-]*\/(?:Desktop|Projects|src|work|code|dev)\//, "a Linux home folder"],
  [/\/home\/runner\/work\//, "a CI runner's folder"],
  [/[A-Z]:\\\\Users\\\\[A-Za-z0-9._-]+\\\\/, "a Windows home folder"],
  [/\/private\/var\/folders\//, "a macOS temporary folder"],
];
const BINARY = /\.(png|jpe?g|webp|avif|gif|ico|woff2?|ttf|otf|eot|mp4|webm|mp3|wav|pdf|zip|gz|wasm)$/i;
const INSTALL_SCRIPTS = ["preinstall", "install", "postinstall"];

function walk(dir, base = dir, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);

    if (entry.isDirectory()) walk(path, base, out);
    else out.push(relative(base, path).split("\\").join("/"));
  }
  return out;
}

function size(bytes) {
  return bytes >= MB ? `${(bytes / MB).toFixed(1)} MB` : `${(bytes / 1024).toFixed(1)} kB`;
}

function checkManifest(pkg, problems) {
  if (pkg.private) problems.push("package.json says private: true");
  for (const field of ["name", "version", "description", "license", "repository", "homepage", "bin", "engines", "files"]) {
    if (pkg[field] === undefined) problems.push(`package.json has no ${field}`);
  }
  if (pkg.publishConfig?.provenance !== true) problems.push("package.json's publishConfig doesn't ask for provenance");
  if (pkg.publishConfig?.access !== "public") problems.push("package.json's publishConfig isn't access: public");
  for (const field of ["dependencies", "optionalDependencies", "peerDependencies"]) {
    for (const [name, range] of Object.entries(pkg[field] ?? {})) {
      if (String(range).startsWith("workspace:") || String(range).startsWith("file:") || String(range).startsWith("link:")) problems.push(`${field}.${name} is “${range}”, which only works inside the repository`);
      if (name.startsWith("@galley/")) problems.push(`${field}.${name} is an unpublished workspace package`);
    }
  }
  for (const script of INSTALL_SCRIPTS) if (pkg.scripts?.[script]) problems.push(`package.json has an install script (${script})`);
}

function verify(tarball) {
  const problems = [];
  const notes = [];
  const work = mkdtempSync(join(tmpdir(), "galley-verify-"));

  try {
    execFileSync("tar", ["-xzf", tarball, "-C", work]);
    const root = join(work, "package");
    const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
    const files = walk(root);
    const packed = statSync(tarball).size;
    const unpacked = files.reduce((sum, file) => sum + statSync(join(root, file)).size, 0);
    const limit = LIMITS[pkg.name];

    if (limit === undefined) problems.push(`${pkg.name} isn't one of the packages this project publishes`);
    checkManifest(pkg, problems);
    notes.push(`${files.length} files, ${size(packed)} packed, ${size(unpacked)} unpacked`);
    if (limit !== undefined && packed > limit) problems.push(`the tarball is ${size(packed)}, over its ${size(limit)} limit`);

    for (const file of files) {
      for (const [pattern, what] of FORBIDDEN_FILES) if (pattern.test(file)) problems.push(`${file} is ${what}`);
      if (BINARY.test(file)) continue;
      const text = readFileSync(join(root, file), "utf8");

      for (const [pattern, what] of [...SECRETS, ...LOCAL_PATHS]) {
        const match = pattern.exec(text);

        if (match) problems.push(`${file} contains ${what}: “${text.slice(Math.max(0, match.index - 30), match.index + match[0].length + 30).replace(/\s+/g, " ")}”`);
      }
    }

    if (pkg.name === "galley-cms") {
      if (Object.keys(pkg.dependencies ?? {}).length) problems.push(`galley-cms has runtime dependencies (${Object.keys(pkg.dependencies).join(", ")}); everything it needs is in the bundle`);
      for (const file of ["bin/galley.js", "dist/galley.mjs", "dist/web/index.html", "dist/overlay.js", "dist/LICENSE", "dist/NOTICE"]) {
        if (!files.includes(file)) problems.push(`${file} is missing`);
      }
      for (const id of STARTERS) {
        const expected = DOWNLOADED.has(id) ? ["package.json", "starter.json", "galley.config.json", "starter-download.json"] : ["package.json", "starter.json", "galley.config.json", "gitignore", "src/content.config.ts"];

        for (const file of expected) {
          if (!files.includes(`dist/starters/${id}/${file}`)) problems.push(`dist/starters/${id}/${file} is missing`);
        }
        if (DOWNLOADED.has(id) && files.includes(`dist/starters/${id}/starter-download.json`)) {
          // The archive the release attaches must be the one the bundle names, byte for byte.
          const record = JSON.parse(readFileSync(join(root, "dist/starters", id, "starter-download.json"), "utf8"));
          const asset = join(ASSETS, String(record.asset));

          if (record.asset !== `starters-${id}.tgz`) problems.push(`dist/starters/${id}/starter-download.json names ${record.asset}, not starters-${id}.tgz`);
          else if (!existsSync(asset)) problems.push(`${record.asset}, the archive dist/starters/${id} names, isn't in ${ASSETS}`);
          else {
            const bytes = readFileSync(asset);
            const hash = createHash("sha256").update(bytes).digest("hex");

            if (bytes.length !== record.bytes || hash !== record.sha256) problems.push(`${record.asset} isn't the archive dist/starters/${id} records (${bytes.length} bytes, ${hash})`);
            else notes.push(`${record.asset}: ${size(bytes.length)}, downloaded when used, sha256 ${hash.slice(0, 12)}…`);
          }
          if (files.some((file) => file.startsWith(`dist/starters/${id}/src/`))) problems.push(`dist/starters/${id} is downloaded when used, but its files are in the package too`);
        }
        const manifest = files.includes(`dist/starters/${id}/starter.json`) ? JSON.parse(readFileSync(join(root, "dist/starters", id, "starter.json"), "utf8")) : {};

        if (!manifest.short) problems.push(`dist/starters/${id}/starter.json has no short name`);
        const starterPkg = files.includes(`dist/starters/${id}/package.json`) ? readFileSync(join(root, "dist/starters", id, "package.json"), "utf8") : "";

        if (/workspace:/.test(starterPkg)) problems.push(`dist/starters/${id}/package.json has a workspace: range`);
      }
      // Native code can't be bundled: nothing that loads it may be inside.
      const bundle = readFileSync(join(root, "dist/galley.mjs"), "utf8");

      for (const name of ["sharp", "fsevents", "node-gyp-build", "bindings", "prebuild-install"]) {
        if (new RegExp(`(?:import|require)\\(\\s*["']${name}["']`).test(bundle)) problems.push(`dist/galley.mjs loads ${name}, a native module`);
      }
      const starterSizes = STARTERS.map((id) => `${id} ${size(files.filter((file) => file.startsWith(`dist/starters/${id}/`)).reduce((sum, file) => sum + statSync(join(root, file)).size, 0))}`);

      notes.push(`bundle ${size(statSync(join(root, "dist/galley.mjs")).size)}; web UI ${size(files.filter((file) => file.startsWith("dist/web/")).reduce((sum, file) => sum + statSync(join(root, file)).size, 0))}; starters: ${starterSizes.join(", ")}`);
      // It starts, from the tarball, with nothing installed beside it: an ES
      // module's static imports are all resolved before any code runs, so a
      // start here proves the bundle needs no package that isn't in it.
      try {
        const version = execFileSync(process.execPath, [join(root, "bin/galley.js"), "version", "--json"], { encoding: "utf8", env: { PATH: process.env.PATH ?? "", HOME: work } });

        if (JSON.parse(version).version !== pkg.version) problems.push(`galley version says ${JSON.parse(version).version}, package.json ${pkg.version}`);
        const starters = JSON.parse(execFileSync(process.execPath, [join(root, "bin/galley.js"), "starters", "--json"], { encoding: "utf8", env: { PATH: process.env.PATH ?? "", HOME: work } }));

        notes.push(`starts: galley ${pkg.version}, starters ${starters.map((starter) => starter.short).join(", ")}`);
        if (starters.length !== STARTERS.length) problems.push(`galley starters lists ${starters.length} starters, not ${STARTERS.length}`);
      } catch (error) {
        problems.push(`the packed galley doesn't start: ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    if (pkg.name === "create-galley" || pkg.name === "galleycms") {
      const deps = Object.entries(pkg.dependencies ?? {});
      const binFile = pkg.name === "create-galley" ? "bin/create-galley.js" : "bin/galleycms.js";

      if (deps.length !== 1 || deps[0][0] !== "galley-cms") problems.push(`${pkg.name} should depend on galley-cms alone, not ${deps.map(([name]) => name).join(", ") || "nothing"}`);
      else if (deps[0][1] !== pkg.version) problems.push(`${pkg.name} ${pkg.version} depends on galley-cms “${deps[0][1]}”; it should be exactly ${pkg.version}`);
      for (const file of [binFile, "index.js", "LICENSE", "README.md"]) if (!files.includes(file)) problems.push(`${file} is missing`);
    }
    return { name: `${pkg.name}@${pkg.version}`, problems, notes };
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

const tarballs = process.argv.slice(2);

if (tarballs.length === 0) {
  console.error("Usage: node packages/cli/scripts/verify-pack.mjs <tarball>…");
  process.exit(2);
}
let failed = false;

for (const tarball of tarballs) {
  const { name, problems, notes } = verify(resolve(tarball));

  console.log(`${problems.length ? "✗" : "✓"} ${name} (${basename(tarball)})`);
  for (const note of notes) console.log(`  ${note}`);
  for (const problem of problems) console.log(`  ! ${problem}`);
  failed ||= problems.length > 0;
}
process.exit(failed ? 1 : 0);
