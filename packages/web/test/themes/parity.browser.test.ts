/**
 * The legibility check measures what people see: for each built-in and test
 * theme, in light and dark, the page is given brand/tokens.css and the
 * theme exactly as the app applies it, every derived colour is painted, and
 * the screenshot's pixels are compared with the engine's derivation
 * (core/src/themes/derive.ts). A difference of more than 2/255 in a channel
 * fails: then the engine and the CSS disagree, and the CSS is what ships.
 *
 * Needs a Chromium through playwright-core, which is not one of the repo's
 * dependencies (nothing is downloaded for it). Point THEME_PARITY_PLAYWRIGHT at a
 * folder whose node_modules has playwright-core (and its browsers installed):
 *   THEME_PARITY_PLAYWRIGHT=/path/to/project pnpm --filter @galley/web exec vitest run test/themes/parity.browser.test.ts
 * Without it the test is skipped, and says so.
 */
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { inflateSync } from "node:zlib";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DERIVED_PROPERTY, PEOPLE_COLOURS, QUIET, PLATE, DESK, checkTheme, themeOnPage, type DerivedColours, type ThemeCheck, type ThemeMode } from "@galley/core/themes";
import { TEST_THEMES } from "../../../core/test/themes/fixtures";

type Browser = { newPage(options?: object): Promise<Page>; close(): Promise<void> };
type Page = {
  setContent(html: string): Promise<void>;
  screenshot(options: object): Promise<Buffer>;
  evaluate<T, A>(fn: (arg: A) => T, arg: A): Promise<T>;
};

function loadChromium(): { launch(options: object): Promise<Browser> } | null {
  const from = process.env.THEME_PARITY_PLAYWRIGHT;
  if (!from) return null;
  try {
    return (createRequire(`${from.replace(/\/$/, "")}/package.json`)("playwright-core") as { chromium: { launch(options: object): Promise<Browser> } }).chromium;
  } catch {
    return null;
  }
}

const chromium = loadChromium();
const tokens = readFileSync(fileURLToPath(new URL("../../../../brand/tokens.css", import.meta.url)), "utf8");
// look.css points the older accent tints at the pencil ramp (on .g-root), so they are measured too.
const look = readFileSync(fileURLToPath(new URL("../../src/styles/look.css", import.meta.url)), "utf8");

/** Each painted property, and what the engine says it is. */
interface Cell {
  property: string;
  engine(check: ThemeCheck, mode: ThemeMode): string;
}
const CELLS: Cell[] = [
  ...(Object.keys(DERIVED_PROPERTY) as Array<keyof DerivedColours>).map((name) => ({ property: DERIVED_PROPERTY[name], engine: (check: ThemeCheck, mode: ThemeMode) => check.colours![mode][name] })),
  { property: "--accent-subtle", engine: (check, mode) => check.colours![mode].pencil100 },
  { property: "--accent-subtle-hover", engine: (check, mode) => check.colours![mode].pencil200 },
  { property: "--accent-line", engine: (check, mode) => check.colours![mode].pencil300 },
  ...PEOPLE_COLOURS.map((person, index): Cell => ({ property: `--person-${index + 1}`, engine: (check) => check.applied!.people?.[String(index + 1)] ?? person.value })),
];
const CELL = 8;

/** An 8-bit RGBA, non-interlaced PNG (what Chromium's screenshots are) → pixels. */
function decodePng(png: Buffer): { width: number; pixel(x: number, y: number): [number, number, number] } {
  let offset = 8;
  let width = 0;
  let height = 0;
  let channels = 4;
  const data: Buffer[] = [];
  while (offset < png.length) {
    const length = png.readUInt32BE(offset);
    const type = png.toString("latin1", offset + 4, offset + 8);
    const body = png.subarray(offset + 8, offset + 8 + length);
    if (type === "IHDR") {
      width = body.readUInt32BE(0);
      height = body.readUInt32BE(4);
      channels = body[9] === 6 ? 4 : 3;
    }
    if (type === "IDAT") data.push(body);
    offset += 12 + length;
  }
  const raw = inflateSync(Buffer.concat(data));
  const stride = width * channels;
  const out = Buffer.alloc(height * stride);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)]!;
    for (let x = 0; x < stride; x++) {
      const value = raw[y * (stride + 1) + 1 + x]!;
      const a = x >= channels ? out[y * stride + x - channels]! : 0;
      const b = y > 0 ? out[(y - 1) * stride + x]! : 0;
      const c = x >= channels && y > 0 ? out[(y - 1) * stride + x - channels]! : 0;
      const p = a + b - c;
      const paeth = Math.abs(p - a) <= Math.abs(p - b) && Math.abs(p - a) <= Math.abs(p - c) ? a : Math.abs(p - b) <= Math.abs(p - c) ? b : c;
      const predicted = [0, a, b, (a + b) >> 1, paeth][filter] ?? 0;
      out[y * stride + x] = (value + predicted) & 0xff;
    }
  }
  return { width, pixel: (x, y) => [out[y * stride + x * channels]!, out[y * stride + x * channels + 1]!, out[y * stride + x * channels + 2]!] };
}

function page(onPage: ReturnType<typeof themeOnPage>, mode: ThemeMode): string {
  const attributes = Object.entries(onPage.attributes)
    .map(([name, value]) => ` ${name}="${value}"`)
    .join("");
  const style = Object.entries(onPage.properties)
    .map(([name, value]) => `${name}: ${value};`)
    .join(" ");
  const cells = CELLS.map((cell, index) => `<i style="left:${index * CELL}px;background:var(${cell.property})"></i>`).join("");
  return `<!doctype html><html data-surfaces="app" data-theme="${mode}"${attributes} style="${style}"><head><style>${tokens}
${look}
    body { margin: 0; } i { position: absolute; top: 0; width: ${CELL}px; height: ${CELL}px; }</style></head><body class="g-root">${cells}</body></html>`;
}

const hex = ([r, g, b]: [number, number, number]) => `#${[r, g, b].map((v) => v.toString(16).padStart(2, "0")).join("")}`.toUpperCase();
const channels = (value: string) => [1, 3, 5].map((i) => parseInt(value.slice(i, i + 2), 16));

describe.skipIf(!chromium)("the engine derives what the browser paints", () => {
  let browser: Browser;
  let tab: Page;
  beforeAll(async () => {
    browser = await chromium!.launch({ args: ["--force-color-profile=srgb"] });
    tab = await browser.newPage({ viewport: { width: CELLS.length * CELL, height: CELL }, deviceScaleFactor: 1 });
  });
  afterAll(async () => {
    await browser?.close();
  });

  // "deep" tunes a people colour, so its override is painted too.
  const themes = { quiet: QUIET, plate: PLATE, desk: DESK, ...TEST_THEMES, deep: { ...QUIET, id: "deep", name: "Deep", dark: { ...QUIET.dark!, paper: "#132532" } } };
  for (const [name, theme] of Object.entries(themes)) {
    for (const mode of ["light", "dark"] as const) {
      it(`${name}, ${mode}`, async () => {
        const check = checkTheme(theme);
        expect(check.ok).toBe(true);
        await tab.setContent(page(themeOnPage(check.applied, mode), mode));
        const shot = decodePng(await tab.screenshot({ type: "png" }));
        const differences: string[] = [];
        CELLS.forEach((cell, index) => {
          const painted = hex(shot.pixel(index * CELL + CELL / 2, CELL / 2));
          const engine = cell.engine(check, mode);
          const worst = Math.max(...channels(painted).map((value, i) => Math.abs(value - channels(engine)[i]!)));
          if (worst > 2) differences.push(`${cell.property}: engine ${engine}, page ${painted}`);
        });
        expect(differences).toEqual([]);
      });
    }
  }
});

describe.runIf(!chromium)("the engine derives what the browser paints", () => {
  it.skip("needs THEME_PARITY_PLAYWRIGHT (a folder with playwright-core) to run in a browser", () => undefined);
});
