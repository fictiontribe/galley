// Captures the product screenshots, the docs pictures and the how-to sequences
// used on the marketing site from a real, running Galley — so they can be
// refreshed in one command when the app changes. Every file it writes is
// listed in ../screens.json; the how-to sequences are also recorded, step by
// step, in ../src/data/howto.json (written by this script).
//
//   GALLEY_ORIGIN=http://127.0.0.1:4790 GALLEY_TOKEN=… GALLEY_SITE=<Caddow's id> \
//   SITE_DIR=<the Caddow copy's folder> WP_SITE=<Lowfield's id> WP_URL=http://127.0.0.1:4792 \
//   CF_KEY=<the key the stand-in Cloudflare prints> \
//   PLAYWRIGHT_MODULES=<a node_modules folder with playwright-core> \
//   node scripts/capture-screens.mjs [step …]
//
// scripts/capture/README.md says how to start everything it talks to: the
// released Galley on throwaway copies of two starters (Caddow, Lowfield), with
// a throwaway home, the stand-in Cloudflare and the stand-in WordPress site.
// Every step makes real changes to those copies — it publishes, and puts
// Caddow "online" on the stand-in host — so start from fresh copies.
//
// With no step named, the whole session runs in order (ALL below). The steps
// "brand", "ask-journal" and "ask" make real assistant requests (about $0.50
// together, billed to the ANTHROPIC_API_KEY the Galley server was started
// with); everything else costs nothing. A few steps re-make one picture from
// the state an earlier step left: brand-saved, click-doc, which-one,
// assistant-reply, chat, media-generate, publish-doc, undo-doc.
//
// Output (2× device scale, light theme, WebP with a 1× copy <name>@1x.webp):
//   public/screens/<name>.webp   showcase captures (and the arrange-drag recording, WebM)
//   public/docs/<name>.webp      the docs pages' pictures, at the exact size each page declares
//   public/howto/<slug>-<n>.webp the how-to steps; their words go to src/data/howto.json
// Captures of the example site itself ("site", "looks") go to public/sites/.
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { homedir, tmpdir } from "node:os";

const here = dirname(fileURLToPath(import.meta.url));
const OUT = join(here, "../public/screens");
const DOCS = join(here, "../public/docs");
const HOWTO = join(here, "../public/howto");
const HOWTO_JSON = join(here, "../src/data/howto.json");
const ORIGIN = process.env.GALLEY_ORIGIN ?? "http://127.0.0.1:4790";
const TOKEN = process.env.GALLEY_TOKEN;
const SITE = process.env.GALLEY_SITE;
const OWN = process.env.OWN_SITE ?? "http://127.0.0.1:4522";
const require = createRequire(join(process.env.PLAYWRIGHT_MODULES ?? join(here, "../node_modules"), "/"));
const { chromium } = require("playwright-core");

const VIEW = { width: 1440, height: 900 };
const SCALE = 2;
const WORK = join(tmpdir(), "galley-capture");
mkdirSync(WORK, { recursive: true });
mkdirSync(OUT, { recursive: true });

// The whole session, in the order it has to happen (see the header).
const ALL = [
  "setup",
  // History first: each of these is published as Tobiah Rusk.
  "analytics", "bulk-redirects", "add-form", "brand", "search-ai",
  // The WordPress move, on the second site (left waiting in Proof there).
  "wordpress",
  // On a page with no changes waiting (each puts its page back afterwards).
  "arrange", "drag", "build-page",
  // The three changes every showcase capture shares: the atelier (form), the home page (on the page and
  // the assistant), the journal (the assistant).
  "change-page", "click", "ask-journal", "ask",
  "showcase", "form", "proof", "source",
  // Then publishing (and the undo window), and going online on the stand-in host.
  "publish", "online",
  // The hosted editor: "Host the editor online" against the stand-in Fly.io, and a hosted install's first screens.
  "editor-online", "hosted",
];
const steps = process.argv.slice(2).length ? process.argv.slice(2) : ALL;
const appSteps = steps.some((s) => s !== "own");
if (appSteps && (!TOKEN || !SITE)) throw new Error("Set GALLEY_TOKEN and GALLEY_SITE (see the header of this file).");

const HOME_PAGE = "src/content/pages/index.md";
const ATELIER = "src/content/pages/atelier.md";
const JOURNAL = "src/content/pages/journal.md";
const SITES = join(here, "../public/sites");
const SITE_DIR = process.env.SITE_DIR;
const AUTHOR = { name: "Tobiah Rusk", email: "tobiah@caddow.example" };
// What the captures do on the starter's pages (defaults suit Caddow, the fashion starter).
const FORM_SECTION = new RegExp(process.env.FORM_SECTION ?? "^Campaign");
const CLICK_TEXT = process.env.CLICK_TEXT ?? "Coats and knits to start with";
const ASK = process.env.ASK ?? "Change the campaign heading to “Coats for low sun.” and its first button to “See the eight looks”.";
const ASK_JOURNAL = process.env.ASK_JOURNAL ?? "Change the journal page's heading to “Notes from the workroom”.";
const GA_ID = "G-7K2M4Q9XRB";

// The docs pages declare each picture's size (width/height = half the 2× file);
// a refreshed picture must keep it, so these are the CSS sizes they are cut to.
const DOC_SIZE = {
  arrange: [1044, 636], "assistant-reply": [590, 310], brand: [1114, 685], "editor-overview": [1440, 900],
  "form-builder": [1208, 832], "form-field-edited": [362, 115], history: [964, 353], inbox: [1125, 750],
  "media-generate": [960, 701], "on-the-page-click-to-edit": [756, 547], "on-the-page-which-one": [429, 267],
  "online-setup": [680, 347], "proof-what-changed": [870, 260], "publish-dialog": [520, 473],
  "redirects-add-many": [960, 727], "redirects-list": [1122, 515], "scripts-add-ga4": [680, 409],
  "search-and-ai": [1118, 615], sites: [1160, 560], "undo-publish-dialog": [440, 223], "wordpress-report": [800, 710],
};

const api = async (path, init = {}) => {
  const res = await fetch(ORIGIN + path, { ...init, headers: { authorization: `Bearer ${TOKEN}`, "content-type": "application/json", ...(init.headers ?? {}) } });
  const text = await res.text();
  try { return JSON.parse(text); } catch { return { status: res.status, text }; }
};
const publishNow = (message, paths) => api(`/api/sites/${SITE}/publish`, { method: "POST", body: JSON.stringify({ message, ...(paths ? { paths } : {}) }) });
const discard = (paths) => api(`/api/sites/${SITE}/discard`, { method: "POST", body: JSON.stringify(paths ? { paths } : {}) });
/** Discard every pending change under a folder (discard itself takes file paths). */
async function discardUnder(prefix) {
  const { files = [] } = await api(`/api/sites/${SITE}/changes`);
  const paths = files.map((f) => f.path).filter((p) => p.startsWith(prefix));
  if (paths.length) await discard(paths);
}

// ── pictures ────────────────────────────────────────────────────────────────

const pngWidth = (file) => readFileSync(file).readUInt32BE(16);
function webpWidth(file) {
  const b = readFileSync(file);
  const chunk = b.toString("ascii", 12, 16);
  if (chunk === "VP8X") return 1 + b.readUIntLE(24, 3);
  if (chunk === "VP8 ") return b.readUInt16LE(26) & 0x3fff;
  return (b.readUInt32LE(21) & 0x3fff) + 1;
}
const cwebp = (png, out, q, width) => execFileSync("cwebp", ["-quiet", "-q", String(q), "-m", "6", ...(width ? ["-resize", String(width), "0"] : []), png, "-o", out]);

/**
 * PNG → WebP, kept under `max` bytes: the quality comes down first (down to
 * 46, still crisp for interface text); only then, unless the size is fixed
 * (`exact`, the docs pictures), the picture is made smaller.
 */
function toWebp(png, name, { dir = OUT, max = 160_000, exact = false, half = true, maxWidth, size } = {}) {
  mkdirSync(dir, { recursive: true });
  const out = join(dir, `${name}.webp`);
  const natural = pngWidth(png);
  let width = maxWidth && natural > maxWidth ? maxWidth : 0;
  let done = false;
  while (!done) {
    for (const q of [82, 76, 70, 64, 58, 52, 46]) {
      if (size) execFileSync("cwebp", ["-quiet", "-q", String(q), "-m", "6", "-resize", String(size[0]), String(size[1]), png, "-o", out]);
      else cwebp(png, out, q, width);
      if (statSync(out).size <= max) { done = true; break; }
    }
    if (done || exact || (width || natural) < 1200) break;
    width = Math.round((width || natural) * 0.92);
  }
  if (statSync(out).size > max) console.warn(`  ! ${name}.webp is ${(statSync(out).size / 1024).toFixed(0)} KB, over ${max / 1000} KB`);
  if (!half) return console.log(`  ${name}.webp ${(statSync(out).size / 1024).toFixed(0)} KB`);
  // A 1× copy for 1× screens; the page picks by width (srcset … 1000w, … 2000w).
  const one = join(dir, `${name}@1x.webp`);
  cwebp(png, one, 80, Math.round(webpWidth(out) / 2));
  console.log(`  ${name}.webp ${webpWidth(out)} px ${(statSync(out).size / 1024).toFixed(0)} KB (+ @1x ${(statSync(one).size / 1024).toFixed(0)} KB)`);
}

const box = async (page, selector) => {
  const b = await (typeof selector === "string" ? page.locator(selector).first() : selector).boundingBox();
  if (!b) throw new Error(`not on screen: ${selector}`);
  return b;
};

/** The union of some elements' boxes, padded, optionally grown to an aspect ratio, kept inside the viewport. */
async function clipOf(page, selectors, { pad = 0, aspect, minWidth = 0 } = {}) {
  const boxes = [];
  for (const s of [].concat(selectors)) {
    const b = typeof s === "string" ? await page.locator(s).first().boundingBox() : typeof s?.boundingBox === "function" ? await s.boundingBox() : s;
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
  return { x: Math.round(x), y: Math.round(y), width: Math.round(r - x), height: Math.round(btm - y) };
}

/** A rectangle of exactly w × h CSS px at (x, y), moved (not shrunk) to stay inside the window (or above `bottom`). */
function exact(x, y, w, h, bottom = VIEW.height) {
  x = Math.round(Math.min(Math.max(0, x), VIEW.width - w));
  y = Math.round(Math.min(Math.max(0, y), bottom - h));
  return { x, y, width: w, height: h };
}
// The app's status bar along the bottom: crops of one part of a screen stop above it.
const ABOVE_STATUS = VIEW.height - 25;

/**
 * A how-to step's crop: the elements plus generous room around them, 16:10,
 * at least `min` CSS px wide (so it reads at half-width) and centred on them,
 * kept inside the window.
 */
async function focus(page, selectors, { pad = 32, min = 900, max = 1200 } = {}) {
  const u = await clipOf(page, selectors, { pad });
  let w = Math.min(Math.max(u.width, min, u.height * 1.6), Math.max(max, u.width));
  let h = Math.max(u.height, w / 1.6);
  if (h > ABOVE_STATUS) h = ABOVE_STATUS;
  if (w > VIEW.width) w = VIEW.width;
  const cx = u.x + u.width / 2, cy = u.y + u.height / 2;
  return exact(cx - w / 2, cy - h / 2, Math.round(w), Math.round(h), ABOVE_STATUS);
}
const FULL = { x: 0, y: 0, width: VIEW.width, height: VIEW.height };

async function hideDevToolbar(page) {
  // The site's dev server adds its own toolbar to the preview; it is not part of Galley.
  for (const frame of page.frames()) if (frame !== page.mainFrame() && !frame.url().startsWith(ORIGIN)) await frame.addStyleTag({ content: "astro-dev-toolbar { display: none !important; }" }).catch(() => {});
}

async function shoot(page, name, clip, opts = {}) {
  await hideDevToolbar(page);
  // The pointer is parked out of the way (hover states aside) — except mid-drag, where moving it would drop.
  if (!opts.keepPointer) await page.mouse.move(VIEW.width - 2, VIEW.height - 40).catch(() => {});
  const png = join(WORK, `${name}.png`);
  await page.screenshot({ path: png, clip });
  toWebp(png, name, opts);
}

/**
 * A docs page's picture: cut to the size the page declares, at most 120 KB.
 * With `wider`, a slightly larger area of the same shape is cut and brought
 * down to that size (for a screen that doesn't quite fit the declared frame).
 */
async function docShot(page, name, x, y, wider) {
  const [w, h] = DOC_SIZE[name];
  if (!wider) return shoot(page, name, exact(x, y, w, h), { dir: DOCS, max: 120_000, exact: true });
  await shoot(page, name, exact(x, y, wider, Math.round((wider * h) / w)), { dir: DOCS, max: 120_000, exact: true, size: [w * SCALE, h * SCALE] });
}

// ── how-to sequences (written to src/data/howto.json) ──────────────────────────

const GUIDES = [
  ["change-a-page", "Change a page in the form", "Retype any words on a page in its form and see the change on the page before anyone else does.", "/docs/editing/form/"],
  ["edit-on-the-page", "Change text on the page", "Click the words on the page itself and type over them, without hunting for the right field.", "/docs/editing/on-the-page/"],
  ["ask-the-assistant", "Ask the assistant for a change", "Say what you want in plain words; the assistant makes the change and tells you exactly what it did.", "/docs/editing/assistant/", "The assistant connected (an Anthropic key in App settings)."],
  ["proof-and-publish", "Check, publish and undo", "See every change before it goes live, keep only the ones you want, and take a publish back if you need to.", "/docs/editing/proof-and-publish/"],
  ["build-a-page", "Build a page from sections", "Put a page together from the site's own sections, on the page itself.", "/docs/editing/page-builder/"],
  ["add-a-form", "Make a form and read the answers", "Change a form's fields, choose where the answers go, and read them in the Inbox.", "/docs/editing/forms/"],
  ["add-analytics", "Add Google Analytics", "Count visits with Google Analytics 4, loaded only once visitors agree to it.", "/docs/editing/scripts/"],
  ["set-up-brand", "Set up the brand", "Write the site's colours, type and voice down once, so every change fits the rest.", "/docs/editing/brand/", "The assistant connected for the voice guide and for reading your material (colours and type are measured without it)."],
  ["bulk-redirects", "Add many redirects at once", "Paste a whole list of old addresses and let the checks catch the mistakes before any visitor does.", "/docs/editing/redirects/"],
  ["search-and-ai", "Check how search and AI see the site", "Find what search engines and AI assistants trip over, fix it, and choose which AI crawlers may visit.", "/docs/editing/search-and-ai/"],
  ["put-online", "Put the site online", "Give the site a real address on Cloudflare, then your own domain.", "/docs/editing/online/", "A Cloudflare account and an access key from it."],
  ["move-from-wordpress", "Bring a site over from WordPress", "Move a WordPress site's posts, pages and images into this site, checked before anything goes live.", "/docs/editing/wordpress/"],
];
const guides = new Map(GUIDES.map(([slug, title, summary, guide, needs]) => [slug, { slug, title, summary, guide, ...(needs ? { needs } : {}), steps: [] }]));
const touched = new Set();

/** One how-to step: its picture (public/howto/<slug>-<n>.webp) and its words. */
async function howto(page, slug, n, clip, words) {
  const g = guides.get(slug);
  if (!g) throw new Error(`no such how-to: ${slug}`);
  if (n === 1) g.steps = [];
  await shoot(page, `${slug}-${n}`, clip, { dir: HOWTO });
  g.steps[n - 1] = { image: `howto/${slug}-${n}`, ...words };
  touched.add(slug);
}

function writeHowto() {
  if (!touched.size) return;
  // Keep the guides this run didn't make (a partial run updates only its own).
  let previous = [];
  try { previous = JSON.parse(readFileSync(HOWTO_JSON, "utf8")).guides ?? []; } catch {}
  const list = GUIDES.map(([slug]) => {
    const old = previous.find((g) => g.slug === slug);
    if (!touched.has(slug)) return old;
    // A run that re-made only some steps keeps the others from the file; a guide with a gap is left out.
    const g = guides.get(slug);
    g.steps = Array.from({ length: Math.max(g.steps.length, old?.steps?.length ?? 0) }, (_, i) => g.steps[i] ?? old?.steps?.[i] ?? null);
    return g.steps.every(Boolean) ? g : old;
  }).filter(Boolean);
  mkdirSync(dirname(HOWTO_JSON), { recursive: true });
  writeFileSync(HOWTO_JSON, `${JSON.stringify({
    about: "How-to sequences captured from the running app. Written by scripts/capture-screens.mjs; the wording of do/see may be polished by hand, the facts may not.",
    captured: `${new Date().toLocaleDateString("sv")}, Galley ${appVersion}`,
    guides: list,
  }, null, 2)}\n`);
  console.log(`  howto.json: ${list.length} guides`);
}

// ── the app ──────────────────────────────────────────────────────────────────

async function go(page, path, wait = 2000) {
  await page.goto(ORIGIN + path, { waitUntil: "networkidle" });
  await page.waitForTimeout(wait);
}

async function waitForPreview(page) {
  const t0 = Date.now();
  for (;;) {
    const st = await api(`/api/sites/${SITE}/preview`);
    if (st.state === "ready") break;
    if (st.state === "error" || Date.now() - t0 > 180_000) throw new Error(`preview: ${st.state} ${st.detail ?? ""}`);
    if (st.state === "stopped" || st.state === "idle") await api(`/api/sites/${SITE}/preview/start`, { method: "POST" });
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
  await page.waitForTimeout(1500);
}

/** Wait until `fn` is true (checked every second), or fail after `ms`. */
async function until(page, what, fn, ms = 120_000) {
  const t0 = Date.now();
  while (!(await fn())) {
    if (Date.now() - t0 > ms) throw new Error(`gave up waiting for ${what}`);
    await page.waitForTimeout(1000);
  }
}

/** The brand just saved: the screen once the save is done (its message closed), Proof counting the brand's files. */
async function brandSaved() {
  await go(page, `/sites/${SITE}/brand`, 3000);
  await page.evaluate(() => document.querySelector("main h1")?.scrollIntoView({ block: "end" }));
  await page.waitForTimeout(800);
  await howto(page, "set-up-brand", 5, FULL, {
    alt: "The saved brand for Caddow: The site’s look and voice. The assistant works inside it. A note says 3 new files to read, with Read them; Proof in the top bar counts 6 changes — the brand and its material — and the colours follow below.",
    do: "Press **Save the brand**.",
    see: "The brand is written into the site as changes waiting in Proof; publish them to keep it. From then on the assistant writes in the site's voice and uses its colours by name.",
  });
}

/** Search & AI: wait until a run of the checks is over and its summary is shown. */
async function checksDone(page) {
  await until(page, "the checks", async () => (await page.getByText(/^Checked \d+ entries/).count()) > 0 && !(await page.getByRole("button", { name: /Checking…/ }).count()), 300_000);
  await page.waitForTimeout(1500);
}

/** Close the app's messages (toasts) so they don't sit over a capture. */
async function dismissToasts(page) {
  for (const b of await page.getByRole("button", { name: "Dismiss" }).all()) await b.click().catch(() => {});
  await page.waitForTimeout(600);
}

/** The docs' Click to edit picture: the top of the home page, its campaign heading outlined with its tag. */
async function clickToEditDoc(page) {
  await hideDevToolbar(page);
  const frame = previewFrame(page);
  await frame.evaluate(() => scrollTo(0, 0));
  await page.waitForTimeout(800);
  await frame.locator("[data-galley-block]").first().locator("h1, h2").first().hover();
  await page.waitForTimeout(900);
  const pv = await box(page, ".preview");
  await shoot(page, "on-the-page-click-to-edit", exact(pv.x, pv.y + 80, 756, 547), { dir: DOCS, max: 120_000, exact: true, keepPointer: true });
}

/**
 * The docs' assistant reply: the journal conversation reopened from Chats in a narrower window with the
 * preview hidden, so the pane is about as wide as the docs picture (590 px).
 */
async function assistantReplyDoc(page) {
  await openEditor(page, { path: JOURNAL, form: false, assistant: true });
  await page.setViewportSize({ width: 746, height: VIEW.height });
  const hidePreview = page.getByRole("button", { name: /^Hide preview/i }).first();
  if (await hidePreview.count()) await hidePreview.click();
  await page.getByRole("button", { name: "Chats" }).click();
  await page.waitForTimeout(1000);
  await page.getByText(/journal page's heading/).first().click();
  await page.waitForTimeout(2500);
  const c = await box(page, ".g-chat");
  await shoot(page, "assistant-reply", { x: Math.round(c.x - 10), y: Math.round(c.y - 8), width: 590, height: 310 }, { dir: DOCS, max: 120_000, exact: true });
  await page.setViewportSize(VIEW);
  const showPreview = page.getByRole("button", { name: /^Show preview/i }).first();
  if (await showPreview.count()) await showPreview.click();
  await page.waitForTimeout(1000);
}

/** The docs' Generate an image window with two placeholder pictures made (nothing saved). */
async function mediaGenerateDoc(page) {
  await page.getByRole("button", { name: "Generate an image" }).click();
  await page.waitForTimeout(1500);
  await page.getByRole("dialog").getByRole("textbox").first().fill("A wool coat on an iron hook against a lime-washed wall, low sun, long shadow");
  await page.getByRole("button", { name: /^Make images?/ }).click();
  await until(page, "the candidates", async () => (await page.getByRole("button", { name: "Save to media" }).count()) > 0, 120_000);
  await page.waitForTimeout(2500);
  const gen = await box(page, "dialog[open], [role=dialog]");
  const [w, h] = DOC_SIZE["media-generate"];
  // The whole window, from its title to Save to media: a slightly larger area brought down to the docs' size.
  const tall = Math.min(gen.height, VIEW.height);
  const wide = Math.max(w, Math.ceil((tall * w) / h));
  await docShot(page, "media-generate", gen.x - (wide - gen.width) / 2, gen.y, wide > w ? wide : undefined);
  await page.keyboard.press("Escape");
  await page.waitForTimeout(800);
}

/** A docs picture of a whole window (dialog): an area of the declared shape around it, brought to the declared size. */
async function docDialog(page, name) {
  const d = await box(page, "dialog[open]");
  const [w, h] = DOC_SIZE[name];
  const wide = Math.max(w, Math.ceil((d.height * w) / h), Math.ceil(d.width));
  const tall = Math.round((wide * h) / w);
  await docShot(page, name, d.x - (wide - d.width) / 2, d.y - (tall - d.height) / 2, wide > w ? wide : undefined);
}

/** Click to edit on words that come from two places (the footer's Atelier): "Which one did you mean?" */
async function whichOne(page) {
    // Words that appear in two places: the footer's Atelier link is also in the header menu.
    const frame = previewFrame(page);
    const atelier = frame.locator("footer a").filter({ hasText: /^Atelier$/i }).first();
    await atelier.evaluate((e) => e.scrollIntoView({ block: "center" }));
    await page.waitForTimeout(800);
    await atelier.click();
    await page.waitForTimeout(1500);
    const ask = await box(page, page.getByText("Which one did you mean?"));
    await docShot(page, "on-the-page-which-one", ask.x - 39, ask.y - 80);
    const wf = await focus(page, [page.getByText("Which one did you mean?"), atelier], { min: 900 });
    await howto(page, "edit-on-the-page", 4, { ...wf, x: Math.max(wf.x, 268) }, {
      alt: "The word Atelier in the Caddow footer, outlined, with a small window under it: Which one did you mean? This text appears in 2 places — Navigation › Header › 2 › Label and Navigation › Footer › 1 › Links › 2 › Label, and Close.",
      do: "If the same words come from more than one place, it asks **Which one did you mean?** Choose one, then type — or **Close** to leave them as they are.",
    });
}

/** Ask the assistant for a change on a page and wait for its answer (a real request). */
async function askAssistant(page, path, text, { form = false, before } = {}) {
  await openEditor(page, { path, form, assistant: true });
  const fresh = page.getByRole("button", { name: /^New chat/i }).first();
  if ((await page.locator(".g-chat .g-msg--user").count()) && (await fresh.count())) { await fresh.click(); await page.waitForTimeout(1000); }
  const composer = page.getByPlaceholder(/Ask for a change/i).first();
  await composer.click();
  await composer.fill(text);
  await page.waitForTimeout(600);
  if (before) await before();
  await composer.press("Enter");
  await page.waitForTimeout(5000);
  await until(page, "the assistant's answer", async () => {
    const { threads } = await api(`/api/sites/${SITE}/threads`);
    return threads?.length && !threads.some((t) => t.busy) && (await page.getByRole("button", { name: "Review in Proof" }).count()) > 0;
  }, 300_000);
  await page.waitForTimeout(4000);
  await hideDevToolbar(page);
}

/** The assistant's last reply beside the page it changed (the page and the assistant pane, below the top bar). */
async function chatClip() {
  return exact(268, 44, 1172, 732);
}
const ASK_STEP_2 = {
  alt: "The assistant's reply beside the page it changed: the lines Read the home page and Edited the home page, then what it changed, quoting the new heading “Coats for low sun.” and the button “See the eight looks”, with Review in Proof and Undo this change; the page shows the new heading.",
  do: "Read what it did: it lists what it read and edited, then quotes the new words.",
  see: "**Undo this change** puts back exactly what that reply changed.",
};
/** The showcase "assistant" (and how-to step 2): reopens the home page's conversation from Chats if needed. */
async function chatShot(page) {
  if (!(await page.locator(".g-chat .g-msg--user").count())) {
    await openEditor(page, { form: false, assistant: true });
    await page.getByRole("button", { name: "Chats" }).click();
    await page.waitForTimeout(1000);
    await page.getByText(/campaign heading/).first().click();
    await page.waitForTimeout(3000);
  }
  await hideDevToolbar(page);
  // The page may have scrolled to where the change landed; show the campaign hero at the top.
  await previewFrame(page)?.evaluate(() => scrollTo(0, 0)).catch(() => {});
  await page.waitForTimeout(1200);
  await shoot(page, "assistant", await chatClip());
  await howto(page, "ask-the-assistant", 2, await chatClip(), ASK_STEP_2);
}

/** Search & AI › AI crawlers: Block for OpenAI's training crawler, and the bar that asks to confirm it (how-to step 4). */
async function crawlerChoice(page) {
  const gptbot = page.locator(".seo-crawler, li").filter({ hasText: "OpenAI's training crawler" }).last();
  await gptbot.getByRole("radio", { name: "Block" }).click();
  await page.waitForTimeout(1500);
  await gptbot.evaluate((e) => e.scrollIntoView({ block: "center" }));
  await page.waitForTimeout(800);
  await howto(page, "search-and-ai", 4, { x: 740, y: 315, width: 700, height: 560 }, {
    alt: "The AI crawlers panel: OpenAI's training crawler (GPTBot, model training) switched to Block, the crawlers around it on Allow, and at the foot a bar: 1 rule will change — Block OpenAI's training crawler. Nothing changes until you confirm — with Keep as it is and Change 1 rule.",
    do: "Under **AI crawlers**, choose **Allow** or **Block** for each one — here **Block** for OpenAI's training crawler. A bar at the foot says what will change; press **Change 1 rule**.",
    see: "Search crawlers decide whether AI assistants can find and link to the site; training crawlers decide whether its pages may train models.",
  });
}

/** The brand material the "brand" step adds: a two-page PDF of brand notes, the wordmark, a note (all invented). */
async function makeMaterial() {
  const dir = join(WORK, "material");
  mkdirSync(dir, { recursive: true });
  const p = await ctx.newPage();
  const swatches = [["#f7f6f3", "Lime-wash"], ["#110f0d", "Ink"], ["#1c3dbb", "Ultramarine"], ["#a9231e", "Brick"]];
  await p.setContent(`<html><body style="font-family: Georgia, serif; margin: 60px; color: #110f0d; background: #f7f6f3">
<p style="letter-spacing: .5em; font-size: 28px; margin: 0 0 40px">CADDOW</p>
<h1 style="font-weight: 400; font-size: 40px">Brand notes, autumn–winter 2026</h1>
<p style="font-size: 16px; line-height: 1.6; max-width: 34em">Caddow makes coats and knitwear in undyed wool, forty of each. These notes are for anyone writing or designing for the label: the shop window, the lookbook, the website.</p>
<h2 style="font-weight: 400; font-size: 22px; margin-top: 40px">Colour</h2>
<div style="display: flex; gap: 16px">${swatches.map(([c, n]) => `<div><div style="width: 110px; height: 80px; background: ${c}; border: 1px solid #d3d0cc"></div><p style="font-size: 13px">${n}<br><span style="font-family: monospace">${c}</span></p></div>`).join("")}</div>
<h2 style="font-weight: 400; font-size: 22px; margin-top: 40px">Voice</h2>
<p style="font-size: 16px; line-height: 1.6; max-width: 34em">Plain, exact, unhurried. Name the cloth and the make. Give real numbers. Never “luxurious”, never “exclusive”, never a countdown.</p>
<div style="page-break-before: always"></div>
<h2 style="font-weight: 400; font-size: 22px">Photography</h2>
<p style="font-size: 16px; line-height: 1.6; max-width: 34em">Low sun, long shadows, a lime-washed wall or the harbour. One person, one coat. No studio sweep, no props.</p>
<h2 style="font-weight: 400; font-size: 22px; margin-top: 40px">The wordmark</h2>
<p style="font-size: 16px; line-height: 1.6; max-width: 34em">CADDOW in capitals, spaced wide. Ink on a light ground, Lime-wash on a dark one. Never in the accent blue.</p>
</body></html>`);
  await p.pdf({ path: join(dir, "caddow-brand-notes.pdf"), format: "A4", printBackground: true });
  await p.setViewportSize({ width: 800, height: 260 });
  await p.setContent(`<html><body style="margin: 0; background: #f7f6f3; display: grid; place-items: center; height: 260px"><div style="font-family: Georgia, serif; font-size: 72px; letter-spacing: .42em; color: #110f0d; padding-left: .42em">CADDOW</div></body></html>`);
  await p.screenshot({ path: join(dir, "caddow-wordmark.png") });
  await p.close();
  writeFileSync(join(dir, "window-notes.md"), "# Notes from the shop window\n\nHesper, October: the window cards and the website should sound the same. Short lines, real numbers, the cloth named. We say \"coat\", not \"outerwear\". Prices in plain figures, no \"from\".\n");
  return [
    { name: "caddow-brand-notes.pdf", note: "The autumn–winter brand notes; the colours on page 1 are current." },
    { name: "caddow-wordmark.png", note: "The wordmark as it is printed on the labels." },
    { name: "window-notes.md", note: "Hesper’s notes on how the shop window cards are written." },
  ].map((m) => ({ ...m, file: join(dir, m.name) }));
}

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: VIEW, deviceScaleFactor: SCALE, colorScheme: "light", reducedMotion: "no-preference" });
await ctx.addInitScript(() => { try { localStorage.setItem("galley-theme", "light"); } catch {} });
const page = await ctx.newPage();
if (appSteps) await page.goto(`${ORIGIN}/?token=${TOKEN}`, { waitUntil: "networkidle" });
// The release the pictures show, as the running app says (for howto.json's "captured").
const appVersion = appSteps ? (await api("/api/meta")).version ?? "unknown" : "unknown";

try {
  for (const step of steps) {
    console.log(`step ${step}`);
    await run(step);
  }
} finally {
  writeHowto();
  await browser.close();
  rmSync(WORK, { recursive: true, force: true });
}

async function run(step) {
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
    await discard();
  }

  if (step === "setup") {
    // The name every version is published under (an invented person from the starter), and the light theme.
    await api("/api/settings", { method: "PATCH", body: JSON.stringify({ author: AUTHOR, appearance: { theme: "light" } }) });
    await discard();
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
          toWebp(png, `caddow-tall-${look.id}`, { dir: SITES, maxWidth: 1280, half: false });
        }
      } finally {
        writeFileSync(tokens, original);
      }
    }
    await shots.close();
  }

  if (step === "analytics") {
    // How-to: add Google Analytics 4 from Scripts, check its consent, see the change waiting. Then published.
    await go(page, `/sites/${SITE}/scripts`);
    await page.getByRole("button", { name: "Add a script" }).click();
    await page.waitForTimeout(1500);
    await howto(page, "add-analytics", 1, FULL, {
      alt: "The Scripts screen with the Add a script window open: Google Tag Manager, Google Analytics 4, Plausible, Segment, Hotjar, Microsoft Clarity, Meta Pixel and more, each with a line about what it does.",
      do: "Open **Scripts** in the sidebar and press **Add a script**, then choose **Google Analytics 4**.",
    });
    await page.getByRole("button", { name: /Google Analytics 4/ }).click();
    await page.waitForTimeout(1000);
    await page.getByLabel("Measurement ID").fill(GA_ID);
    await page.waitForTimeout(1000);
    const dlg = await box(page, "dialog[open]");
    await docShot(page, "scripts-add-ga4", dlg.x, dlg.y);
    await howto(page, "add-analytics", 2, await focus(page, ["dialog[open]"]), {
      alt: `The Add Google Analytics 4 window with the measurement ID ${GA_ID} filled in, and under Already chosen for you: straight away, in the page head, consent: Analytics, every page.`,
      do: "Paste your **Measurement ID** (it looks like G-XXXXXXXXXX) and press **Add Google Analytics 4**.",
      see: "**Already chosen for you** says when and where it loads, and that it waits for the visitor's consent to analytics.",
    });
    await page.getByRole("button", { name: "Add Google Analytics 4" }).click();
    await page.waitForTimeout(3000);
    const row = page.locator("main").getByText("Google Analytics 4", { exact: true }).first();
    await row.scrollIntoViewIfNeeded();
    await page.evaluate(() => scrollTo(0, 0));
    await page.waitForTimeout(800);
    await howto(page, "add-analytics", 3, { x: 260, y: 296, width: 1140, height: 578 }, {
      alt: "Google Analytics 4 under Installed, switched on and marked New, with Every page, Straight away and Consent: Analytics chosen; beside it the Consent panel with Ask visitors first set to Built-in banner.",
      do: "Check it under **Installed**: it's switched on, and its **Consent** is **Analytics**. Under **Consent**, **Ask visitors first** is **Built-in banner**, so it loads only after a visitor agrees.",
    });
    await go(page, `/sites/${SITE}/proof`, 2500);
    await howto(page, "add-analytics", 4, { x: 232, y: 0, width: 1208, height: 420 }, {
      alt: "Proof with 1 change waiting to be published: Scripts, src/data/scripts.json, Edited — Added a script; under What changed, Scripts › Google Analytics 4, Added, with Put back.",
      do: "Open **Proof** to see the change waiting, then press **Publish**.",
      see: "Nothing loads on the live site until you publish.",
    });
    await publishNow("Add Google Analytics 4");
  }

  if (step === "bulk-redirects") {
    // How-to: paste a list into Add many, let the review catch a loop, a duplicate and a missing page,
    // add the rest, see the list, try an address. Also the docs' six-line paste and the showcase. Then published.
    await go(page, `/sites/${SITE}/redirects`);
    await howto(page, "bulk-redirects", 1, FULL, {
      alt: "The Redirects screen with no redirects yet: Add many and Add one in the middle, Where is this site hosted? and Try an address on the right.",
      do: "Open **Redirects** in the sidebar and press **Add many**.",
    });
    const pasteBox = () => page.getByRole("textbox", { name: /Redirects to add/ });
    // The docs' example first: six lines, one without a kind, one old address sent to two places.
    await page.getByRole("button", { name: "Add many" }).first().click();
    await page.waitForTimeout(1200);
    await pasteBox().fill(["/about-us/ /atelier/ 301", "/news/ /journal/ 301", "/shop/coats/ /collections/ 301", "/stockist-list/ /stockists/", "/lookbook/* /collections/:splat 301", "/news/ /journal/notes/ 301"].join("\n"));
    await page.waitForTimeout(3000);
    let dlg = await box(page, "dialog[open]");
    await docShot(page, "redirects-add-many", dlg.x, dlg.y);
    // The how-to's list: a loop, a duplicate and an address that isn't on the site.
    await pasteBox().fill([
      "/about-us/ /atelier/ 301", "/news/ /journal/ 301", "/shop/coats/ /collections/ 301", "/stockist-list/ /stockists/ 301",
      "/lookbook/* /collections/:splat 301", "/press/ /contact/ 301", "/journal/archive/ /journal/ 301", "/about-us/ /atelier/ 301",
      "/workroom/ /our-workroom/ 301", "/our-workroom/ /workroom/ 301", "/winter-sale/ /sale/ 301",
    ].join("\n"));
    await page.waitForTimeout(3500);
    await shoot(page, "redirects-review", FULL);
    dlg = await box(page, "dialog[open]");
    await howto(page, "bulk-redirects", 2, exact(dlg.x, dlg.y, dlg.width, dlg.height), {
      alt: "The Add many redirects window with eleven pasted lines on the left; on the right, Understood 11 lines, New 10, and the review: 1 loop in red (/workroom/ → /our-workroom/ → /workroom/ goes round in a circle) with Leave them out, 1 new address not found on this site, and 1 duplicate. Add 10 redirects is greyed out until the loop is dealt with.",
      do: "Paste your list — two columns from a spreadsheet, a _redirects file, .htaccess or nginx lines — or press **Choose a file…**.",
      see: "It shows straight away what it understood, and stops on anything that would go wrong: here a loop, a duplicate and an address that isn't on the site yet.",
    });
    await page.getByRole("button", { name: "Leave them out" }).first().click();
    await page.waitForTimeout(1500);
    await howto(page, "bulk-redirects", 3, exact(dlg.x, dlg.y, dlg.width, dlg.height), {
      alt: "The same window after leaving the loop out: New 8, Left out 2; 1 new address not found on this site with Keep them chosen, 1 duplicate (Keep the first), 1 loop (Leave them out); the button now reads Add 8 redirects.",
      do: "Press **Leave them out** for the loop, decide about the rest (**Keep them** keeps an address whose page is still to come), then press **Add 8 redirects** (the number is yours).",
    });
    await page.getByRole("button", { name: /^Add \d+ redirects$/ }).click();
    await page.waitForTimeout(3000);
    // Where they take effect: the site goes online on Cloudflare.
    const host = page.getByRole("button", { name: /^Cloudflare/ }).first();
    if (await host.count()) { await host.click(); await page.waitForTimeout(2500); }
    // The toast about the added redirects goes by itself; close it if it's still there.
    const closeToast = page.getByRole("button", { name: /^(Close|Dismiss)/ }).first();
    if (await closeToast.count()) await closeToast.click().catch(() => {});
    await page.waitForTimeout(1500);
    const table = await box(page, "main table, main [role=table]");
    await docShot(page, "redirects-list", table.x - 6, table.y - 4);
    await howto(page, "bulk-redirects", 4, FULL, {
      alt: "The Redirects screen with 8 redirects listed by old address, new address and kind; /winter-sale/ → /sale/ marked with a warning sign. On the right, Where they take effect: Cloudflare, the file public/_redirects In step with the list, 7 of 2,000 exact addresses and 1 of 100 wildcards.",
      do: "Check the list. A warning sign marks a redirect that leads nowhere yet; **Health** lists it too.",
      see: "The whole list is one change in Proof, with the host's own redirects file kept in step beside it.",
    });
    await page.getByRole("textbox", { name: "An old address" }).fill("/about-us/");
    await page.getByRole("button", { name: "Try", exact: true }).click();
    await page.waitForTimeout(2500);
    await page.locator("h2", { hasText: "Health" }).evaluate((e) => e.scrollIntoView({ block: "center" }));
    await page.waitForTimeout(800);
    await shoot(page, "redirects-try", FULL);
    await howto(page, "bulk-redirects", 5, await focus(page, [page.locator("section, div").filter({ has: page.locator("h2", { hasText: "Try an address" }) }).last(), page.locator("section, div").filter({ has: page.locator("h2", { hasText: "Health" }) }).last()], { min: 760 }), {
      alt: "Try an address with /about-us/ typed in: one step, /about-us/ → /atelier/, Permanent 301, ending on The atelier. Below it, Health: 1 leads nowhere, /winter-sale/ → /sale/.",
      do: "Type an old address under **Try an address** and press **Try**.",
      see: "It shows every step a visitor takes and the page they end on.",
    });
    await publishNow("Redirects from the old shop's addresses");
  }

  if (step === "add-form") {
    // How-to: open a form, add a field, see where its answers go, send a test and read it in the Inbox.
    // Also the docs' form builder and inbox pictures. The form change is then published.
    const old = await api(`/api/sites/${SITE}/inbox/contact?filter=all`);
    if (old.items?.length) await api(`/api/sites/${SITE}/inbox/contact/delete`, { method: "POST", body: JSON.stringify({ ids: old.items.map((s) => s.id) }) });
    await go(page, `/sites/${SITE}/forms`);
    await howto(page, "add-a-form", 1, FULL, {
      alt: "The Forms screen: Become a stockist, Caddow letters and Write to the workroom, each sending to Inbox, with their number of fields; New form at the top right, and a note asking where the live site should send submissions.",
      do: "Open **Forms** in the sidebar and choose a form — here **Write to the workroom**. **New form** starts one from Blank, Contact, Newsletter sign-up and more.",
    });
    await page.getByRole("link", { name: "Write to the workroom" }).first().click();
    await page.waitForTimeout(2500);
    await docShot(page, "form-builder", 232, 44);
    await page.getByRole("button", { name: /^Your message, long text/ }).click();
    await page.waitForTimeout(800);
    await page.locator("main button").filter({ hasText: /Phone\s*\. A phone number/ }).first().click();
    await page.waitForTimeout(1500);
    await page.getByLabel("Label", { exact: true }).fill("A phone number, if you’d rather we rang");
    await page.getByLabel("Help", { exact: true }).fill("We ring between ten and five, Thursday to Saturday.");
    await page.evaluate(() => document.activeElement?.blur());
    await page.waitForTimeout(1500);
    await howto(page, "add-a-form", 2, { x: 420, y: 206, width: 1020, height: 669 }, {
      alt: "The form builder on Write to the workroom: a new Phone field under Your message, labelled “A phone number, if you’d rather we rang” and marked New; on the right its Label, Placeholder, Help, Required and Width.",
      do: "Click a field type on the left — **Phone** here — to add it below the selected field, then give it a **Label** and **Help** on the right.",
      see: "The change is saved as you go, and waits in Proof like any other.",
    });
    await page.getByRole("tab", { name: /Where it goes/ }).click();
    await page.waitForTimeout(1800);
    await howto(page, "add-a-form", 3, exact(372, 214, 912, 570), {
      alt: "The Where it goes tab: Inbox as the main destination, the capture address, Submissions appear in this app's inbox for the site with See submissions, and a note that submissions can only arrive when the app runs on a server visitors can reach.",
      do: "Open **Where it goes**. **Inbox** is the first destination; **Add a destination** sends the answers to HubSpot, Marketo, Salesforce, Pardot, a webhook or the visitor's e-mail program as well.",
    });
    await publishNow("Phone number on the workroom form");
    await go(page, `/sites/${SITE}/inbox`);
    await page.getByRole("button", { name: /^Write to the workroom/ }).click();
    await page.waitForTimeout(1200);
    await page.getByRole("button", { name: "Send a test submission" }).click();
    await page.waitForTimeout(3500);
    await page.getByRole("button", { name: /^Test visitor/ }).click();
    await page.waitForTimeout(2000);
    await docShot(page, "inbox", 266, 78);
    await howto(page, "add-a-form", 4, exact(266, 78, 1125, 750), {
      alt: "The Inbox: the forms on the left, one submission from Test visitor marked Test in the middle, and on the right every answer — name, email address, what it is about, message, phone number and consent — with Mark unread, Spam and Delete.",
      do: "Open **Inbox** (or **See submissions**), choose the form and press **Send a test submission**.",
      see: "It goes through the same checks as a visitor's and arrives at the top, marked Test. Choose it to read every answer.",
    });
  }

  if (step === "crawler-bar") {
    // How-to step 4 again, on a site where GPTBot is already blocked: allowed first (a change waiting),
    // then Block chosen in the panel, the bar captured, kept as it is, and the change put back.
    await api(`/api/sites/${SITE}/visibility/crawlers`, { method: "PUT", body: JSON.stringify({ choices: { GPTBot: "allow" } }) });
    await page.goto(`${ORIGIN}/sites/${SITE}/visibility`, { waitUntil: "load" });
    await checksDone(page);
    await crawlerChoice(page);
    await page.getByRole("button", { name: "Keep as it is" }).click();
    await discard(["src/data/visibility.json"]);
  }

  if (step === "search-ai") {
    // How-to: run the checks, fix one finding (a link to an old address, now redirected), block a crawler.
    // Also the docs' picture. First, the thing to fix: a journal post that still links to /about-us/
    // (published, as if it had always been there).
    const post = "src/content/journal/keeping-a-wool-coat.md";
    const { content } = await api(`/api/sites/${SITE}/file?path=${encodeURIComponent(post)}`);
    if (content.includes("Send it back to us and we will mend it")) {
      await api(`/api/sites/${SITE}/file?path=${encodeURIComponent(post)}`, { method: "PUT", body: JSON.stringify({ content: content.replace("Send it back to us and we will mend it", "Send it back to [the workroom](/about-us/) and we will mend it") }) });
      await publishNow("Care notes: send a coat back for mending");
    }
    await waitForPreview(page);
    await page.goto(`${ORIGIN}/sites/${SITE}/visibility`, { waitUntil: "load" });
    await checksDone(page);
    // The first run can find the preview's pages still compiling; the second sees them.
    await page.getByRole("button", { name: "Check again" }).click();
    await page.waitForTimeout(3000);
    await checksDone(page);
    await docShot(page, "search-and-ai", 270, 225);
    await howto(page, "search-and-ai", 1, FULL, {
      alt: "Search & AI for Caddow: 2 must fix, 1 should fix and 2 ideas; a note that the rendered checks used the running preview; the groups Titles & descriptions, Headings & content, Images, Links and more, each marked; and on the right How AI systems see this site, with the AI crawlers.",
      do: "Open **Search & AI** in the sidebar. The checks run straight away; with the preview running they also check the pages as visitors get them. **Check again** runs them after a change.",
    });
    await page.getByRole("button", { name: /^Links/ }).click();
    await page.waitForTimeout(1200);
    await page.getByRole("button", { name: /^Links/ }).evaluate((e) => e.scrollIntoView({ block: "center" }));
    await page.waitForTimeout(800);
    const links = page.locator("main section, main div").filter({ has: page.getByRole("button", { name: /^Links/ }) }).filter({ has: page.getByRole("button", { name: "Point it at the new address" }) }).last();
    await howto(page, "search-and-ai", 2, await focus(page, [links], { min: 900 }), {
      alt: "The Links group with 1 must fix: Link to a page that doesn't exist, on How to keep a wool coat for 20 years. Found “/about-us/”; that page now lives at /atelier/. Buttons: Point it at the new address and Open the page.",
      do: "Open a group to see its findings. Where the right fix is certain, the finding offers it — here **Point it at the new address**.",
    });
    await page.getByRole("button", { name: "Point it at the new address" }).click();
    await page.waitForTimeout(2000);
    await until(page, "the fix and the new check", async () => !(await page.getByRole("button", { name: /Checking…|Fixing…/ }).count()), 300_000);
    await page.waitForTimeout(1500);
    await howto(page, "search-and-ai", 3, FULL, {
      alt: "Search & AI after the fix: Links is now In good shape, Proof in the top bar shows 1, and a message says Fixed — The change is waiting in Proof. Nothing is live until you publish — with Undo.",
      do: "Press **Point it at the new address**.",
      see: "The fix is an ordinary change waiting in Proof, and the checks run again. **Undo** puts it back.",
    });
    await dismissToasts(page);
    await crawlerChoice(page);
    const change = page.getByRole("button", { name: /^Change 1 rule/ });
    await change.click();
    await until(page, "the crawler rules", async () => !(await page.getByRole("button", { name: /Saving…/ }).count()), 60_000);
    await page.waitForTimeout(2500);
    await dismissToasts(page);
    await page.locator("#seo-crawlers-title").evaluate((e) => e.scrollIntoView({ block: "start" }));
    await page.waitForTimeout(800);
    await howto(page, "search-and-ai", 5, { x: 740, y: 0, width: 700, height: 560 }, {
      alt: "The AI crawlers panel after the change: Blocks AI training (GPTBot), kept in src/data/visibility.json; OpenAI's training crawler is blocked, the rest allowed. Proof in the top bar shows 2.",
      see: "The choice waits in Proof with the fix; the site writes it into robots.txt when you publish.",
      do: "Check the panel's summary, then open **Proof** and **Publish**.",
    });
    await publishNow("An old link pointed at the atelier; OpenAI's training crawler blocked");
  }

  if (step === "wordpress") {
    // How-to and showcase: "Bring your WordPress site" on the second throwaway site (Lowfield), from
    // the importer's stand-in WordPress site (WP_URL). The import is left waiting in Proof.
    const WP_SITE = process.env.WP_SITE, WP_URL = process.env.WP_URL;
    if (!WP_SITE || !WP_URL) throw new Error("Set WP_SITE and WP_URL for the wordpress step.");
    await api(`/api/sites/${WP_SITE}/discard`, { method: "POST", body: JSON.stringify({}) });
    // The wizard remembers its last report; start it over.
    const column = { x: 328, y: 60, width: 1000, height: 815 };
    await go(page, `/sites/${WP_SITE}`, 2500);
    const card = page.locator("main section, main div").filter({ has: page.locator("h2", { hasText: "Moving from WordPress?" }) }).last();
    await howto(page, "move-from-wordpress", 1, await focus(page, [card], { min: 700 }), {
      alt: "Site home for Lowfield: under Moving from WordPress?, a line saying its posts, pages, images and SEO details come across as changes you check, and the button Bring your WordPress site.",
      do: "On **Site home**, under **Moving from WordPress?**, press **Bring your WordPress site**.",
    });
    await page.getByRole("link", { name: "Bring your WordPress site" }).click();
    await page.waitForTimeout(2500);
    // (After an earlier run the wizard opens on its old report.)
    if (await page.getByRole("button", { name: "Import again" }).count()) { await page.getByRole("button", { name: "Import again" }).click(); await page.waitForTimeout(1500); }
    await page.getByRole("textbox", { name: "The site’s address" }).fill(WP_URL);
    await until(page, "the address check", async () => (await page.getByText(/A WordPress site at/).count()) > 0, 60_000);
    await page.evaluate(() => document.activeElement?.blur());
    await page.waitForTimeout(1000);
    await shoot(page, "wordpress-where", column);
    await howto(page, "move-from-wordpress", 2, column, {
      alt: "Step 1 of 4, Where is your WordPress site?: the address pasted in and checked — Fernhill Garden Studio, a WordPress site, with 12 posts, 6 pages, 18 images and files, and 37 comments that stay behind — above Or drop an export file here and the Continue button.",
      do: "Paste the site's address (it's checked as you type), or drop an export file, then press **Continue**.",
    });
    await page.getByRole("button", { name: "Continue" }).click();
    await until(page, "the plan", async () => (await page.getByText(/Here’s what comes across/).count()) > 0, 120_000);
    await page.waitForTimeout(2000);
    await shoot(page, "wordpress-plan", column);
    await page.locator("main h2", { hasText: "One thing to decide" }).evaluate((e) => e.scrollIntoView({ block: "start" }));
    await page.waitForTimeout(800);
    await howto(page, "move-from-wordpress", 3, column, {
      alt: "Step 2, What comes across: one thing to decide — who Journal entries should be credited to, with Ines Ferreira marked Suggested — then Search rankings (16 search descriptions come across, 12 old addresses will redirect), What stays behind, and the button Bring over 18 entries.",
      do: "Check **What comes across**: where posts and pages go, anything to decide, your search rankings and what stays behind. Then press **Bring over 18 entries** (the number is yours).",
    });
    await page.getByRole("button", { name: /^Bring over/ }).click();
    // Bringing it over: catch it part-way, while the posts come across.
    let caught = false;
    for (let i = 0; i < 400 && !caught; i++) {
      if ((await page.getByText(/Bringing over posts —/).count()) && !(await page.getByText(/It’s all here/).count())) {
        await shoot(page, "wordpress-progress", column);
        await howto(page, "move-from-wordpress", 4, column, {
          alt: "Step 3, Bringing it over…: Reading the old site and Downloading images (18 of 18) done, Bringing over posts under way with its progress bar, then Bringing over pages and Writing the report still to come; Stop the import below.",
          do: "Wait while it brings everything over — reading the old site, downloading images, posts, pages.",
          see: "Everything lands as pending changes; you can leave the screen and it keeps going.",
        });
        caught = true;
      }
      await page.waitForTimeout(150);
    }
    await until(page, "the import", async () => (await page.getByText(/It’s all here/).count()) > 0, 600_000);
    await page.getByRole("button", { name: "See the report" }).click();
    await until(page, "the report", async () => (await page.getByText(/Your WordPress site is here/).count()) > 0, 60_000);
    await page.waitForTimeout(2500);
    await docShot(page, "wordpress-report", 428, 165);
    await shoot(page, "wordpress-report", column);
    await howto(page, "move-from-wordpress", 5, column, {
      alt: "Step 4, Your WordPress site is here: five next steps — Review it in Proof (Open Proof), Rebuild the page-builder pages (Rebuild all…), Set the redirects (Review redirects), Put the site online, Switch the domain — and What arrived: 12 posts, 5 pages, 18 images.",
      do: "Read the report, then work down its list: **Open Proof** to review everything, **Rebuild all…** for page-builder pages, **Review redirects** so old links keep working.",
      see: "Nothing is live until you publish; keep WordPress running until the new site looks right online.",
    });
  }

  if (step === "change-page") {
    // How-to: change a heading in the form (the atelier: "three streets" → "two streets"), see it on
    // the page, find it in Proof. Also the docs' Edited field and Proof pictures. Left waiting in Proof.
    await waitForPreview(page);
    await go(page, `/sites/${SITE}/c/pages`, 2500);
    await howto(page, "change-a-page", 1, FULL, {
      alt: "The Pages list for Caddow: eight pages by title and address — the home page, Collections, Contact, Journal, Page not found, Privacy, Stockists and The atelier — with Search pages, a sort, and All, Edited, New and Unchanged.",
      do: "Open **Pages** in the sidebar and choose the page — here **The atelier**.",
    });
    await page.getByRole("link", { name: /^The atelier/ }).first().click();
    await waitForPreview(page);
    // The panes are as the last page left them: the form shown, the assistant hidden.
    const showForm = page.getByRole("button", { name: /^Show form/i }).first();
    if (await showForm.count()) { await showForm.click(); await page.waitForTimeout(800); }
    const hideAssistant = page.getByRole("button", { name: /^Hide assistant/i }).first();
    if (await hideAssistant.count()) await hideAssistant.click();
    await tool(page, "Click to edit");
    await page.getByRole("button", { name: /^Photo and text/ }).first().click();
    await page.waitForTimeout(1500);
    const heading = page.getByRole("textbox", { name: /^Heading/ }).first();
    await heading.evaluate((e) => e.scrollIntoView({ block: "center" }));
    await page.waitForTimeout(800);
    await howto(page, "change-a-page", 2, exact(232, 44, 900, 562), {
      alt: "The editor on The atelier: in the form, the section Photo and text opened to show its fields — ID, Tone, Eyebrow and Heading, whose words are “A workroom over the ropewalk, *three streets from the sea*.” — beside the page.",
      do: "In the form on the left, click the section — **Photo and text** — to open its fields, and find **Heading**.",
    });
    await heading.click();
    await heading.fill("A workroom over the ropewalk, *two streets from the sea*.");
    await page.evaluate(() => document.activeElement?.blur());
    await page.waitForTimeout(4000);
    await previewFrame(page).locator("h1, h2").filter({ hasText: "two streets" }).first().evaluate((e) => e.scrollIntoView({ block: "center" }));
    await page.waitForTimeout(1500);
    const hb = await box(page, heading);
    await docShot(page, "form-field-edited", hb.x - 9, hb.y - 34);
    await howto(page, "change-a-page", 3, exact(232, 160, 1180, 715), {
      alt: "The Heading field marked Edited with a Put back button, now reading “A workroom over the ropewalk, *two streets from the sea*.”, and beside it the page showing the new heading: A workroom over the ropewalk, two streets from the sea.",
      do: "Type. The asterisks around words make them italic, as they are on the page.",
      see: "The change is saved as you type: the field shows **Edited**, the page shows it a moment later, and **Put back** returns it to what is published.",
    });
    await go(page, `/sites/${SITE}/proof`, 3000);
    await docShot(page, "proof-what-changed", 596, 162, 844);
    await howto(page, "change-a-page", 4, { x: 232, y: 0, width: 1208, height: 420 }, {
      alt: "Proof with 1 change waiting to be published: The atelier, Edited — Changed the heading; under What changed, Photo and text › Heading with three struck through and two written in, beside Show as stored and Put back.",
      do: "Press **Proof** in the top bar to see the change waiting, in the page's own words.",
      see: "Nothing is live until someone presses **Publish**.",
    });
  }

  if (step === "click-doc") {
    await openEditor(page, { form: false, assistant: false });
    await tool(page, "Click to edit");
    await clickToEditDoc(page);
  }

  if (step === "which-one") {
    await openEditor(page, { form: false, assistant: false });
    await tool(page, "Click to edit");
    await whichOne(page);
    await go(page, `/sites/${SITE}`, 1500);
  }

  if (step === "click") {
    // How-to: Click to edit on the home page — point, click, retype the Pieces heading, Enter; and the
    // "Which one did you mean?" case in the footer. Also screens/click and the docs' two pictures.
    // The retyped heading is left waiting in Proof.
    await openEditor(page, { form: false, assistant: false });
    await tool(page, "Click to edit");
    await hideDevToolbar(page);
    const frame = previewFrame(page);
    await clickToEditDoc(page);
    // A heading with no formatting inside, so it is retyped in place.
    const target = frame.locator(process.env.CLICK_TARGET ?? "main h2:not(:has(em))").nth(Number(process.env.CLICK_INDEX ?? 1));
    await target.evaluate((el) => scrollTo(0, el.getBoundingClientRect().top + scrollY - 200));
    await page.waitForTimeout(800);
    await target.hover();
    await page.waitForTimeout(900);
    await shoot(page, "edit-on-the-page-1", FULL, { dir: HOWTO, keepPointer: true });
    guides.get("edit-on-the-page").steps = [{
      image: "howto/edit-on-the-page-1",
      alt: "The Caddow home page in the editor with Click to edit chosen above it: the heading “Coats and knits to begin with” has a dotted blue outline and a blue Click to edit tag.",
      do: "Open the page in the editor. Above the page, **Click to edit** is chosen; point at the words you want to change.",
      see: "They get a dotted outline and a **Click to edit** tag.",
    }];
    touched.add("edit-on-the-page");
    await target.click();
    await page.waitForTimeout(700);
    await page.keyboard.press("ControlOrMeta+A");
    await page.keyboard.type(CLICK_TEXT, { delay: 30 });
    await page.waitForTimeout(600);
    await shoot(page, "click", await clipOf(page, [".preview"], { aspect: 16 / 10 }), { keepPointer: true });
    await shoot(page, "edit-on-the-page-2", await focus(page, [target], { min: 900 }), { dir: HOWTO, keepPointer: true });
    guides.get("edit-on-the-page").steps[1] = {
      image: "howto/edit-on-the-page-2",
      alt: "The same heading being retyped in place on the page: it now reads “Coats and knits to start with”, still outlined, with the products below it.",
      do: "Click, and type over the words.",
    };
    await page.keyboard.press("Enter");
    await page.waitForTimeout(3000);
    await howto(page, "edit-on-the-page", 3, { x: 232, y: 0, width: 1208, height: 560 }, {
      alt: "After pressing Enter: the page shows the new heading “Coats and knits to start with”, the page's name in the top bar is marked Edited, and Proof counts 2 changes.",
      do: "Press **Enter** to keep the change, or **Escape** to leave the words as they were.",
      see: "It's saved like any edit in the form, and waits in Proof.",
    });
    await whichOne(page);
    // (Close it, and leave the page.)
    await page.getByRole("button", { name: "Close" }).last().click().catch(() => {});
    await go(page, `/sites/${SITE}`, 1500);
  }

  if (step === "media-generate") { await go(page, `/sites/${SITE}/media`, 3000); await mediaGenerateDoc(page); }

  if (step === "showcase") {
    // The main screens in the shared session state (three changes waiting in Proof): site home, sites,
    // media, forms, inbox, scripts, Search & AI, redirects, settings. Also the docs' sites and media pictures.
    const WP_SITE = process.env.WP_SITE;
    // Sites filed by client, with a note each (kept by this app, not in the sites).
    const listGroups = async () => (await api("/api/groups")).groups ?? (await api("/api/groups"));
    const groupFor = async (name) => {
      const all = await listGroups();
      return (Array.isArray(all) ? all : []).find((g) => g.name === name) ?? (await api("/api/groups", { method: "POST", body: JSON.stringify({ name }) }));
    };
    const caddowLtd = await groupFor("Caddow Ltd");
    await api(`/api/sites/${SITE}/listing`, { method: "PATCH", body: JSON.stringify({ group: caddowLtd.id, note: "Hesper is the contact; spring lookbook due in March." }) });
    if (WP_SITE) {
      const fernhill = await groupFor("Fernhill Garden Studio");
      await api(`/api/sites/${WP_SITE}/listing`, { method: "PATCH", body: JSON.stringify({ group: fernhill.id, note: "Moving from WordPress: check the import before launch." }) });
    }
    // Two visitors' messages and a sign-up, as the live site would send them (invented people). They are
    // posted from another local address (the site served some other way): from the app's own address
    // or the preview's, the inbox would mark them Test.
    const { items = [] } = await api(`/api/sites/${SITE}/inbox/contact?filter=all`);
    if (!items.some((i) => !i.test)) {
      const send = (form, values, url, title) => fetch(`${ORIGIN}/f/${SITE}`, { method: "POST", headers: { "content-type": "application/json", origin: "http://localhost:8080" }, body: JSON.stringify({ form, values, page: { url, title, referrer: "" }, meta: { honeypot: "", elapsedMs: 24_000 } }) });
      await send("contact", { name: "Ines Marrow", email: "ines.marrow@example.com", topic: "size", height: "5 ft 9, the field coat", message: "I'm between a 2 and a 3 in the field coat. Could you measure the 3 across the shoulders for me?", consent: "yes" }, "https://www.caddow.example/contact/", "Contact");
      await page.waitForTimeout(1500);
      await send("contact", { name: "Corin Vale", email: "corin.vale@example.com", topic: "repair", message: "The left pocket of my 2024 rust coat has worn through at the corner. Can I post it to you for mending?", a_phone_number_if_you_d_rather_we_rang: "01632 960 418", consent: "yes" }, "https://www.caddow.example/contact/", "Contact");
      await send("newsletter", { email: "m.ashby@example.com", source: "home" }, "https://www.caddow.example/", "Caddow");
    }
    await waitForPreview(page);
    await go(page, `/sites/${SITE}`, 3000);
    await shoot(page, "site-home", FULL);
    await go(page, "/", 3000);
    await shoot(page, "sites", FULL);
    await docShot(page, "sites", 270, 140);
    await go(page, `/sites/${SITE}/media`, 3000);
    await shoot(page, "media", FULL);
    await mediaGenerateDoc(page);
    await go(page, `/sites/${SITE}/forms`, 2500);
    await shoot(page, "forms", FULL);
    await go(page, `/sites/${SITE}/inbox`, 2500);
    await page.getByRole("button", { name: /^Write to the workroom/ }).click();
    await page.waitForTimeout(1500);
    await page.getByRole("button", { name: /^Corin Vale/ }).click();
    await page.waitForTimeout(2000);
    await shoot(page, "inbox", FULL);
    await go(page, `/sites/${SITE}/scripts`, 2500);
    await shoot(page, "scripts", FULL);
    await page.goto(`${ORIGIN}/sites/${SITE}/visibility`, { waitUntil: "load" });
    await checksDone(page);
    await page.getByRole("button", { name: "Check again" }).click();
    await page.waitForTimeout(3000);
    await checksDone(page);
    await shoot(page, "search-ai", FULL);
    await page.locator("#seo-crawlers-title").evaluate((e) => e.scrollIntoView({ block: "start" }));
    await page.waitForTimeout(800);
    await shoot(page, "search-ai-crawlers", FULL);
    await go(page, `/sites/${SITE}/redirects`, 2500);
    await shoot(page, "redirects", FULL);
    await go(page, `/sites/${SITE}/settings`, 2500);
    await shoot(page, "settings", FULL);
  }

  if (step === "publish-doc") {
    // The docs' Publish window again (needs changes waiting).
    await go(page, `/sites/${SITE}/proof`, 2500);
    await page.getByRole("button", { name: "Publish", exact: true }).first().click();
    await page.waitForTimeout(6000);
    await docDialog(page, "publish-dialog");
    await page.getByRole("button", { name: "Not yet" }).click();
  }

  if (step === "undo-doc") {
    await go(page, `/sites/${SITE}/history`, 3000);
    await page.getByRole("button", { name: "Undo this publish" }).first().click();
    await page.waitForTimeout(1500);
    await docDialog(page, "undo-publish-dialog");
    await page.getByRole("button", { name: "Keep it" }).click();
  }

  if (step === "publish") {
    // How-to: open Proof, put one change back, publish, and the undo from Version history (the
    // window, kept: "Keep it"). Also the showcase publish and history, and the docs' three pictures.
    await go(page, `/sites/${SITE}/proof`, 3000);
    await howto(page, "proof-and-publish", 1, FULL, {
      alt: "Proof with 3 changes waiting to be published: Home page, Journal and The atelier on the left, each marked Edited; on the right the home page's changes in its own words — the campaign heading, its button and the Pieces heading — each with Put back.",
      do: "Press **Proof** in the top bar. Choose a page on the left to see **What changed**, in the page's own words.",
    });
    const pieces = page.locator("article.proof-change").filter({ hasText: /Pieces/i }).last();
    await pieces.getByRole("button", { name: "Put back" }).click();
    await page.waitForTimeout(3500);
    await dismissToasts(page);
    await howto(page, "proof-and-publish", 2, { x: 232, y: 0, width: 1208, height: 620 }, {
      alt: "Proof after putting one change back: the home page now lists two changes — the campaign heading and its button — and the Pieces heading is gone from the list; 3 pages still have changes waiting.",
      do: "Press **Put back** beside a change you don't want. **Discard** on a row throws away every change to that page.",
      see: "What you put back returns to what is published; the rest stays waiting.",
    });
    await page.getByRole("button", { name: "Publish", exact: true }).first().click();
    // With the assistant connected, the window asks it for a note (one small request).
    await page.waitForTimeout(6000);
    await shoot(page, "publish", FULL);
    await docDialog(page, "publish-dialog");
    await howto(page, "proof-and-publish", 3, await focus(page, ["dialog[open]"], { min: 800 }), {
      alt: "The Publish 3 changes? window: it saves the changes as a new version on this computer, a suggested Note for version history, the three pages ticked under What goes — Home page, Journal and The atelier — and the buttons Not yet and Publish 3 changes.",
      do: "Press **Publish** in the top bar. Check the **Note for version history** and, under **What goes**, untick anything to keep back. Press **Publish 3 changes** (the number is yours).",
      see: "**Not yet** closes the window and publishes nothing.",
    });
    await page.getByRole("button", { name: /^Publish \d+ changes?$/ }).click();
    await until(page, "the publish", async () => (await api(`/api/sites/${SITE}/changes`)).files?.length === 0, 120_000);
    await page.waitForTimeout(2500);
    await dismissToasts(page);
    await go(page, `/sites/${SITE}/history`, 3000);
    await shoot(page, "history", FULL);
    await docShot(page, "history", 346, 196);
    await howto(page, "proof-and-publish", 4, exact(346, 196, 964, 600), {
      alt: "Version history: the newest version, with the note written in the Publish window, marked Latest and Published here, by Tobiah Rusk a moment ago, with Put this site online and Undo this publish; the earlier versions below it.",
      do: "Every publish is a new version in **Version history**, with who published it and when. To take one back, press **Undo this publish** beside it.",
    });
    await page.getByRole("button", { name: "Undo this publish" }).first().click();
    await page.waitForTimeout(1500);
    await docDialog(page, "undo-publish-dialog");
    await howto(page, "proof-and-publish", 5, await focus(page, ["dialog[open]"], { min: 800 }), {
      alt: "The Undo this publish? window over Version history: it takes back the newest version and adds a new version on top, so Version history keeps everything; buttons Keep it and Undo this publish.",
      do: "Press **Undo this publish** to go ahead, or **Keep it**.",
      see: "The undo is published straight away as a new version called Undo “…”; undoing that one puts the changes back.",
    });
    await page.getByRole("button", { name: "Keep it" }).click();
    await page.waitForTimeout(800);
  }

  if (step === "online") {
    // How-to and showcase: put the site online on the stand-in Cloudflare (CF_KEY is the key it
    // prints; addresses are made up: caddow.example-studio.workers.dev, then www.caddow.example).
    // The deploy builds the last published version. Needs a site that isn't online yet.
    const CF_KEY = process.env.CF_KEY;
    if (!CF_KEY) throw new Error("Set CF_KEY (the stand-in Cloudflare's key) for the online step.");
    const dialog = () => page.locator("dialog[open]");
    await go(page, `/sites/${SITE}/online`, 2500);
    await page.getByRole("button", { name: "Put this site online" }).first().click();
    await page.waitForTimeout(1500);
    const d1 = await box(page, "dialog[open]");
    await docShot(page, "online-setup", d1.x, d1.y);
    await shoot(page, "online-setup", FULL);
    await howto(page, "put-online", 1, FULL, {
      alt: "Step 1 of 4 of Put this site online, over the Online screen: Cloudflare, marked Recommended, and Vercel, each with a line about what it suits and a link to its prices, and the buttons Not now and Continue.",
      do: "Open **Online** in the sidebar and press **Put this site online**. Choose **Cloudflare** and press **Continue**.",
    });
    await dialog().getByRole("button", { name: "Continue" }).click();
    await page.waitForTimeout(1500);
    await howto(page, "put-online", 2, await focus(page, ["dialog[open]"], { min: 800 }), {
      alt: "Step 2 of 4, Connect Cloudflare: four short instructions for making an access key on Cloudflare's own page, the button Open Cloudflare's page, what the key lets the app do, and an empty Access key box above Back and Connect.",
      do: "Press **Open Cloudflare's page**, make the key there as the window says, paste it in **Access key** and press **Connect**.",
      see: "The key is checked with Cloudflare before it is saved, and kept on this computer only.",
    });
    await dialog().getByLabel("Access key").fill(CF_KEY);
    await dialog().getByRole("button", { name: "Connect" }).click();
    await until(page, "the account step", async () => (await dialog().getByRole("heading", { name: "Choose the account" }).count()) > 0, 60_000);
    await dialog().getByRole("button", { name: "Continue" }).click();
    await until(page, "the name step", async () => (await dialog().getByRole("heading", { name: "Name it" }).count()) > 0, 60_000);
    await page.waitForTimeout(800);
    await howto(page, "put-online", 3, await focus(page, ["dialog[open]"], { min: 800 }), {
      alt: "Step 4 of 4, Name it: the project name caddow, with the note It's free. The address will be caddow.example-studio.workers.dev, and What's live is what you've published; buttons Back and Put it online.",
      do: "Choose the account, then name it — the name becomes part of the address — and press **Put it online**.",
      see: "What goes live is the last published version; changes waiting in Proof stay here.",
    });
    await dialog().getByRole("button", { name: "Put it online" }).click();
    await until(page, "the deploy", async () => (await dialog().getByRole("heading", { name: "The site is online" }).count()) > 0, 600_000);
    await page.waitForTimeout(1500);
    await howto(page, "put-online", 4, await focus(page, ["dialog[open]"], { min: 800 }), {
      alt: "The site is online: live at caddow.example-studio.workers.dev with Open and Copy, an offer to compare Proof against the live site (Use this address), Use your own domain…, the switch Put changes live every time I publish, and a note: The site's online settings are a change waiting in Proof, with the button Publish the settings.",
      do: "Press **Open** to see it. **Put changes live every time I publish** makes each publish go live by itself.",
      see: "Where the site is online is kept with the site, as a change waiting in Proof: **Publish the settings** keeps them, so anyone else who works on it uses the same host and address.",
    });
    await dialog().getByRole("button", { name: "Use your own domain…" }).click();
    await page.waitForTimeout(1200);
    await dialog().getByLabel("Address").fill("www.caddow.example");
    await dialog().getByRole("button", { name: "Check" }).click();
    await until(page, "the domain check", async () => (await dialog().getByRole("button", { name: "Use this address" }).count()) > 0, 60_000);
    await page.waitForTimeout(800);
    await page.evaluate(() => document.activeElement?.blur());
    await shoot(page, "online-domain", FULL);
    await dialog().getByRole("button", { name: "Use this address" }).click();
    await until(page, "the address to answer", async () => (await dialog().getByRole("heading", { name: "Your address answers" }).count()) > 0, 300_000);
    await page.waitForTimeout(1000);
    await howto(page, "put-online", 5, await focus(page, ["dialog[open]"], { min: 800 }), {
      alt: "Your address answers: the site's live address is now www.caddow.example, with Open and Copy and an offer to compare Proof against it (Use this address).",
      do: "To use your own domain, press **Use your own domain…**, type the address — www.caddow.example here — press **Check**, read what will change, then **Use this address**.",
      see: "Cloudflare answers the address with the site and sets up its certificate; it can take a few minutes, and nothing else on the domain changes.",
    });
    await dialog().getByRole("button", { name: "Done" }).click();
    await page.waitForTimeout(2000);
    await go(page, `/sites/${SITE}/online`, 2500);
    await shoot(page, "online-live", FULL);
  }

  if (step === "editor-online") {
    // The Online screen's "Editor online" section, and "Host the editor online" up to its plan and price,
    // against the stand-in Fly.io (start.sh hosting; the app started with its variables). Creates nothing.
    const dialog = () => page.locator("dialog[open]");
    await go(page, `/sites/${SITE}/online`, 2500);
    await page.locator("main h2", { hasText: "Editor online" }).evaluate((e) => e.scrollIntoView({ block: "center" }));
    await page.waitForTimeout(800);
    await shoot(page, "editor-online", FULL);
    await page.getByRole("button", { name: "Host the editor online" }).click();
    await page.waitForTimeout(2000);
    await dialog().getByRole("button", { name: "Continue" }).click();
    await until(page, "the key step", async () => (await dialog().getByRole("heading", { name: /^Connect Fly/ }).count()) > 0, 60_000);
    await until(page, "the key check", async () => (await dialog().getByText(/can create the editor/).count()) > 0, 60_000).catch(() => {
      throw new Error("The app has no Fly.io key: run start.sh hosting before start.sh galley (see scripts/capture/README.md).");
    });
    await dialog().getByRole("button", { name: "Continue" }).click();
    await until(page, "the address step", async () => (await dialog().getByLabel("The editor’s address").count()) > 0, 60_000);
    await dialog().getByLabel("The editor’s address").fill("cms.caddow.example");
    await page.waitForTimeout(600);
    await dialog().getByRole("button", { name: "Continue" }).click();
    // (Step 4, what the editor is handed, names stored keys by their last characters: not captured.)
    await until(page, "the hand-over step", async () => (await dialog().getByRole("button", { name: "See the plan" }).count()) > 0, 60_000);
    await dialog().getByRole("button", { name: "See the plan" }).click();
    await until(page, "the plan", async () => (await dialog().getByRole("heading", { name: "Check the plan" }).count()) > 0, 120_000);
    await page.waitForTimeout(1500);
    await dialog().locator("h3", { hasText: "What it costs" }).evaluate((e) => e.scrollIntoView({ block: "center" }));
    await page.waitForTimeout(800);
    await shoot(page, "editor-online-plan", FULL);
    await page.keyboard.press("Escape");
    await page.waitForTimeout(800);
  }

  if (step === "hosted") {
    // A hosted install (galley serve, no site yet) started on this computer: its sign-in, and first run's
    // "Connect the site". HOSTED_URL and HOSTED_PASSWORD: see scripts/capture/README.md.
    const url = process.env.HOSTED_URL, password = process.env.HOSTED_PASSWORD;
    if (!url || !password) { console.log("  (skipped: set HOSTED_URL and HOSTED_PASSWORD, after start.sh hosted)"); return; }
    const hosted = await browser.newContext({ viewport: VIEW, deviceScaleFactor: SCALE, colorScheme: "light" });
    const view = await hosted.newPage();
    await view.goto(url, { waitUntil: "networkidle" });
    await view.waitForTimeout(1500);
    await shoot(view, "hosted-sign-in", FULL);
    await view.getByLabel("Password").fill(password);
    await view.keyboard.press("Enter");
    await view.getByRole("heading", { name: "Connect the site." }).waitFor({ timeout: 60_000 });
    await view.waitForTimeout(1500);
    await shoot(view, "hosted-first-run", FULL);
    await hosted.close();
  }

  if (step === "brand-saved") await brandSaved(); // step 5 again, on a saved brand not yet published

  if (step === "brand") {
    // How-to: read the brand from the site (one real assistant request for the voice guide, about
    // $0.30), the proposal, add material (a PDF, a picture, a note), save. Also the docs' brand
    // picture and the showcase. The saved brand is then published.
    // Start with no brand: no material, no proposal, nothing saved.
    const before = await api(`/api/sites/${SITE}/brand`);
    for (const source of before.sources ?? []) await api(`/api/sites/${SITE}/brand/sources/${source.id}`, { method: "DELETE" });
    // A proposal already read is reused (no second request) unless BRAND_READ=1.
    const reuse = Boolean(before.proposal) && process.env.BRAND_READ !== "1";
    if (before.proposal && !reuse) await api(`/api/sites/${SITE}/brand/proposal`, { method: "DELETE" });
    await discardUnder("galley/brand/");
    const material = await makeMaterial();
    await waitForPreview(page);
    await go(page, `/sites/${SITE}/brand`, 3000);
    await howto(page, "set-up-brand", 1, FULL, {
      alt: "The Brand screen for Caddow before anything is written down: Read it from this site on the left, and on the right Set it up from your material, with a drop area for guidelines, logos, screenshots, photos or notes and a box for an existing website.",
      do: "Open **Brand** in the sidebar and press **Read it from this site**.",
      see: "It measures a few pages in the preview and reads the site's styles; nothing about the site changes.",
    });
    if (!reuse) {
      await page.getByRole("button", { name: "Read it from this site" }).click();
      await until(page, "the brand proposal", async () => Boolean((await api(`/api/sites/${SITE}/brand`)).proposal), 600_000);
    }
    await go(page, `/sites/${SITE}/brand`, 3500);
    await docShot(page, "brand", 272, 190);
    await shoot(page, "brand-proposal", FULL);
    await howto(page, "set-up-brand", 2, exact(260, 370, 1140, 505), {
      alt: "The proposal read from Caddow: Worth a look notes (11 greys in use, three nearly the same; body text contrast on the home page; no logo found), and the first colours — Lime-wash, Chalk white, Plaster and Ink — each with its role, value, where it was found and Measured or Declared.",
      do: "Check the proposal. Each colour, font and size says where it came from and whether it was **Measured** on the pages or **Declared** in the styles; **Worth a look** lists anything odd. Click any name, value or colour to change it.",
    });
    const toHeading = async (h) => {
      await page.locator("main h2", { hasText: new RegExp(`^${h}`) }).first().evaluate((e) => e.scrollIntoView({ block: "start" }));
      await page.waitForTimeout(900);
    };
    await toHeading("Type");
    await shoot(page, "brand-type", FULL);
    await toHeading("Voice");
    await shoot(page, "brand-voice", FULL);
    await howto(page, "set-up-brand", 3, exact(260, 104, 1140, 712), {
      alt: "The Voice part of the proposal: the words plain, concrete, unhurried, quietly confident and honest, then numbered rules such as “Use real numbers and specifics instead of claims about quality.”, each with a line quoted from the site and a struck-through example of what not to write beside the better one.",
      do: "Read the **Voice**: written by the assistant from the site's own words, with real lines from the pages as examples.",
    });
    await toHeading("Material");
    await page.locator("main input[type=file]").last().setInputFiles(material.map((m) => m.file));
    await page.waitForTimeout(1500);
    for (const m of material) await page.getByLabel(`Note about ${m.name}`).fill(m.note);
    await page.evaluate(() => document.activeElement?.blur());
    await page.getByRole("button", { name: `Add ${material.length} files` }).click();
    await page.waitForTimeout(5000);
    await toHeading("Material");
    await shoot(page, "brand-material", FULL);
    await howto(page, "set-up-brand", 4, exact(268, 175, 1120, 700), {
      alt: "The Material part of the brand: caddow-brand-notes.pdf (2 pages, the fonts and colours inside it), caddow-wordmark.png (its colours by area) and window-notes.md (a note to read with the rest), each saying it goes into the site (galley/brand/sources/) when you save, with its note in quotes and Leave out and Remove; below, the drop area and Choose files….",
      do: "Under **Material**, drop brand guidelines, logos, screenshots or notes — or press **Choose files…** — add a note to each, and press **Add 3 files**.",
      see: "Each file says what it can be read for. **Read them** (at the top) has the assistant read them for the look and the voice.",
    });
    await page.getByRole("button", { name: "Save the brand" }).first().click();
    await until(page, "the saved brand", async () => (await page.getByText("The site’s look and voice. The assistant works inside it.").count()) > 0, 120_000);
    await brandSaved();
    await publishNow("The brand, written down");
  }

  if (step === "source") {
    // Proof › Source: the same change as lines of the page's file.
    await go(page, `/sites/${SITE}/proof`);
    await page.getByRole("tab", { name: "Source" }).first().click();
    await page.waitForTimeout(2500);
    const src = await clipOf(page, [".proof-detail__head", ".proof-detail__panel > *:first-child"], { pad: 8, aspect: 16 / 10 });
    await shoot(page, "proof-source", { ...src, height: Math.min(src.height, ABOVE_STATUS - src.y) });
  }

  if (step === "form") {
    // The form beside the page: fields made from the content, the section list.
    await openEditor(page, { assistant: false });
    await tool(page, "Click to edit");
    const sections = page.getByRole("button", { name: FORM_SECTION }).first();
    if (await sections.count()) { await sections.click(); await page.waitForTimeout(800); }
    await shoot(page, "form", await clipOf(page, [".app-editor"], { aspect: 16 / 10 }));
    await openEditor(page);
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
    await shoot(page, "arrange", await clipOf(page, [".preview"], { aspect: 16 / 10 }));
    // The docs' picture: the atelier page, its first section (Photo and text) selected.
    await openEditor(page, { form: false, assistant: false, path: ATELIER });
    await tool(page, "Arrange");
    const first = previewFrame(page).locator("[data-galley-block]").first();
    await first.scrollIntoViewIfNeeded();
    const fb = await first.boundingBox();
    await first.click({ position: { x: Math.max(40, fb.width - 120), y: 60 } });
    await page.waitForTimeout(1500);
    await docShot(page, "arrange", 268, 44, 1128);
  }

  if (step === "build-page") {
    // How-to: Arrange on the Contact page — find a section type, drag it onto the page, the result.
    // The page is put back afterwards.
    const CONTACT = "src/content/pages/contact.md";
    await openEditor(page, { form: false, assistant: false, path: CONTACT });
    await tool(page, "Arrange");
    await hideDevToolbar(page);
    await howto(page, "build-a-page", 1, FULL, {
      alt: "The editor on the Caddow Contact page with Arrange chosen above the page: on the left the Arrange panel (2 sections) with Add a section and pictures of the site's own section types — Campaign hero, Photo and text, Lookbook grid — and the page itself on the right.",
      do: "Open the page in the editor and choose **Arrange** above it.",
      see: "Click a section on the page to select it and see its options; drag its handle to move it.",
    });
    const frame = previewFrame(page);
    await frame.evaluate(() => {
      const second = document.querySelectorAll("[data-galley-block]")[1];
      window.scrollTo(0, second.getBoundingClientRect().top + window.scrollY - window.innerHeight * 0.55);
    });
    await page.waitForTimeout(1200);
    await page.getByRole("combobox", { name: "Find a section type" }).fill("Newsletter");
    await page.waitForTimeout(1000);
    await howto(page, "build-a-page", 2, exact(232, 44, 900, 562), {
      alt: "The Arrange panel with “Newsletter” typed in Find a section type…, leaving one picture: Newsletter — a sign-up form from the site's forms — beside the Contact page.",
      do: "Under **Add a section**, type in **Find a section type…** to narrow the list — here **Newsletter**.",
    });
    const card = page.locator(".builder-panel__add [role=option]").first();
    const from = await card.boundingBox();
    const frameEl = await page.locator("iframe.preview-sheet__iframe").first().boundingBox();
    const gapY = await frame.evaluate(() => document.querySelectorAll("[data-galley-block]")[1].getBoundingClientRect().top);
    const to = { x: frameEl.x + frameEl.width * 0.5, y: frameEl.y + gapY + 6 };
    await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2, { steps: 4 });
    await page.mouse.down();
    for (let i = 1; i <= 20; i++) { await page.mouse.move(from.x + (to.x - from.x) * (i / 20), from.y + (to.y - from.y) * (i / 20)); await page.waitForTimeout(30); }
    await page.waitForTimeout(800);
    // (No pointer is drawn in a capture: the line and its label show where it lands.)
    await shoot(page, "build-a-page-3", exact(268, 200, 1136, 610), { dir: HOWTO, keepPointer: true });
    guides.get("build-a-page").steps[2] = {
      image: "howto/build-a-page-3",
      alt: "Dragging the Newsletter picture onto the page: a blue line between the contact form and the next section, labelled ADD NEWSLETTER HERE, shows where it will land.",
      do: "Drag its picture onto the page. A line shows where it will land; **Escape** leaves everything as it was.",
    };
    await page.mouse.up();
    await page.waitForTimeout(3500);
    await howto(page, "build-a-page", 4, exact(268, 125, 1136, 700), {
      alt: "The new Newsletter section on the Contact page, selected as Newsletter 2/3 with its toolbar — handle, up, down, duplicate, remove, Options, Edit content — and in the panel its options: Tone and Layout.",
      do: "Let go. The section arrives with the site's own layout and empty words; switch its **Options** in the panel, and **Edit content** opens its words in the form.",
      see: "Each move is one change waiting in Proof.",
    });
    await discard([CONTACT]);
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
    // The page reloads with the new section: hide the dev server's toolbar again as it comes back.
    for (let i = 0; i < 30; i++) { await page.waitForTimeout(100); await hideDevToolbar(page); await grab(); }
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
    await discard([HOME_PAGE]);
  }

  if (step === "ask-journal") {
    // One real request to the assistant (about $0.10): the journal page's heading. Makes the docs'
    // editor overview and assistant reply. Left waiting in Proof.
    await askAssistant(page, JOURNAL, ASK_JOURNAL, { form: true });
    await docShot(page, "editor-overview", 0, 0);
    await assistantReplyDoc(page);
  }

  if (step === "assistant-reply") await assistantReplyDoc(page);

  if (step === "ask") {
    // How-to: ask for a change in words, see what it did, review it — one real request (about $0.10)
    // on the home page's campaign hero. Also the showcase "assistant". Left waiting in Proof.
    await askAssistant(page, HOME_PAGE, ASK, {
      form: false,
      before: () => howto(page, "ask-the-assistant", 1, FULL, {
        alt: "The editor on the Caddow home page with the assistant pane on the right: under Looking at /, the request “Change the campaign heading to “Coats for low sun.” and its first button to “See the eight looks”.” typed into the box, with Content chosen.",
        do: "Open the page in the editor. In the assistant pane on the right, type what you want in **Ask for a change…** and press **Enter**.",
        see: "**Looking at** shows the page you're on, so “this page” means it.",
      }),
    });
    await chatShot(page);
    await page.getByRole("button", { name: "Review in Proof" }).last().click();
    await page.waitForTimeout(3500);
    await howto(page, "ask-the-assistant", 3, { x: 232, y: 0, width: 1208, height: 620 }, {
      alt: "Proof opened on the home page's changes: the campaign hero's heading and first button with the old words struck through and the new ones written in, each with Put back, among the changes waiting to be published.",
      do: "Press **Review in Proof** to check the change in the page's own words; **Put back** undoes any one of them.",
      see: "Nothing the assistant does is live until someone presses **Publish**.",
    });
  }

  if (step === "chat") await chatShot(page);

  if (step === "proof") {
    // Proof: what changed, in content terms.
    await go(page, `/sites/${SITE}/proof`, 2500);
    await shoot(page, "proof-changes", await clipOf(page, [".proof-detail__head", ".proof-detail__panel .g-card, .proof-detail__panel > *:first-child"], { pad: 8, aspect: 16 / 10 }));
  }

  if (step === "starters") {
    // The new-site wizard's starter step: the starters and their looks.
    await go(page, "/new");
    await page.getByLabel(/Site name/i).fill("Harbour Dental");
    await page.getByRole("button", { name: "Continue" }).click();
    await page.waitForTimeout(2500);
    await shoot(page, "wizard-starters", await clipOf(page, [".wizard-steps", ".wizard-sheet"], { pad: 40 }), { maxWidth: 1800 });
  }
}

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
