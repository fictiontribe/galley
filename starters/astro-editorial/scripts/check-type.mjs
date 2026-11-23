#!/usr/bin/env node
// Checks that the production build and `astro dev` set the same type: every
// font file loads in both, and every piece of text on every page has the same
// font properties and the same rendered width. A difference means a page in
// Galley's Proof (live site beside the proposed page, which the dev server
// draws) would look like two different fonts.
//
//   PLAYWRIGHT_MODULES=/path/to/node_modules/ node scripts/check-type.mjs
//
// It builds the site into a temporary folder, serves it, starts `astro dev`
// beside it and compares the two in headless Chromium, at 1440 and 390 wide:
// each text element's font properties and width, and the first screen's
// pixels with the photographs hidden.
// Options:
//   --looks           every look in starter.json, not only the current tokens
//   --linked          run from a temporary copy whose node_modules is a link to
//                     this one (how pnpm, shared installs and preview copies
//                     lay a site out: the case that once broke the dev fonts)
//   --pages 6         how many pages to compare (default: all)
//   --port 4736       first of the three ports it uses
// Like scripts/make-thumbnails.mjs it installs nothing: PLAYWRIGHT_MODULES names
// a node_modules folder that has playwright-core, and Chromium is the one
// Playwright has cached (or PLAYWRIGHT_CHROMIUM). Stop your own `astro dev`
// first: Astro runs one dev server per project.

import { spawn, spawnSync } from "node:child_process";
import { cpSync, createReadStream, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, symlinkSync } from "node:fs";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, extname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import sharp from "sharp";

const HERE = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const { values } = parseArgs({ options: { looks: { type: "boolean" }, linked: { type: "boolean" }, pages: { type: "string" }, port: { type: "string" } } });
const PORT = Number(values.port ?? 4736);
const fail = (message) => {
  console.error(`check-type: ${message}`);
  process.exit(2);
};

const modules = process.env.PLAYWRIGHT_MODULES;
if (!modules) fail("set PLAYWRIGHT_MODULES to a node_modules folder that contains playwright-core (this script installs nothing).");
let chromium;
try {
  ({ chromium } = createRequire(modules.endsWith("/") ? modules : `${modules}/`)("playwright-core"));
} catch (error) {
  fail(`could not load playwright-core from ${modules} (${error.message.split("\n")[0]}).`);
}

const work = mkdtempSync(join(tmpdir(), "galley-check-type-"));
let ROOT = HERE;
if (values.linked) {
  ROOT = join(work, "site");
  const skip = new Set(["node_modules", "dist", ".astro"].map((name) => join(HERE, name)));
  cpSync(HERE, ROOT, { recursive: true, filter: (src) => !skip.has(src) });
  symlinkSync(join(HERE, "node_modules"), join(ROOT, "node_modules"));
}
const starter = JSON.parse(readFileSync(join(HERE, "starter.json"), "utf8"));
const looks = values.looks ? starter.looks.map((look) => look.id) : [null];
const astro = join(ROOT, "node_modules/astro/bin/astro.mjs");
const envFor = (look) => ({ PATH: process.env.PATH, HOME: process.env.HOME, ASTRO_TELEMETRY_DISABLED: "1", ...(look ? { SECTION_GALLERY: "1", SECTION_GALLERY_LOOK: look } : {}) });

const TYPES = { ".html": "text/html; charset=utf-8", ".css": "text/css", ".js": "text/javascript", ".svg": "image/svg+xml", ".webp": "image/webp", ".jpg": "image/jpeg", ".png": "image/png", ".woff2": "font/woff2", ".json": "application/json", ".xml": "application/xml", ".txt": "text/plain" };
function serve(dir, port) {
  const server = createServer((req, res) => {
    let file = join(dir, decodeURIComponent(new URL(req.url, "http://x").pathname));
    if (!file.startsWith(dir)) return res.writeHead(403).end();
    if (existsSync(file) && statSync(file).isDirectory()) file = join(file, "index.html");
    if (!existsSync(file)) return res.writeHead(404).end();
    res.writeHead(200, { "Content-Type": TYPES[extname(file)] ?? "application/octet-stream" });
    createReadStream(file).pipe(res);
  });
  return new Promise((ok) => server.listen(port, "127.0.0.1", () => ok(server)));
}

async function startDev(look, port) {
  const child = spawn(process.execPath, [astro, "dev", "--port", String(port), "--host", "127.0.0.1"], { cwd: ROOT, env: envFor(look), stdio: ["ignore", "pipe", "pipe"] });
  let log = "";
  child.stdout.on("data", (d) => (log += d));
  child.stderr.on("data", (d) => (log += d));
  const t0 = Date.now();
  for (;;) {
    if (child.exitCode !== null) fail(`astro dev stopped:\n${log.slice(-800)}`);
    if (await fetch(`http://127.0.0.1:${port}/`).then((r) => r.ok, () => false)) return child;
    if (Date.now() - t0 > 90000) fail(`astro dev did not start:\n${log.slice(-800)}`);
    await new Promise((ok) => setTimeout(ok, 400));
  }
}

/** Every text element's font properties and width, the fonts in use, and font requests that failed. */
async function read(browser, url, width) {
  const page = await browser.newPage({ viewport: { width, height: 900 }, reducedMotion: "reduce" });
  const refused = [];
  page.on("response", (r) => { if (/\.(woff2?|ttf|otf)(\?|$)/.test(r.url()) && r.status() >= 400) refused.push(`${r.status()} ${r.url().split("/").pop()}`); });
  await page.goto(url, { waitUntil: "networkidle" });
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(200);
  const data = await page.evaluate(() => {
    const rows = {};
    const seen = new Set();
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    let n = 0;
    while (walker.nextNode()) {
      const text = walker.currentNode;
      const el = text.parentElement;
      if (!text.data.trim() || seen.has(el) || el.closest("script, style, template, noscript, astro-dev-toolbar, vite-error-overlay")) continue;
      seen.add(el);
      const cs = getComputedStyle(el);
      const range = document.createRange();
      range.selectNodeContents(el);
      const key = `${el.tagName.toLowerCase()}${[...el.classList].filter((c) => !c.startsWith("astro-")).map((c) => "." + c).join("")} “${text.data.trim().slice(0, 28)}” #${n++}`;
      rows[key] = { family: cs.fontFamily.split(",")[0], weight: cs.fontWeight, style: cs.fontStyle, size: cs.fontSize, opticalSizing: cs.fontOpticalSizing, variations: cs.fontVariationSettings, synthesis: cs.fontSynthesis, tracking: cs.letterSpacing, leading: cs.lineHeight, width: Math.round(range.getBoundingClientRect().width * 100) / 100 };
    }
    const faces = [...document.fonts].filter((f) => f.status === "loaded").map((f) => `${f.family.replace(/"/g, "")} ${f.style} ${f.weight}`);
    return { rows, faces: [...new Set(faces)].sort() };
  });
  // The first screen as pixels, for an exact comparison of the type: the dev
  // toolbar and the photographs hidden (which srcset copy of a photograph the
  // browser takes can depend on what it happened to load first).
  await page.addStyleTag({ content: "astro-dev-toolbar { display: none !important; } img, video { visibility: hidden !important; }" });
  await page.evaluate(() => scrollTo(0, 0));
  const shot = await page.screenshot();
  await page.close();
  return { ...data, refused, shot };
}

const results = [];
let browser;
const children = [];
const servers = [];
try {
  browser = await chromium.launch(process.env.PLAYWRIGHT_CHROMIUM ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM } : {});
  for (const look of looks) {
    const name = look ?? "current tokens";
    const outDir = join(work, `dist-${look ?? "tokens"}`);
    const built = spawnSync(process.execPath, [astro, "build", "--outDir", outDir], { cwd: ROOT, env: envFor(look), encoding: "utf8" });
    if (built.status !== 0) fail(`the build failed:\n${built.stdout}\n${built.stderr}`);
    const server = await serve(outDir, PORT);
    servers.push(server);
    const dev = await startDev(look, PORT + 1);
    children.push(dev);
    const pages = [];
    const walk = (dir) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (entry.isDirectory()) walk(join(dir, entry.name));
        else if (entry.name === "index.html") pages.push("/" + relative(outDir, dir).split(sep).filter(Boolean).map((p) => p + "/").join(""));
      }
    };
    walk(outDir);
    const list = pages.filter((p) => !p.startsWith("/__gallery")).sort().slice(0, values.pages ? Number(values.pages) : undefined);
    let compared = 0, differ = 0, refused = 0, screens = 0;
    const notes = [];
    for (const path of list) {
      for (const width of [1440, 390]) {
        const a = await read(browser, `http://127.0.0.1:${PORT}${path}`, width);
        const b = await read(browser, `http://127.0.0.1:${PORT + 1}${path}`, width);
        refused += a.refused.length + b.refused.length;
        for (const r of a.refused) notes.push(`build refused a font on ${path}: ${r}`);
        for (const r of b.refused) notes.push(`dev refused a font on ${path}: ${r}`);
        const [pa, pb] = await Promise.all([a.shot, b.shot].map((png) => sharp(png).raw().toBuffer()));
        let pixels = 0;
        for (let i = 0; i < Math.min(pa.length, pb.length); i++) if (pa[i] !== pb[i]) pixels++;
        if (pixels || pa.length !== pb.length) { screens++; notes.push(`${path} @${width}: the first screen differs in ${pixels} channel values`); }
        if (a.faces.join() !== b.faces.join()) notes.push(`${path} @${width}: fonts in use differ — build [${a.faces.join("; ")}] dev [${b.faces.join("; ")}]`);
        for (const [key, va] of Object.entries(a.rows)) {
          const vb = b.rows[key];
          if (!vb) continue;
          compared++;
          const props = Object.keys(va).filter((p) => va[p] !== vb[p]);
          if (props.length) {
            differ++;
            if (notes.length < 40) notes.push(`${path} @${width} ${key.replace(/ #\d+$/, "")}: ${props.map((p) => `${p} build ${va[p]} · dev ${vb[p]}`).join("; ")}`);
          }
        }
      }
    }
    dev.kill();
    await new Promise((ok) => server.close(ok));
    results.push({ name, pages: list.length, compared, differ, refused, screens, notes });
  }
} finally {
  for (const child of children) if (child.exitCode === null) child.kill();
  for (const server of servers) server.close();
  await browser?.close();
  rmSync(work, { recursive: true, force: true });
}

let ok = true;
for (const r of results) {
  const clean = r.differ === 0 && r.refused === 0 && r.screens === 0 && !r.notes.length;
  ok &&= clean;
  console.log(`${clean ? "ok  " : "FAIL"} ${r.name}${values.linked ? " (linked node_modules)" : ""}: ${r.pages} pages × 2 widths, ${r.compared} text elements compared, ${r.differ} differ, ${r.screens} first screens differ by a pixel, ${r.refused} font requests refused`);
  for (const note of r.notes) console.log(`     ${note}`);
}
process.exit(ok ? 0 : 1);
