// `pnpm --filter @galley/web build:demo` — builds the in-browser demo into
// packages/web/demo/dist (served at /demo/). Three steps:
//
//   1. The sample site: starters/astro-editorial built with Astro under
//      /demo/site/, its photographs resized for the preview, each page given
//      the demo's frame script and noindex, and the files the demo never
//      shows (markdown twins, llms.txt, sitemap) left out. Plus the real
//      overlay at site/__galley/overlay.js, as the preview proxy serves it.
//   2. The frame script (demo/frame), one small file at site/__demo/frame.js.
//   3. The app itself, with vite.demo.config.ts.
//
// demo/scripts/publish.mjs then copies the result into the marketing site.
import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, relative, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const web = fileURLToPath(new URL("../..", import.meta.url));
const repo = join(web, "../..");
const starter = join(repo, "starters/astro-editorial");
const work = join(web, "demo/.work");
const publicDir = join(work, "public");
const site = join(publicDir, "site");
const BASE = "/demo/";
const SITE_BASE = `${BASE}site/`;

/** Photographs are shown in a preview frame, not full screen: this is plenty, and keeps the demo small. */
const IMAGE_BOX = 1000;
const IMAGE_QUALITY = 58;
/** Files of the built site the demo never shows. */
const LEAVE_OUT = [/\.md$/, /^llms(-full)?\.txt$/, /^robots\.txt$/, /^sitemap\.xml$/];

const step = (text) => console.log(`\n▸ ${text}`);

function walk(root) {
  const out = [];
  const visit = (dir) => {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name);
      if (statSync(full).isDirectory()) visit(full);
      else out.push(relative(root, full).split(sep).join("/"));
    }
  };
  visit(root);
  return out.sort();
}

function sizeOf(dir) {
  return walk(dir).reduce((sum, path) => sum + statSync(join(dir, path)).size, 0);
}

const mb = (bytes) => `${(bytes / 1024 / 1024).toFixed(2)} MB`;

/** Step 1: the sample site, its overlay and the pictures the app shows, into demo/.work/public. */
async function buildSampleSite() {
  rmSync(work, { recursive: true, force: true });
  mkdirSync(publicDir, { recursive: true });

  // ── 1. the sample site ─────────────────────────────────────────────────────
  step("Building the sample site (Caddow) under /demo/site/");
  const built = join(work, "astro");
  execFileSync(join(starter, "node_modules/.bin/astro"), ["build", "--base", SITE_BASE, "--site", "https://galley.fictiontribe.com", "--outDir", built], {
    cwd: starter,
    stdio: ["ignore", "ignore", "inherit"],
    env: { ...process.env, ASTRO_TELEMETRY_DISABLED: "1" },
  });

  const requireFromStarter = createRequire(join(starter, "package.json"));
  const sharp = requireFromStarter("sharp");

  for (const path of walk(built)) {
    const name = path.split("/").pop() ?? path;
    if (!path.startsWith("images/") && LEAVE_OUT.some((pattern) => pattern.test(name))) continue;
    const from = join(built, path);
    const to = join(site, path);
    mkdirSync(dirname(to), { recursive: true });
    if (path.startsWith("images/") && /\.(webp|jpe?g|png)$/i.test(path)) {
      const image = sharp(from).resize({ width: IMAGE_BOX, height: IMAGE_BOX, fit: "inside", withoutEnlargement: true });
      await (path.endsWith(".webp") ? image.webp({ quality: IMAGE_QUALITY, effort: 5 }) : image.jpeg({ quality: 70, mozjpeg: true })).toFile(to);
    } else if (path.endsWith(".html")) {
      const html = readFileSync(from, "utf8")
        // The markdown twins and the sitemap aren't part of the demo.
        .replace(/<link rel="alternate" type="text\/markdown"[^>]*>/g, "")
        .replace(/<link rel="sitemap"[^>]*>/g, "")
        .replace(/<link rel="canonical"[^>]*>/g, "")
        .replace(/<meta name="robots"[^>]*>/g, "")
        .replace("</head>", `<meta name="robots" content="noindex, nofollow"><script defer src="${SITE_BASE}__demo/frame.js"></script></head>`);
      writeFileSync(to, html);
    } else copyFileSync(from, to);
  }

  step("Adding the overlay (packages/overlay) at site/__galley/overlay.js");
  const { buildOverlay } = await import(pathToFileURL(join(repo, "packages/overlay/build.mjs")).href);
  const overlay = await buildOverlay();
  mkdirSync(join(site, "__galley"), { recursive: true });
  copyFileSync(overlay, join(site, "__galley/overlay.js"));

  step("Copying the section and template pictures the app shows");
  for (const folder of ["galley/sections", "galley/templates"]) {
    for (const name of readdirSync(join(starter, folder)).filter((file) => file.endsWith(".webp"))) {
      const to = join(publicDir, "repo", folder, name);
      mkdirSync(dirname(to), { recursive: true });
      await sharp(join(starter, folder, name)).resize({ width: 480, withoutEnlargement: true }).webp({ quality: 62 }).toFile(to);
    }
  }
  copyFileSync(join(web, "public/theme.js"), join(publicDir, "theme.js"));
  rmSync(built, { recursive: true, force: true });
}

// `--app-only` rebuilds just the app over the sample site prepared last time (quicker while working on the app).
const appOnly = process.argv.includes("--app-only") && existsSync(join(site, "__demo/frame.js"));
if (!appOnly) await buildSampleSite();

// ── 2. the frame script ────────────────────────────────────────────────────
step("Building the frame script at site/__demo/frame.js");
const { build } = await import("vite");
await build({
  configFile: false,
  logLevel: "warn",
  publicDir: false,
  build: {
    outDir: join(site, "__demo"),
    emptyOutDir: false,
    target: "es2020",
    minify: true,
    lib: { entry: join(web, "demo/frame/main.ts"), formats: ["iife"], name: "galleyDemoFrame", fileName: () => "frame.js" },
  },
});

// ── 3. the app ─────────────────────────────────────────────────────────────
step("Building the app with vite.demo.config.ts");
await build({ configFile: join(web, "vite.demo.config.ts"), logLevel: "warn" });

const dist = join(web, "demo/dist");
if (!existsSync(join(dist, "index.html"))) throw new Error("The demo build wrote no index.html.");
console.log(`\n✓ demo/dist: ${walk(dist).length} files, ${mb(sizeOf(dist))} (the sample site ${mb(sizeOf(join(dist, "site")))})`);
console.log("  Copy it into the marketing site with: pnpm --filter @galley/web demo:publish");

