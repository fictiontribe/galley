#!/usr/bin/env node
// Renders brand/logo/app-icon.svg to a 1024×1024 PNG with a transparent
// background, the input `tauri icon` turns into every platform's icon set:
//
//   pnpm --filter @galley/desktop icons
//
// It needs playwright-core and a Chromium it has already downloaded; it never
// downloads one. Point PLAYWRIGHT_CORE_FROM at a node_modules folder that has
// playwright-core when this workspace doesn't (it isn't a dependency here,
// because the icons are generated rarely and committed).
import { mkdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, "..", "..", "..");
const source = join(repo, "brand", "logo", "app-icon.svg");
const outDir = join(here, "..", "src-tauri", "icons", "source");
const out = join(outDir, "app-icon-1024.png");

let chromium;

try {
  const from = process.env.PLAYWRIGHT_CORE_FROM ?? join(here, "..", "node_modules");

  ({ chromium } = createRequire(join(from, "noop.js"))("playwright-core"));
} catch {
  console.error("playwright-core isn't installed here. Set PLAYWRIGHT_CORE_FROM to a node_modules folder that has it.");
  process.exit(1);
}

const svg = readFileSync(source, "utf8");
const browser = await chromium.launch({ headless: true });

try {
  const page = await browser.newPage({ viewport: { width: 1024, height: 1024 }, deviceScaleFactor: 1 });

  await page.setContent(
    `<!doctype html><html><head><style>html,body{margin:0;background:transparent}svg{display:block;width:1024px;height:1024px}</style></head><body>${svg}</body></html>`
  );
  mkdirSync(outDir, { recursive: true });
  await page.locator("svg").screenshot({ path: out, omitBackground: true });
  console.log(`✓ ${out}`);
} finally {
  await browser.close();
}
