// Renders the raster images social networks and browsers need from the
// brand's SVG sources (social networks ignore SVG share images):
//   brand/logo/social-card.svg → public/og.png              1200 × 630
//   brand/logo/app-icon.svg    → public/apple-touch-icon.png  180 × 180
//   brand/logo/mark.svg        → public/favicon.ico            32 × 32 (PNG inside an ICO)
//
// Run when the brand files change:  pnpm --filter @galley/site images
// It drives a headless Chromium through playwright-core, which is not a
// dependency of this site. Point PLAYWRIGHT_FROM at any folder whose
// node_modules contains playwright-core (with a browser already installed).
import { readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const site = resolve(here, "..");
const brand = resolve(site, "../../brand/logo");
const require = createRequire(process.env.PLAYWRIGHT_FROM ? join(resolve(process.env.PLAYWRIGHT_FROM), "/") : import.meta.url);
const { chromium } = require("playwright-core");

async function render(page, svgFile, width, height, padding = 0, background = "transparent") {
  const svg = await readFile(join(brand, svgFile), "utf8");
  await page.setViewportSize({ width, height });
  await page.setContent(
    `<!doctype html><html><body style="margin:0;background:${background}"><div style="width:${width}px;height:${height}px;box-sizing:border-box;padding:${padding}px;display:grid">${svg.replace(
      "<svg ",
      '<svg style="width:100%;height:100%;display:block" '
    )}</div></body></html>`
  );
  return page.screenshot({ type: "png", omitBackground: background === "transparent" });
}

/** An .ico file holding one PNG image (supported by every current browser). */
function ico(png, size) {
  const header = Buffer.alloc(22);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(1, 4);
  header.writeUInt8(size, 6);
  header.writeUInt8(size, 7);
  header.writeUInt8(0, 8);
  header.writeUInt8(0, 9);
  header.writeUInt16LE(1, 10);
  header.writeUInt16LE(32, 12);
  header.writeUInt32LE(png.length, 14);
  header.writeUInt32LE(22, 18);
  return Buffer.concat([header, png]);
}

const browser = await chromium.launch();
const page = await browser.newPage({ deviceScaleFactor: 1 });
await writeFile(join(site, "public/og.png"), await render(page, "social-card.svg", 1200, 630));
await writeFile(join(site, "public/apple-touch-icon.png"), await render(page, "app-icon.svg", 180, 180));
// Paper behind the mark so it reads on dark browser tabs too.
await writeFile(join(site, "public/favicon.ico"), ico(await render(page, "mark.svg", 32, 32, 2, "#F6F1E7"), 32));
await browser.close();
console.log("Wrote public/og.png, public/apple-touch-icon.png, public/favicon.ico");
