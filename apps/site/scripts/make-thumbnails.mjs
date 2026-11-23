// Pictures for Galley's section library (galley/sections/<type>.webp): the
// first section of each type on the built site, photographed at 1280 px wide
// and saved at 640 px wide, at most 720 px tall (starters/README.md §6).
//
//   GALLEY_SHOW_HIDDEN=1 npx astro build (so sections switched off in the
//   content, like the film, are on the page), serve dist/ on a port, then
//   SITE=http://127.0.0.1:4522 PLAYWRIGHT_MODULES=<node_modules with playwright-core> node scripts/make-thumbnails.mjs
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";

const here = dirname(fileURLToPath(import.meta.url));
const SITE = process.env.SITE ?? "http://127.0.0.1:4522";
const require = createRequire(join(process.env.PLAYWRIGHT_MODULES ?? join(here, "../node_modules"), "/"));
const { chromium } = require("playwright-core");
const config = JSON.parse(readFileSync(join(here, "../galley.config.json"), "utf8"));
const blocks = config.collections.find((c) => c.id === "pages").fields.find((f) => f.key === "sections").blocks;
const pages = ["/", "/starters/", "/wordpress/", "/ai-first/", "/cloud/", "/open-source/", "/astro/", "/team/"];
const out = join(here, "../galley/sections");
const tmp = join(tmpdir(), "galley-thumbs");
mkdirSync(out, { recursive: true });
mkdirSync(tmp, { recursive: true });

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, reducedMotion: "reduce" });
const todo = new Set(blocks.map((b) => b.type));
for (const path of pages) {
  if (!todo.size) break;
  await page.goto(SITE + path, { waitUntil: "networkidle" });
  // The section alone: no fixed bar over it, no phone action bar.
  await page.addStyleTag({ content: ".header { display: none !important; }" });
  for (const type of [...todo]) {
    const el = page.locator(`[data-galley-block-type="${type}"]`).first();
    if (!(await el.count())) continue;
    await el.scrollIntoViewIfNeeded();
    await page.waitForTimeout(400);
    const box = await el.boundingBox();
    const png = join(tmp, `${type}.png`);
    await page.screenshot({ path: png, fullPage: true, clip: { x: 0, y: box.y + (await page.evaluate(() => scrollY)), width: 1280, height: Math.min(box.height, 1440) } });
    const file = join(out, `${type}.webp`);
    execFileSync("cwebp", ["-quiet", "-q", "72", "-resize", "640", "0", png, "-o", file]);
    console.log(`${type}: ${(statSync(file).size / 1024).toFixed(0)} KB from ${path}`);
    todo.delete(type);
  }
}
await browser.close();
rmSync(tmp, { recursive: true, force: true });
if (todo.size) console.log("no example on the site for:", [...todo].join(", "));
