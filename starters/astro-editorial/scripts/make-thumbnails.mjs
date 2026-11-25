#!/usr/bin/env node
// Pictures of the starter for Galley's pickers, taken from a real build:
//
//   galley/sections/<type>.webp     every section type alone   640 × 480
//   galley/templates/<id>.webp      every page template         640 × 800
//   galley/previews/<look>.webp     the home page in each look  1280 × 800
//                                   (three columns: the page from top to bottom)
//   galley/previews/home.webp       the home page's first screen 1280 × 800
//                                   in the default look
//   galley/previews/sections.webp   every section picture on one sheet, for the
//                                   README (made from galley/sections/)
//
// It builds the site with the section gallery switched on (SECTION_GALLERY,
// see scripts/gallery/), once per look, serves each build locally and
// photographs it in headless Chromium. Run it again whenever sections,
// templates, looks or photographs change (scripts/ingest-photos.mjs does).
//
//   PLAYWRIGHT_MODULES=/path/to/node_modules/ node scripts/make-thumbnails.mjs
//
// It needs playwright-core and a Chromium it can launch, and installs
// neither: PLAYWRIGHT_MODULES names a node_modules folder that already has
// playwright-core (any project's), and Chromium is the one Playwright has
// cached for that version — or set PLAYWRIGHT_CHROMIUM to a browser binary.
// Options: --only sections|templates|previews|home|sheet, --port 4873.
// `--only sheet` builds nothing: it lays out the section pictures already made.

import { spawnSync } from "node:child_process";
import { createReadStream, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, extname, join, normalize, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import sharp from "sharp";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const { values } = parseArgs({ options: { only: { type: "string" }, port: { type: "string" } } });
const PORT = Number(values.port ?? process.env.THUMBNAILS_PORT ?? 4873);
const want = (kind) => !values.only || values.only === kind;

function fail(message) {
  console.error(`make-thumbnails: ${message}`);
  process.exit(1);
}

// ── playwright-core, from somewhere it is already installed ───────────────

const modules = process.env.PLAYWRIGHT_MODULES;
if (!modules) {
  fail(
    "set PLAYWRIGHT_MODULES to a node_modules folder that contains playwright-core, e.g.\n" +
      "  PLAYWRIGHT_MODULES=~/some-project/node_modules/ node scripts/make-thumbnails.mjs\n" +
      "This script does not install Playwright or download browsers.",
  );
}
let chromium;
try {
  ({ chromium } = createRequire(modules.endsWith("/") ? modules : `${modules}/`)("playwright-core"));
} catch (error) {
  fail(`could not load playwright-core from ${modules} (${error.message.split("\n")[0]}).`);
}

// ── Build, serve, photograph ───────────────────────────────────────────────

const starter = JSON.parse(readFileSync(join(ROOT, "starter.json"), "utf8"));
const config = JSON.parse(readFileSync(join(ROOT, "galley.config.json"), "utf8"));
const sectionTypes = config.collections.find((c) => c.id === "pages").fields.find((f) => f.key === "sections").blocks.map((b) => b.type);
const looks = starter.looks.map((look) => look.id);
const work = mkdtempSync(join(tmpdir(), "galley-thumbnails-"));

function build(look) {
  const outDir = join(work, look);
  // A clean environment: the site's own build, plus the gallery switches.
  const env = { PATH: process.env.PATH, HOME: process.env.HOME, SECTION_GALLERY: "1", SECTION_GALLERY_LOOK: look };
  const result = spawnSync(process.execPath, [join(ROOT, "node_modules/astro/bin/astro.mjs"), "build", "--outDir", outDir], { cwd: ROOT, env, encoding: "utf8" });
  if (result.status !== 0) fail(`the ${look} build failed:\n${result.stdout}\n${result.stderr}`);
  return outDir;
}

const TYPES = { ".html": "text/html; charset=utf-8", ".css": "text/css", ".js": "text/javascript", ".svg": "image/svg+xml", ".webp": "image/webp", ".jpg": "image/jpeg", ".png": "image/png", ".woff2": "font/woff2", ".xml": "application/xml", ".txt": "text/plain" };

function serve(dir) {
  const server = createServer((req, res) => {
    let path = normalize(decodeURIComponent(new URL(req.url, "http://x").pathname)).replace(/^(\.\.[/\\])+/, "");
    let file = join(dir, path);
    if (!file.startsWith(dir + sep) && file !== dir) return res.writeHead(403).end();
    if (existsSync(file) && statSync(file).isDirectory()) file = join(file, "index.html");
    if (!existsSync(file)) {
      res.writeHead(404, { "Content-Type": TYPES[".html"] });
      return createReadStream(join(dir, "404.html")).pipe(res);
    }
    res.writeHead(200, { "Content-Type": TYPES[extname(file)] ?? "application/octet-stream" });
    createReadStream(file).pipe(res);
  });
  return new Promise((ok) => server.listen(PORT, "127.0.0.1", () => ok(server)));
}

/** Encode as WebP, stepping quality down until it fits `budget` bytes. */
async function webp(input, budget, floor = 40) {
  let quality = 82;
  let out = await sharp(input).webp({ quality, effort: 6 }).toBuffer();
  while (out.length > budget && quality > floor) {
    quality -= 6;
    out = await sharp(input).webp({ quality, effort: 6 }).toBuffer();
  }
  return out;
}

function write(rel, buffer) {
  const path = join(ROOT, rel);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, buffer);
  console.log(`  ${rel.padEnd(40)} ${(buffer.length / 1024).toFixed(1).padStart(6)} kB`);
}

const launchOptions = process.env.PLAYWRIGHT_CHROMIUM ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM } : {};
let browser;
try {
  browser = await chromium.launch(launchOptions);
} catch (error) {
  fail(`could not start Chromium (${error.message.split("\n")[0]}). Set PLAYWRIGHT_CHROMIUM to a Chromium or Chrome binary.`);
}

/** An element's background as an { r, g, b } sharp understands (browsers report oklch). */
function groundOf(locator) {
  return locator.evaluate((el) => {
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 1;
    const context = canvas.getContext("2d");
    let node = el;
    let colour = getComputedStyle(node).backgroundColor;
    while (node.parentElement && /rgba\(0, 0, 0, 0\)|transparent/.test(colour)) {
      node = node.parentElement;
      colour = getComputedStyle(node).backgroundColor;
    }
    context.fillStyle = colour;
    context.fillRect(0, 0, 1, 1);
    const [r, g, b] = context.getImageData(0, 0, 1, 1).data;
    return { r, g, b };
  });
}

async function open(url) {
  // Reduced motion: every entrance animation is skipped and the ticker holds still.
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1, reducedMotion: "reduce" });
  const page = await context.newPage();
  await page.goto(url, { waitUntil: "networkidle" });
  await page.evaluate(() => document.fonts.ready);
  await settle(page);
  return { page, context };
}

/**
 * Every picture on the page loaded and decoded before a shot: lazy images
 * below the first screen would otherwise be photographed as empty boxes.
 */
async function settle(page) {
  await page.evaluate(async () => {
    const images = [...document.images];
    for (const image of images) image.loading = "eager";
    const loaded = (image) =>
      image.complete && image.naturalWidth > 0
        ? null
        : new Promise((done) => {
            image.addEventListener("load", done, { once: true });
            image.addEventListener("error", done, { once: true });
            setTimeout(done, 15000);
          });
    await Promise.all(images.map(loaded));
    await Promise.all(images.map((image) => image.decode?.().catch(() => {})));
  });
  await page.waitForLoadState("networkidle");
}

const needsBuild = ["sections", "templates", "previews", "home"].some(want);
try {
  for (const look of needsBuild ? looks : []) {
    const first = look === looks[0];
    if (!first && !want("previews")) continue;
    process.stdout.write(`Building the ${look} look… `);
    const dir = build(look);
    console.log("done.");
    const server = await serve(dir);
    const base = `http://127.0.0.1:${PORT}`;

    if (first && want("sections")) {
      for (const type of sectionTypes) {
        const { page, context } = await open(`${base}/__gallery/sections/${type}/`);
        const section = page.locator(`[data-galley-block-type="${type}"]`).first();
        const box = await section.boundingBox();
        if (!box) fail(`no section of type ${type} in the gallery.`);
        const background = await groundOf(section);
        // At most 1280 × 960 from the top of the section; a shorter section is
        // centred on its own background rather than cropped.
        const height = Math.min(Math.round(box.height), 960);
        const shot = await page.screenshot({ clip: { x: 0, y: box.y, width: 1280, height }, fullPage: true });
        const half = await sharp(shot).resize(640).png().toBuffer();
        const { height: h } = await sharp(half).metadata();
        const framed = await sharp(half)
          .extend({ top: Math.max(0, Math.floor((480 - h) / 2)), bottom: Math.max(0, Math.ceil((480 - h) / 2)), background })
          .png()
          .toBuffer();
        const picture = await sharp(framed).extract({ left: 0, top: 0, width: 640, height: 480 }).toBuffer();
        write(`galley/sections/${type}.webp`, await webp(picture, 25 * 1024));
        await context.close();
      }
    }

    if (first && want("templates")) {
      for (const template of config.templates) {
        const { page, context } = await open(`${base}/__gallery/templates/${template.id}/`);
        const shot = await page.screenshot({ clip: { x: 0, y: 0, width: 1280, height: 1600 }, fullPage: true });
        const picture = await sharp(shot).resize(640, 800, { fit: "cover", position: "top" }).toBuffer();
        write(template.thumbnail, await webp(picture, 40 * 1024));
        await context.close();
      }
    }

    if (first && want("home")) {
      // The first screen of the home page, as a visitor lands on it.
      const { page, context } = await open(`${base}/`);
      write("galley/previews/home.webp", await webp(await page.screenshot(), 90 * 1024));
      await context.close();
    }

    if (want("previews")) {
      // Three columns, each 1280 × 2560 of the page scaled to 400 × 800, side
      // by side on the look's own ground: the hero, then what follows it.
      const { page, context } = await open(`${base}/`);
      await page.evaluate(async () => {
        for (let y = 0; y < document.body.scrollHeight; y += 700) {
          window.scrollTo(0, y);
          await new Promise((ok) => setTimeout(ok, 50));
        }
        window.scrollTo(0, 0);
      });
      await settle(page);
      const ground = await groundOf(page.locator("body"));
      const full = await page.screenshot({ fullPage: true });
      const { height: pageHeight } = await sharp(full).metadata();
      const columns = [];
      for (let i = 0; i < 3; i++) {
        const top = Math.min(i * 2560, Math.max(0, pageHeight - 2560));
        const slice = await sharp(full).extract({ left: 0, top, width: 1280, height: Math.min(2560, pageHeight - top) }).resize(400, 800, { fit: "cover", position: "top" }).toBuffer();
        columns.push({ input: slice, left: 20 + i * 420, top: 0 });
      }
      const sheet = await sharp({ create: { width: 1280, height: 800, channels: 3, background: ground } }).composite(columns).png().toBuffer();
      const entry = starter.looks.find((item) => item.id === look);
      write(entry.preview, await webp(sheet, 90 * 1024));
      await context.close();
    }

    await new Promise((ok) => server.close(ok));
  }

  if (want("sections") || want("sheet")) {
    // Every section picture at half size, four to a row, in the library's order.
    const tile = { width: 320, height: 240, gap: 16, columns: 4 };
    const missing = sectionTypes.filter((type) => !existsSync(join(ROOT, `galley/sections/${type}.webp`)));
    if (missing.length) fail(`no picture yet for ${missing.join(", ")}: run it with --only sections first.`);
    const tiles = await Promise.all(
      sectionTypes.map(async (type, i) => ({
        input: await sharp(join(ROOT, `galley/sections/${type}.webp`)).resize(tile.width, tile.height, { fit: "cover", position: "top" }).toBuffer(),
        left: tile.gap + (i % tile.columns) * (tile.width + tile.gap),
        top: tile.gap + Math.floor(i / tile.columns) * (tile.height + tile.gap),
      })),
    );
    const rows = Math.ceil(sectionTypes.length / tile.columns);
    const width = tile.gap + tile.columns * (tile.width + tile.gap);
    const height = tile.gap + rows * (tile.height + tile.gap);
    const sheet = await sharp({ create: { width, height, channels: 3, background: { r: 228, g: 225, b: 220 } } }).composite(tiles).png().toBuffer();
    write("galley/previews/sections.webp", await webp(sheet, 160 * 1024));
  }
} finally {
  await browser.close();
  rmSync(work, { recursive: true, force: true });
}

const size = (dir) => readdirSync(dir, { withFileTypes: true }).reduce((sum, entry) => sum + (entry.isDirectory() ? size(join(dir, entry.name)) : statSync(join(dir, entry.name)).size), 0);
console.log(`galley/ is now ${(size(join(ROOT, "galley")) / 1024).toFixed(0)} kB.`);
