// Bundles CLI + server + engine into one ESM file, dist/galley.mjs, with the
// web UI, the starters and the overlay script beside it, so the result runs
// from any directory with plain `node dist/galley.mjs`. The site kit's files
// (for "Set it up for me") are embedded in the bundle, like the overlay.
//
// GALLEY_CLI_DIST=<dir> writes the bundle somewhere else (the bundle test
// builds into a temporary folder, so a dist/ that bin/galley.js would prefer
// over the sources is never left behind).
import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, "..", "..");
const dist = process.env.GALLEY_CLI_DIST ? resolve(process.env.GALLEY_CLI_DIST) : join(here, "dist");
const webDist = join(repo, "packages", "web", "dist");
const starters = join(repo, "starters");
const SKIP = new Set(["node_modules", ".git", "dist", ".astro", ".DS_Store"]);

rmSync(dist, { recursive: true, force: true });
mkdirSync(dist, { recursive: true });

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
  cpSync(webDist, join(dist, "web"), { recursive: true });
} else {
  console.warn("! The web UI isn't built, so the bundle will show the “not built” page. Run `pnpm --filter @galley/web build` first.");
}

cpSync(starters, join(dist, "starters"), {
  recursive: true,
  filter: (source) => !SKIP.has(basename(source)),
});
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

writeFileSync(join(dist, "overlay.js"), overlay);
// Apache-2.0 travels with every copy; npm only picks up a LICENSE at the package root, which is the repository's.
for (const file of ["LICENSE", "NOTICE"]) cpSync(join(repo, file), join(dist, file));
const size = (statSync(join(dist, "galley.mjs")).size / (1024 * 1024)).toFixed(1);

console.log(`✓ dist/galley.mjs (${size} MB, site kit ${kit.version} embedded), starters${existsSync(join(dist, "web")) ? ", web UI" : ""} and overlay copied`);
