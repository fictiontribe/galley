#!/usr/bin/env node
// Captures the static screenshots for the Astro themes listing from a running
// copy of the demo:
//
//   node docs/astro-catalog/capture-screens.mjs <demoUrl> [outDir] [--with-notice] [--format png|jpeg]
//
// The listing's images must be taken from the deployed demo, so <demoUrl> is
// normally the GitHub Pages address, e.g.
// https://fictiontribe.github.io/galley-astro-starter/. Every image is 16:9 —
// the gallery on astro.build shows theme images at 1600×900 — except the raw
// phone capture, which is also composed onto a 16:9 canvas.
//
// Needs Chromium through Playwright. It uses `playwright-core` (or
// `playwright`) from the current folder or from PLAYWRIGHT_CORE (a path to
// the package), with an installed Chromium (`npx playwright install chromium`).

import { mkdirSync, statSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    "with-notice": { type: "boolean" },
    format: { type: "string", default: "png" },
    help: { type: "boolean", short: "h" },
  },
});

if (values.help || positionals.length === 0) {
  console.log("Usage: node docs/astro-catalog/capture-screens.mjs <demoUrl> [outDir] [--with-notice] [--format png|jpeg]");
  process.exit(values.help ? 0 : 1);
}

const demo = new URL(positionals[0]);
if (!demo.pathname.endsWith("/")) demo.pathname += "/";
const outDir = resolve(positionals[1] ?? "docs/astro-catalog/screenshots");
const format = values.format === "jpeg" ? "jpeg" : "png";
const ext = format === "jpeg" ? "jpg" : "png";

function loadPlaywright() {
  const candidates = [process.env.PLAYWRIGHT_CORE, "playwright-core", "playwright"].filter(Boolean);
  const require = createRequire(pathToFileURL(join(process.cwd(), "noop.js")));

  for (const name of candidates) {
    try {
      return require(name);
    } catch {}
  }
  console.error("Couldn't load Playwright. Run `npm install --no-save playwright-core && npx playwright install chromium`, or set PLAYWRIGHT_CORE to the package's folder.");
  process.exit(1);
}

/** What to capture. `path` is relative to the demo; `scrollTo` a selector to bring to the top. */
const SHOTS = [
  { name: "01-home-1920x1080", path: "", viewport: { width: 1920, height: 1080 } },
  { name: "02-home-1280x720", path: "", viewport: { width: 1280, height: 720 } },
  { name: "03-pricing-1600x900", path: "pricing/", viewport: { width: 1600, height: 900 }, scrollTo: ".section--pricing .section-heading" },
  { name: "04-journal-post-1600x900", path: "blog/measured-survey/", viewport: { width: 1600, height: 900 } },
];
const PHONE = { width: 390, height: 844 };
const PHONE_PAGES = ["", "services/", "blog/"];

const { chromium } = loadPlaywright();
const browser = await chromium.launch();
const written = [];

async function open(context, path) {
  const page = await context.newPage();
  const url = new URL(path, demo).href;
  const response = await page.goto(url, { waitUntil: "networkidle" });

  if (!response || !response.ok()) throw new Error(`${url} answered ${response?.status() ?? "nothing"}`);
  await page.evaluate(() => document.fonts.ready);
  // Lazy images below the fold: load them before the shutter.
  await page.evaluate(async () => {
    for (const img of document.images) img.loading = "eager";
    await Promise.all([...document.images].map((img) => (img.complete ? null : new Promise((done) => img.addEventListener("load", done, { once: true })))));
  });
  return page;
}

async function context(viewport, deviceScaleFactor = 1) {
  const ctx = await browser.newContext({ viewport, deviceScaleFactor, reducedMotion: "reduce", colorScheme: "light" });

  if (!values["with-notice"]) {
    // The demo notice can be hidden by the visitor; the screenshots show the site as it looks then.
    await ctx.addInitScript(() => {
      try {
        localStorage.setItem("starter-notice", "hidden");
      } catch {}
    });
  }
  return ctx;
}

function save(name, buffer) {
  const file = join(outDir, `${name}.${ext}`);

  writeFileSync(file, buffer);
  written.push(file);
}

const shot = (page, clip) => page.screenshot({ type: format, ...(format === "jpeg" ? { quality: 88 } : {}), ...(clip ? { clip } : {}) });

mkdirSync(outDir, { recursive: true });
try {
  for (const spec of SHOTS) {
    const ctx = await context(spec.viewport);
    const page = await open(ctx, spec.path);

    if (spec.scrollTo) await page.locator(spec.scrollTo).first().evaluate((el) => window.scrollTo(0, el.getBoundingClientRect().top + window.scrollY - 48));
    await page.waitForTimeout(150);
    save(spec.name, await shot(page));
    await ctx.close();
  }

  // Phones: three pages at 390×844 (2×), then the same three set side by side on a 1600×900 canvas.
  const phones = [];
  const ctx = await context(PHONE, 2);

  for (const path of PHONE_PAGES) {
    const page = await open(ctx, path);
    phones.push(await page.screenshot({ type: "png" }));
    await page.close();
  }
  await ctx.close();
  save("05-phone-home-390x844", phones[0]);

  const canvas = await context({ width: 1600, height: 900 });
  const page = await canvas.newPage();
  const frames = phones.map((png) => `<img src="data:image/png;base64,${png.toString("base64")}" alt="">`).join("");

  await page.setContent(`<!doctype html><style>
    html,body{margin:0;height:100%}
    body{display:flex;align-items:center;justify-content:center;gap:56px;background:#ebe4d8}
    img{width:340px;height:auto;border-radius:28px;box-shadow:0 2px 6px rgb(40 30 20 / .12),0 28px 60px -18px rgb(40 30 20 / .35)}
  </style>${frames}`);
  await page.evaluate(() => Promise.all([...document.images].map((img) => img.decode())));
  save("06-phones-1600x900", await shot(page));
  await canvas.close();
} finally {
  await browser.close();
}

let total = 0;
for (const file of written) {
  const size = statSync(file).size;
  total += size;
  console.log(`${file}  ${(size / 1024).toFixed(0)} kB`);
}
console.log(`${written.length} images, ${(total / 1024).toFixed(0)} kB, from ${demo.href}`);
