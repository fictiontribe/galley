#!/usr/bin/env node
// Pictures for the visual page builder, generated from the site itself:
//
//   galley/sections/<type>.webp    every section type alone (640 px wide)
//   galley/templates/<id>.webp     every page template, full page (400 px wide)
//   galley/previews/<look>.webp    the home page in each look (1280 × 800)
//   galley/previews/home.webp      the home page in the default look
//   galley/previews/sections.webp  all section thumbnails on one sheet (README)
//
// It builds the site with the section gallery switched on (SECTION_GALLERY;
// see scripts/gallery/), once per look, serves each build on 127.0.0.1 and
// photographs it with a headless Chromium driven by playwright-core.
//
//   PLAYWRIGHT_MODULES=/path/to/node_modules npm run thumbnails
//   PLAYWRIGHT_MODULES=… npm run thumbnails -- --only sections
//
// playwright-core is not a dependency of this starter: point
// PLAYWRIGHT_MODULES at any node_modules folder that has it (and a Chromium
// it has already downloaded, e.g. `npx playwright install chromium`).
// Options: --only sections|templates|previews, --port <n> (default 4790).

import { spawnSync } from "node:child_process";
import { createServer } from "node:http";
import { existsSync, mkdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
const OUT_BUILD = join(ROOT, "node_modules/.cache/section-gallery");
const { values } = parseArgs({ options: { only: { type: "string" }, port: { type: "string", default: "4790" } } });
const only = values.only;
const port = Number(values.port);

function fail(message) {
  console.error(`make-thumbnails: ${message}`);
  process.exit(1);
}

// ── Tools ─────────────────────────────────────────────────────────────────
const modules = process.env.PLAYWRIGHT_MODULES;
if (!modules) {
  fail(
    "set PLAYWRIGHT_MODULES to a node_modules folder that contains playwright-core, e.g.\n" +
      "  PLAYWRIGHT_MODULES=~/tools/node_modules npm run thumbnails\n" +
      "(install it there with `npm install playwright-core && npx playwright install chromium`).",
  );
}
let chromium;
try {
  ({ chromium } = createRequire(join(resolve(modules), "noop.js"))("playwright-core"));
} catch {
  fail(`no playwright-core in ${modules}. Point PLAYWRIGHT_MODULES at the node_modules folder that has it.`);
}
let sharp;
try {
  sharp = (await import("sharp")).default;
} catch {
  fail("sharp is missing — run `npm install` in this folder first.");
}

const config = JSON.parse(readFileSync(join(ROOT, "galley.config.json"), "utf8"));
const starter = JSON.parse(readFileSync(join(ROOT, "starter.json"), "utf8"));
const blocks = config.collections.find((c) => c.id === "pages").fields.find((f) => f.key === "sections").blocks;
const templates = config.templates ?? [];
const looks = starter.looks ?? [];

// ── Build and serve ───────────────────────────────────────────────────────
function build(look, outDir) {
  rmSync(outDir, { recursive: true, force: true });
  const pkg = join(ROOT, "node_modules/astro/package.json");
  if (!existsSync(pkg)) fail("Astro is not installed — run `npm install` first.");
  const astro = join(ROOT, "node_modules/astro", JSON.parse(readFileSync(pkg, "utf8")).bin.astro);
  const env = { ...process.env, SECTION_GALLERY: "1" };
  if (look) env.SECTION_GALLERY_LOOK = look;
  else delete env.SECTION_GALLERY_LOOK;
  console.log(`Building${look ? ` with the “${look}” look` : ""}…`);
  const result = spawnSync(process.execPath, [astro, "build", "--outDir", outDir], { cwd: ROOT, env, stdio: ["ignore", "ignore", "inherit"] });
  if (result.status !== 0) fail("the build failed (see above).");
}

const TYPES = { ".html": "text/html", ".css": "text/css", ".js": "text/javascript", ".svg": "image/svg+xml", ".png": "image/png", ".webp": "image/webp", ".woff2": "font/woff2" };
async function serve(dir) {
  const server = createServer((req, res) => {
    let file = join(dir, decodeURIComponent(new URL(req.url, "http://localhost").pathname));
    try {
      if (statSync(file).isDirectory()) file = join(file, "index.html");
      res.writeHead(200, { "content-type": TYPES[extname(file)] ?? "application/octet-stream" });
      res.end(readFileSync(file));
    } catch {
      res.writeHead(404);
      res.end();
    }
  });
  await new Promise((done, reject) => server.once("error", reject).listen(port, "127.0.0.1", done));
  return server;
}

// ── Photograph ────────────────────────────────────────────────────────────
async function open(browser, path, viewport) {
  const page = await browser.newPage({ viewport, deviceScaleFactor: 1 });
  await page.goto(`http://127.0.0.1:${port}${path}`, { waitUntil: "networkidle" });
  await page.evaluate(async () => {
    for (const img of document.querySelectorAll('img[loading="lazy"]')) {
      img.loading = "eager";
    }
    await Promise.all(
      [...document.images].map((img) =>
        img.complete ? img.decode().catch(() => {}) : new Promise((ok) => { img.onload = img.onerror = ok; }),
      ),
    );
    await document.fonts.ready;
  });
  await page.waitForTimeout(150);
  return page;
}

async function webp(png, file, { width, maxHeight, quality = 72 }) {
  mkdirSync(join(file, ".."), { recursive: true });
  let image = sharp(png).resize({ width });
  if (maxHeight) {
    const meta = await sharp(await image.toBuffer()).metadata();
    image = sharp(await image.toBuffer()).extract({ left: 0, top: 0, width: meta.width, height: Math.min(meta.height, maxHeight) });
  }
  await image.webp({ quality, effort: 6, smartSubsample: true }).toFile(file);
  const size = statSync(file).size;
  console.log(`  ${file.slice(ROOT.length + 1)}  ${Math.round(size / 1024)} kB`);
}

const browser = await chromium.launch({ headless: true }).catch((error) =>
  fail(`couldn't start Chromium (${error.message.split("\n")[0]}). Run \`npx playwright install chromium\` where PLAYWRIGHT_MODULES points.`),
);
try {
  // The default look: sections, templates and its preview.
  const defaultDir = join(OUT_BUILD, "default");
  build(undefined, defaultDir);
  let server = await serve(defaultDir);
  if (!only || only === "sections") {
    console.log("Sections:");
    for (const block of blocks) {
      const page = await open(browser, `/__gallery/sections/${block.type}/`, { width: 1280, height: 800 });
      const element = page.locator("[data-galley-block]").first();
      if ((await element.count()) === 0) fail(`the gallery has no “${block.type}” section — add one to scripts/gallery/sections.md.`);
      const png = await element.screenshot();
      await webp(png, join(ROOT, `galley/sections/${block.type}.webp`), { width: 640, maxHeight: 720 });
      await page.close();
    }
    // One contact sheet of every section, for the README.
    const tile = { width: 320, height: 220 };
    const columns = 4;
    const tiles = await Promise.all(
      blocks.map(async (block, i) => ({
        // Scaled to the tile's width; anything taller is cut off at the bottom.
        input: await (async () => {
          const scaled = await sharp(join(ROOT, `galley/sections/${block.type}.webp`)).resize({ width: tile.width }).toBuffer();
          const { height } = await sharp(scaled).metadata();
          return sharp(scaled).extract({ left: 0, top: 0, width: tile.width, height: Math.min(height, tile.height) }).toBuffer();
        })(),
        left: 16 + (i % columns) * (tile.width + 16),
        top: 16 + Math.floor(i / columns) * (tile.height + 16),
      })),
    );
    const rows = Math.ceil(blocks.length / columns);
    const sheet = await sharp({
      create: { width: 16 + columns * (tile.width + 16), height: 16 + rows * (tile.height + 16), channels: 3, background: { r: 228, g: 225, b: 220 } },
    })
      .composite(tiles)
      .png()
      .toBuffer();
    await webp(sheet, join(ROOT, "galley/previews/sections.webp"), { width: 16 + columns * (tile.width + 16), quality: 68 });
  }
  if (!only || only === "templates") {
    console.log("Templates:");
    for (const template of templates) {
      const page = await open(browser, `/__gallery/templates/${template.id}/`, { width: 1280, height: 800 });
      const png = await page.screenshot({ fullPage: true });
      await webp(png, join(ROOT, `galley/templates/${template.id}.webp`), { width: 400, quality: 60 });
      await page.close();
    }
  }
  if (!only || only === "previews") {
    console.log("Previews:");
    const page = await open(browser, "/", { width: 1280, height: 800 });
    const png = await page.screenshot();
    await webp(png, join(ROOT, "galley/previews/home.webp"), { width: 1280, quality: 70 });
    if (looks[0]) await webp(png, join(ROOT, `galley/previews/${looks[0].id}.webp`), { width: 1280, quality: 70 });
    await page.close();
  }
  server.close();

  // Every other look: its home-page preview.
  if (!only || only === "previews") {
    for (const look of looks.slice(1)) {
      const dir = join(OUT_BUILD, look.id);
      build(look.id, dir);
      server = await serve(dir);
      const page = await open(browser, "/", { width: 1280, height: 800 });
      await webp(await page.screenshot(), join(ROOT, `galley/previews/${look.id}.webp`), { width: 1280, quality: 70 });
      await page.close();
      server.close();
    }
  }
} finally {
  await browser.close();
  rmSync(OUT_BUILD, { recursive: true, force: true });
}
console.log("Done.");
