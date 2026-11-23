// Captures the product screenshots and recordings used on the marketing site
// from a real, running Galley — so they can be refreshed in one command when
// the app changes. Every file it writes is listed in ../screens.json.
//
//   GALLEY_ORIGIN=http://127.0.0.1:4520 GALLEY_TOKEN=… GALLEY_SITE=<siteId> \
//   PLAYWRIGHT_MODULES=<a node_modules folder with playwright-core> \
//   node scripts/capture-screens.mjs [step …]
//
// The Galley it talks to must have the fashion starter (astro-editorial, "Caddow") open (a throwaway copy:
// any edits made here are real edits to that copy) and, for the "assistant"
// step, the assistant connected. Steps run in the order given; with none, all
// run except "assistant" (which costs one assistant request) — pass it
// explicitly. Steps: site, looks, form, click, arrange, drag, assistant, chat,
// proof, source, publish, starters, wordpress. Output: public/screens/<name>.webp
// (2× device scale, light theme, with a 1× copy) and public/screens/<name>.webm
// + poster for recordings; captures of the example site itself go to
// public/sites/. The order used for the site (see screens.json):
//   reset site looks arrange drag click assistant chat form proof source
// "looks" also needs SITE_DIR (the throwaway copy's folder: it copies each
// look over src/styles/tokens.css and puts the file back afterwards);
// "wordpress" needs WP_SITE (a second site's id, a throwaway copy of another
// starter) and WP_URL (the importer's stand-in WordPress site, see
// packages/import-wordpress/test/serve-fake-site.ts).
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { homedir, tmpdir } from "node:os";

const here = dirname(fileURLToPath(import.meta.url));
const OUT = join(here, "../public/screens");
const ORIGIN = process.env.GALLEY_ORIGIN ?? "http://127.0.0.1:4520";
const TOKEN = process.env.GALLEY_TOKEN;
const SITE = process.env.GALLEY_SITE;
const OWN = process.env.OWN_SITE ?? "http://127.0.0.1:4522";
const appSteps = (process.argv.slice(2).length ? process.argv.slice(2) : ["app"]).some((s) => s !== "own");
if (appSteps && (!TOKEN || !SITE)) throw new Error("Set GALLEY_TOKEN and GALLEY_SITE (see the header of this file).");
const require = createRequire(join(process.env.PLAYWRIGHT_MODULES ?? join(here, "../node_modules"), "/"));
const { chromium } = require("playwright-core");

const VIEW = { width: 1440, height: 900 };
const SCALE = 2;
const WORK = join(tmpdir(), "galley-capture");
mkdirSync(WORK, { recursive: true });
mkdirSync(OUT, { recursive: true });

const steps = process.argv.slice(2).length ? process.argv.slice(2) : ["form", "click", "arrange", "drag", "chat", "proof", "publish", "starters"];
const HOME_PAGE = "src/content/pages/index.md";
const SITES = join(here, "../public/sites");
const SITE_DIR = process.env.SITE_DIR;
// What the captures do on the starter's home page (defaults suit Caddow, the fashion starter).
const FORM_SECTION = new RegExp(process.env.FORM_SECTION ?? "^Campaign");
const CLICK_TEXT = process.env.CLICK_TEXT ?? "Coats and knits to start with";
const ASK = process.env.ASK ?? "Change the campaign heading to “Coats for low sun.” and its first button to “See the eight looks”.";

const api = async (path, init = {}) => {
  const res = await fetch(ORIGIN + path, { ...init, headers: { authorization: `Bearer ${TOKEN}`, "content-type": "application/json", ...(init.headers ?? {}) } });
  return res.json();
};

/** PNG → WebP at the quality that keeps each capture near 150 KB. */
function toWebp(png, name, { maxWidth = 2400, quality = 80, dir = OUT, half = true } = {}) {
  mkdirSync(dir, { recursive: true });
  const out = join(dir, `${name}.webp`);
  for (const q of [quality, 72, 64, 56]) {
    execFileSync("cwebp", ["-quiet", "-q", String(q), "-m", "6", "-resize", String(maxWidth), "0", png, "-o", out]);
    if (statSync(out).size <= 160_000) break;
  }
  if (!half) return console.log(`  ${name}.webp ${(statSync(out).size / 1024).toFixed(0)} KB`);
  // A 1× copy for 1× screens; the page picks by width (srcset … 1000w, … 2000w).
  const one = join(dir, `${name}@1x.webp`);
  const w = Math.round(Number(execFileSync("webpinfo", [out], { encoding: "utf8" }).match(/(?:Canvas size|Width:)\s+(\d+)/)?.[1] ?? maxWidth) / 2);
  execFileSync("cwebp", ["-quiet", "-q", "80", "-m", "6", "-resize", String(w), "0", png, "-o", one]);
  console.log(`  ${name}.webp ${(statSync(out).size / 1024).toFixed(0)} KB (+ @1x ${(statSync(one).size / 1024).toFixed(0)} KB)`);
}

/** The union of some elements' boxes, padded, optionally grown to an aspect ratio, kept inside the viewport. */
async function clipOf(page, selectors, { pad = 0, aspect, minWidth = 0 } = {}) {
  const boxes = [];
  for (const s of [].concat(selectors)) {
    const b = typeof s === "string" ? await page.locator(s).first().boundingBox() : s;
    if (b) boxes.push(b);
  }
  if (!boxes.length) throw new Error(`nothing to clip: ${selectors}`);
  let x = Math.min(...boxes.map((b) => b.x)) - pad, y = Math.min(...boxes.map((b) => b.y)) - pad;
  let r = Math.max(...boxes.map((b) => b.x + b.width)) + pad, btm = Math.max(...boxes.map((b) => b.y + b.height)) + pad;
  if (r - x < minWidth) r = x + minWidth;
  if (aspect) {
    const w = r - x, h = btm - y;
    if (w / h > aspect) btm = y + w / aspect; else r = x + h * aspect;
  }
  x = Math.max(0, x); y = Math.max(0, y);
  r = Math.min(VIEW.width, r); btm = Math.min(VIEW.height, btm);
  return { x, y, width: r - x, height: btm - y };
}

async function hideDevToolbar(page) {
  // The site's dev server adds its own toolbar to the preview; it is not part of Galley.
  const frame = previewFrame(page);
  if (frame) await frame.addStyleTag({ content: "astro-dev-toolbar { display: none !important; }" }).catch(() => {});
}

async function shoot(page, name, clip, opts) {
  await hideDevToolbar(page);
  const png = join(WORK, `${name}.png`);
  await page.screenshot({ path: png, clip });
  toWebp(png, name, opts);
}

async function waitForPreview(page) {
  const t0 = Date.now();
  for (;;) {
    const st = await api(`/api/sites/${SITE}/preview`);
    if (st.state === "ready") break;
    if (st.state === "error" || Date.now() - t0 > 120_000) throw new Error(`preview: ${st.state} ${st.detail ?? ""}`);
    await page.waitForTimeout(1000);
  }
  await page.waitForTimeout(3500);
}

const previewFrame = (page) => page.frames().find((f) => f !== page.mainFrame() && !f.url().startsWith(ORIGIN) && /^http/.test(f.url()));

async function tool(page, label) {
  const control = page.getByRole("radio", { name: label }).or(page.getByRole("button", { name: label, exact: true })).first();
  await control.click();
  await page.waitForTimeout(1200);
}

async function openEditor(page, { form = true, assistant = true, path = HOME_PAGE } = {}) {
  await page.goto(`${ORIGIN}/sites/${SITE}/edit?path=${encodeURIComponent(path)}`, { waitUntil: "networkidle" });
  await waitForPreview(page);
  // Show or hide the side panes so each capture is about one thing.
  for (const [name, want] of [["form", form], ["assistant", assistant]]) {
    const hide = page.getByRole("button", { name: new RegExp(`^Hide ${name}`, "i") }).first();
    const show = page.getByRole("button", { name: new RegExp(`^Show ${name}`, "i") }).first();
    if (!want && (await hide.count())) await hide.click();
    if (want && (await show.count())) await show.click();
  }
  await page.waitForTimeout(1200);
}

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: VIEW, deviceScaleFactor: SCALE, colorScheme: "light", reducedMotion: "no-preference" });
await ctx.addInitScript(() => { try { localStorage.setItem("galley-theme", "light"); } catch {} });
const page = await ctx.newPage();
if (appSteps) await page.goto(`${ORIGIN}/?token=${TOKEN}`, { waitUntil: "networkidle" });

for (const step of steps) {
  console.log(`step ${step}`);

  if (step === "own") {
    // This site's own AI-first page as people see it (for the twin beside its markdown):
    // the built site served at OWN_SITE, its first screen.
    await page.goto(`${OWN}/ai-first/`, { waitUntil: "networkidle" });
    await page.addStyleTag({ content: "nav.actionbar { display: none !important; }" });
    await page.waitForTimeout(1500);
    await shoot(page, "own-ai-first", { x: 0, y: 0, width: 1440, height: 900 }, { maxWidth: 1600 });
  }

  if (step === "reset") {
    // Start from the published site: discard every pending change in the throwaway copy.
    await api(`/api/sites/${SITE}/discard`, { method: "POST", body: JSON.stringify({}) });
  }

  if (step === "site" || step === "looks") {
    // The example site itself, as visitors see it: through the preview, before any change.
    await openEditor(page, { form: false, assistant: false });
    // The site's own dev server (the preview proxy only answers inside the app).
    const { log } = await api(`/api/sites/${SITE}/preview`);
    const url = [...log].reverse().join("\n").match(/Local\s+(http:\/\/[^\s/]+)/)?.[1];
    if (!url) throw new Error("No dev server address in the preview log.");
    const shots = await browser.newContext({ viewport: { width: 1100, height: 900 }, deviceScaleFactor: step === "site" ? 2 : 1, colorScheme: "light", reducedMotion: "reduce" });
    const view = await shots.newPage();
    // The dev server's own toolbar is not part of the site.
    await view.addInitScript(() => addEventListener("DOMContentLoaded", () => { const st = document.createElement("style"); st.textContent = "astro-dev-toolbar { display: none !important; }"; document.head.append(st); }));
    if (step === "site") {
      // The home page's first screen at 2×, shown 860 px wide on the home page.
      await view.goto(url + "/", { waitUntil: "networkidle" });
      await view.waitForTimeout(2500);
      const png = join(WORK, "site.png");
      await view.screenshot({ path: png });
      toWebp(png, "caddow-home", { dir: SITES, maxWidth: 1720 });
    } else {
      // The whole top of the home page in each of the starter's looks (starter.json),
      // switched the way the starter says: its theme file copied over tokens.css.
      if (!SITE_DIR) throw new Error("Set SITE_DIR for the looks step.");
      await view.setViewportSize({ width: 1280, height: 800 });
      const meta = JSON.parse(readFileSync(join(SITE_DIR, "starter.json"), "utf8"));
      const tokens = join(SITE_DIR, "src/styles/tokens.css");
      const original = readFileSync(tokens);
      try {
        for (const look of meta.looks) {
          writeFileSync(tokens, readFileSync(join(SITE_DIR, look.file)));
          await page.waitForTimeout(2500);
          await view.goto(url + "/", { waitUntil: "networkidle" });
          await view.evaluate(async () => { for (let y = 0; y < 3200; y += 400) { scrollTo(0, y); await new Promise((r) => setTimeout(r, 120)); } scrollTo(0, 0); });
          await view.waitForTimeout(2000);
          const png = join(WORK, `look-${look.id}.png`);
          await view.screenshot({ path: png, fullPage: true, clip: { x: 0, y: 0, width: 1280, height: 2900 } });
          toWebp(png, `caddow-tall-${look.id}`, { dir: SITES, maxWidth: 1280, quality: 74, half: false });
        }
      } finally {
        writeFileSync(tokens, original);
      }
    }
    await shots.close();
  }

  if (step === "source") {
    // Proof › Source: the same change as lines of the page's file.
    await page.goto(`${ORIGIN}/sites/${SITE}/proof`, { waitUntil: "networkidle" });
    await page.waitForTimeout(2000);
    await page.getByRole("tab", { name: "Source" }).first().click();
    await page.waitForTimeout(2500);
    await shoot(page, "proof-source", await clipOf(page, [".proof-detail__head", ".proof-detail__panel > *:first-child"], { pad: 8, aspect: 16 / 10 }), { maxWidth: 2000 });
  }

  if (step === "wordpress") {
    // "Bring your WordPress site" on a second throwaway site: the plan (step 2), then the report (step 4).
    const WP_SITE = process.env.WP_SITE, WP_URL = process.env.WP_URL;
    if (!WP_SITE || !WP_URL) throw new Error("Set WP_SITE and WP_URL for the wordpress step.");
    await page.setViewportSize({ width: 1440, height: 1100 });
    await page.goto(`${ORIGIN}/sites/${WP_SITE}/import`, { waitUntil: "networkidle" });
    await page.waitForTimeout(1500);
    const address = page.getByRole("textbox").first();
    await address.fill(WP_URL);
    await page.keyboard.press("Enter");
    // Step 1 checks the address; continue to the plan.
    for (let i = 0; i < 40 && !(await page.getByText(/Here’s what comes across/).count()); i++) {
      const next = page.getByRole("button", { name: /^(Continue|Next|See what comes across)/ }).first();
      if (await next.count() && await next.isEnabled()) await next.click().catch(() => {});
      await page.waitForTimeout(1000);
    }
    await page.waitForTimeout(1500);
    const main = await page.locator("main").first().boundingBox();
    const col = await page.locator("h1").first().boundingBox();
    await shoot(page, "wordpress-plan", { x: Math.max(main.x, col.x - 40), y: col.y - 96, width: Math.min(1000, main.x + main.width - (col.x - 40)), height: 1100 - (col.y - 96) }, { maxWidth: 2000 });
    await page.getByRole("button", { name: /^Bring over/ }).first().click();
    for (let i = 0; i < 180 && !(await page.getByText(/Your WordPress site is here/).count()); i++) {
      const report = page.getByRole("button", { name: /report/i }).first();
      if (await report.count()) await report.click().catch(() => {});
      await page.waitForTimeout(1000);
    }
    await page.waitForTimeout(1500);
    await page.evaluate(() => scrollTo(0, 0));
    const col2 = await page.locator("h1").first().boundingBox();
    await shoot(page, "wordpress-report", { x: Math.max(main.x, col2.x - 40), y: col2.y - 96, width: Math.min(1000, main.x + main.width - (col2.x - 40)), height: 1100 - (col2.y - 96) }, { maxWidth: 2000 });
    await page.setViewportSize(VIEW);
  }

  if (step === "form") {
    // The form beside the page: fields made from the content, the section list.
    await openEditor(page, { assistant: false });
    await tool(page, "Click to edit");
    const sections = page.getByRole("button", { name: FORM_SECTION }).first();
    if (await sections.count()) { await sections.click(); await page.waitForTimeout(800); }
    await shoot(page, "form", await clipOf(page, [".app-editor"], { aspect: 16 / 10 }), { maxWidth: 2000 });
    await openEditor(page);
  }

  if (step === "click") {
    // Click the words on the page and retype them in place.
    await openEditor(page, { form: false, assistant: false });
    await tool(page, "Click to edit");
    const frame = previewFrame(page);
    // A heading with no formatting inside, so it is retyped in place.
    const target = frame.locator(process.env.CLICK_TARGET ?? "main h2:not(:has(em))").nth(Number(process.env.CLICK_INDEX ?? 1));
    await target.evaluate((el) => scrollTo(0, el.getBoundingClientRect().top + scrollY - 200));
    await page.waitForTimeout(800);
    await target.hover();
    await page.waitForTimeout(900);
    await shoot(page, "click-hover", await clipOf(page, [".preview"], { aspect: 16 / 10 }), { maxWidth: 2000 });
    await target.click();
    await page.waitForTimeout(700);
    await page.keyboard.press("ControlOrMeta+A");
    await page.keyboard.type(CLICK_TEXT, { delay: 30 });
    await page.waitForTimeout(500);
    await shoot(page, "click", await clipOf(page, [".preview"], { aspect: 16 / 10 }), { maxWidth: 2000 });
    await page.keyboard.press("Enter");
    await page.waitForTimeout(1500);
  }

  if (step === "arrange") {
    // Arrange: the section library beside the page, one section selected.
    await openEditor(page, { form: false, assistant: false });
    await tool(page, "Arrange");
    const frame = previewFrame(page);
    const sec = frame.locator("[data-galley-block]").nth(2);
    await sec.scrollIntoViewIfNeeded();
    const sb = await sec.boundingBox();
    await sec.click({ position: { x: Math.max(40, sb.width - 120), y: 60 } });
    await page.waitForTimeout(1200);
    await shoot(page, "arrange", await clipOf(page, [".preview"], { aspect: 16 / 10 }), { maxWidth: 2000 });
  }

  if (step === "drag") {
    // A short recording: drag a section from the library onto the page.
    await openEditor(page, { form: false, assistant: false });
    await tool(page, "Arrange");
    const frames = join(WORK, "drag");
    rmSync(frames, { recursive: true, force: true });
    mkdirSync(frames);
    const clip = await clipOf(page, [".preview"], { aspect: 16 / 10 });
    let n = 0;
    await hideDevToolbar(page);
    const grab = async (count = 1) => { for (let i = 0; i < count; i++) await page.screenshot({ path: join(frames, `${String(n++).padStart(4, "0")}.jpg`), clip, type: "jpeg", quality: 92 }); };
    // Bring the line between the first two sections to the middle of the page, then drop a section on it.
    const frame = previewFrame(page);
    await frame.evaluate(() => {
      const second = document.querySelectorAll("[data-galley-block]")[1];
      window.scrollTo(0, second.getBoundingClientRect().top + window.scrollY - window.innerHeight * 0.55);
    });
    await page.waitForTimeout(1200);
    const frameEl = await page.locator("iframe.preview-sheet__iframe").first().boundingBox();
    const gapY = await frame.evaluate(() => document.querySelectorAll("[data-galley-block]")[1].getBoundingClientRect().top);
    // Find the section type to drop (it arrives empty, so pick one that reads well without content).
    const find = page.getByRole("searchbox", { name: /Find a section type/i }).or(page.getByPlaceholder(/Find a section type/i)).first();
    if (process.env.DRAG_TYPE !== "") { await find.fill(process.env.DRAG_TYPE ?? "Newsletter"); await page.waitForTimeout(600); }
    const card = page.locator(".builder-panel__add [role=option]").first();
    const from = await card.boundingBox();
    await grab(8);
    await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2, { steps: 4 });
    await grab(4);
    await page.mouse.down();
    const to = { x: frameEl.x + frameEl.width * 0.5, y: frameEl.y + gapY + 6 };
    for (let i = 1; i <= 22; i++) {
      await page.mouse.move(from.x + (to.x - from.x) * (i / 22), from.y + (to.y - from.y) * (i / 22));
      await grab();
    }
    await grab(8);
    await page.mouse.up();
    for (let i = 0; i < 30; i++) { await page.waitForTimeout(100); await grab(); }
    await grab(10);
    const ff = process.env.FFMPEG ?? findPlaywrightFfmpeg();
    const webm = join(OUT, "arrange-drag.webm");
    // Playwright's own ffmpeg reads an image2pipe stream from a file (it has no pipe protocol).
    const stream = join(WORK, "drag.pngs");
    writeFileSync(stream, Buffer.concat(readdirSync(frames).filter((f) => f.endsWith(".jpg")).sort().map((f) => readFileSync(join(frames, f)))));
    execFileSync(ff, ["-y", "-loglevel", "error", "-framerate", "10", "-f", "image2pipe", "-c:v", "mjpeg", "-i", stream, ...(vp9(ff) ? ["-c:v", "libvpx-vp9", "-b:v", "0", "-crf", "38", "-row-mt", "1"] : ["-c:v", "libvpx", "-b:v", "900k", "-crf", "12", "-auto-alt-ref", "0"]), "-vf", "scale=1280:-2", webm]);
    toWebp(join(frames, "0000.jpg"), "arrange-drag-poster", { maxWidth: 1280 });
    console.log(`  arrange-drag.webm ${(statSync(webm).size / 1024).toFixed(0)} KB`);
    // Leave the page as it was: drop the section that was added.
    await api(`/api/sites/${SITE}/discard`, { method: "POST", body: JSON.stringify({ paths: [HOME_PAGE] }) }).catch(() => {});
  }

  if (step === "assistant") {
    // One real request to the assistant (costs money: run deliberately).
    await openEditor(page);
    const composer = page.getByPlaceholder(/Ask for a change/i).first();
    await composer.click();
    await composer.fill(ASK);
    await composer.press("Enter");
    const t0 = Date.now();
    for (;;) {
      await page.waitForTimeout(1500);
      const { threads } = await api(`/api/sites/${SITE}/threads`);
      const t = threads?.[0];
      if (t && !t.busy && t.messageCount >= 2) break;
      if (Date.now() - t0 > 180_000) throw new Error("assistant took too long");
    }
    await page.waitForTimeout(3000);
  }

  if (step === "chat") {
    // The assistant's reply beside the page it changed.
    await openEditor(page, { form: false });
    const { threads } = await api(`/api/sites/${SITE}/threads`);
    if (threads?.length) {
      const open = page.getByRole("button", { name: /history|threads|conversations/i }).first();
      if (!(await page.locator(".g-chat .g-msg--user").count()) && (await open.count())) {
        await open.click();
        await page.waitForTimeout(600);
        await page.getByText(threads[0].title ?? "", { exact: false }).first().click().catch(() => {});
        await page.waitForTimeout(1500);
      }
    }
    const chat = page.locator(".g-chat").first();
    const prev = await page.locator(".preview").first().boundingBox();
    const chatBox = await chat.boundingBox();
    await shoot(page, "assistant", await clipOf(page, [{ x: prev.x + prev.width * 0.35, y: prev.y, width: prev.width * 0.65, height: prev.height }, chatBox], { aspect: 16 / 10 }), { maxWidth: 2000 });
  }

  if (step === "proof") {
    // Proof: what changed, in content terms; then the live site beside the proposed one.
    await page.goto(`${ORIGIN}/sites/${SITE}/proof`, { waitUntil: "networkidle" });
    await page.waitForTimeout(2500);
    await shoot(page, "proof-changes", await clipOf(page, [".proof-detail__head", ".proof-detail__panel .g-card, .proof-detail__panel > *:first-child"], { pad: 8, aspect: 16 / 10 }), { maxWidth: 2000 });
    await page.getByRole("tab", { name: "On the page" }).first().click();
    await page.waitForTimeout(7000);
    await shoot(page, "proof-split", await clipOf(page, [".proof-detail"], { aspect: 16 / 10 }), { maxWidth: 2200 });
  }

  if (step === "publish") {
    await page.goto(`${ORIGIN}/sites/${SITE}/proof`, { waitUntil: "networkidle" });
    await page.waitForTimeout(1500);
    await page.getByRole("button", { name: "Publish", exact: true }).first().click();
    await page.waitForTimeout(1500);
    await shoot(page, "publish", await clipOf(page, ["dialog[open]"], { pad: 32 }), { maxWidth: 1600 });
    await page.keyboard.press("Escape");
  }

  if (step === "starters") {
    // The new-site wizard's starter step: the starters and their looks.
    await page.goto(`${ORIGIN}/new`, { waitUntil: "networkidle" });
    await page.getByLabel(/Site name/i).fill("Harbour Dental");
    await page.getByRole("button", { name: "Continue" }).click();
    await page.waitForTimeout(2500);
    await shoot(page, "wizard-starters", await clipOf(page, [".wizard-steps", ".wizard-sheet"], { pad: 40 }), { maxWidth: 1800 });
  }
}

await browser.close();
rmSync(WORK, { recursive: true, force: true });

function vp9(bin) {
  try { return execFileSync(bin, ["-hide_banner", "-encoders"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).includes("libvpx-vp9"); } catch { return false; }
}
function findPlaywrightFfmpeg() {
  const root = join(homedir(), "Library/Caches/ms-playwright");
  const dirs = existsSync(root) ? readdirSync(root).filter((d) => d.startsWith("ffmpeg-")).sort().reverse() : [];
  // Playwright's builds differ: take one that can encode VP8.
  for (const d of dirs) for (const f of ["ffmpeg-mac", "ffmpeg-linux", "ffmpeg-win64.exe"]) {
    const bin = join(root, d, f);
    if (!existsSync(bin)) continue;
    try { if (execFileSync(bin, ["-hide_banner", "-encoders"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).includes("libvpx")) return bin; } catch {}
  }
  return "ffmpeg";
}
