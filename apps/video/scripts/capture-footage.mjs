#!/usr/bin/env node
/**
 * capture-footage — records every piece of product footage the film uses, from a
 * running Galley app and a throwaway copy of a sample site.
 *
 *   node scripts/capture-footage.mjs \
 *     --app http://127.0.0.1:4480 --token <session token> \
 *     --site-id <site id> --site /path/to/sample-site
 *
 * Options
 *   --live-port 4481        port for the built "live site" this script serves (stopped at the end)
 *   --node-modules <dir>    node_modules to symlink into the live build (default: galley/starters/astro-editorial/node_modules)
 *   --request "<text>"      what to ask the assistant (default below)
 *   --heading "<text>"      the heading the request produces (used to know when the preview has updated)
 *   --from "<text>"         the heading as it is on the live site (found struck out in Proof)
 *   --value "<text>"        with --no-ai: the new heading as stored (e.g. "Coats for *low sun*."); default --heading
 *   --live-build            serve a production build as the live site (default: the site's own dev server)
 *   --no-ai                 make the edit through the content API instead of the assistant (no model call,
 *                           no new editor-ask.mp4; every other take is captured). Publishing still asks the
 *                           assistant for a version note unless --note "<text>" is given.
 *   --note "<text>"         type this version note instead of waiting for the suggested one
 *   --only live,ask,proof,publish   capture a subset (ask must run before proof/publish unless --no-ai)
 *   --keep                  leave the sample site's new commits in place (default: rewind to where it started)
 *   --out <dir>             default: assets/footage
 *   --scale 2 --width 1440 --height 900
 *
 * Model calls (each costs a few cents): the assistant request (1) and the version note the Publish
 * dialog suggests (1). A full run spends 2; --no-ai --note "…" spends 0.
 *
 * Outputs (stable names; the compositions reference these):
 *   (stills are JPEG q≈92 at device resolution: the photographs make PNGs ~2.5 MB each)
 *   site-live.jpg            the live site, top of the home page
 *   site-after.jpg           the same page with the change (the preview's own server, no app chrome)
 *   editor-ask.mp4           click the heading → inline editor → ask the assistant → the page updates
 *   editor-before.jpg        editor, nothing changed
 *   editor-after.jpg         editor after the change, reply in the chat
 *   proof-what-changed.jpg   Proof › What changed
 *   proof-on-the-page.jpg    Proof › On the page (live site beside proposed)
 *   publish-dialog.jpg       Publish dialog
 *   publish-done.jpg         Published outcome
 *   history.jpg              Version history
 *   manifest.json            viewport, scale, element boxes (CSS px) and event times in editor-ask.mp4
 *
 * Needs: playwright-core with a cached Chromium (PLAYWRIGHT_FROM=/path/to/node_modules/), git,
 * ffmpeg (FFMPEG_PATH), npm. It never prints or saves the token.
 */
import { createRequire } from "node:module";
import { execFileSync, spawn, spawnSync } from "node:child_process";
import { createServer } from "node:http";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync, statSync, createReadStream } from "node:fs";
import { tmpdir } from "node:os";
import { extname, join, resolve } from "node:path";
import { FFMPEG, PROJECT, args, p, round, run } from "./lib/common.mjs";

const opt = args();
const need = (k) => {
  if (!opt[k]) {
    console.error(`--${k} is required (see the header of this file)`);
    process.exit(2);
  }
  return opt[k];
};
const APP = need("app").replace(/\/$/, "");
const TOKEN = need("token");
const SITE_ID = need("site-id");
const SITE = resolve(need("site"));
const LIVE_PORT = Number(opt["live-port"] || 4481);
const NODE_MODULES = resolve(opt["node-modules"] || resolve(PROJECT, "..", "..", "starters", "astro-editorial", "node_modules"));
// The film's example: Caddow (starters/astro-editorial), its campaign heading over the photograph.
// The heading is clicked first, so the request can say "it" (the clicked text rides along with it).
const REQUEST = opt.request || "Make it shorter: “Coats for low sun.”";
const HEADING = opt.heading || "Coats for low sun.";
const FROM = opt.from || "Coats for the long afternoon.";
// --no-ai: the value written through the content API (as stored, markdown included).
const VALUE = opt.value || HEADING;
const OUT = resolve(opt.out || p("assets", "footage"));
const SCALE = Number(opt.scale || 2);
const VIEW = { width: Number(opt.width || 1440), height: Number(opt.height || 900) };
const ONLY = new Set((opt.only || "live,ask,proof,publish").split(","));
const NO_AI = Boolean(opt["no-ai"]);
// playwright-core is not a dependency of this project: point PLAYWRIGHT_FROM at any folder whose
// node_modules holds it (with its Chromium already downloaded); default: this project.
const PLAYWRIGHT_FROM = (process.env.PLAYWRIGHT_FROM || p("node_modules")).replace(/\/?$/, "/");
let chromium;
try {
  ({ chromium } = createRequire(PLAYWRIGHT_FROM)("playwright-core"));
} catch {
  console.error(`playwright-core not found from ${PLAYWRIGHT_FROM}. Set PLAYWRIGHT_FROM=/path/to/a/node_modules/ that has it.`);
  process.exit(2);
}

// The people shown in Version history are the sample site's own fictional team (Caddow's maker).
const AUTHOR = { name: "Hesper Lowe", email: "hesper@caddow.example" };

mkdirSync(OUT, { recursive: true });
const manifest = existsSync(join(OUT, "manifest.json")) ? JSON.parse(readFileSync(join(OUT, "manifest.json"), "utf8")) : {};
Object.assign(manifest, { viewport: VIEW, scale: SCALE, request: REQUEST, heading: HEADING });
const log = (...m) => console.log("·", ...m);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const git = (...a) => execFileSync("git", ["-C", SITE, ...a], { encoding: "utf8" }).trim();
const api = async (method, path, body) => {
  const res = await fetch(`${APP}${path}`, {
    method,
    headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(`${method} ${path.replace(TOKEN, "…")} → HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);
  return res.json();
};

// ───────────────────────────────────────────────────────────── site setup
function resetTree() {
  git("checkout", "--", ".");
  git("clean", "-fd");
}
resetTree();
const START = git("rev-parse", "HEAD");
git("config", "--local", "user.name", AUTHOR.name);
git("config", "--local", "user.email", AUTHOR.email);
log(`sample site at ${START.slice(0, 7)}`);

// A remote, so Publish reads as "goes live" (a bare repo in the temp folder when the site has none).
let ownRemote = null;
if (!git("remote").split("\n").includes("origin")) {
  ownRemote = join(tmpdir(), `galley-video-remote-${SITE_ID}.git`);
  if (!existsSync(ownRemote)) execFileSync("git", ["init", "-q", "--bare", ownRemote]);
  git("remote", "add", "origin", ownRemote);
}
spawnSync("git", ["-C", SITE, "push", "-q", "-f", "origin", "HEAD"], { stdio: "ignore" });

// Build the unmodified site and serve it as "the live site".
const liveDir = mkdtempSync(join(tmpdir(), "galley-video-live-"));
execFileSync("sh", ["-c", `git -C "${SITE}" archive HEAD | tar -x -C "${liveDir}"`]);
rmSync(join(liveDir, "node_modules"), { recursive: true, force: true }); // the sample repo may carry its own link
symlinkSync(NODE_MODULES, join(liveDir, "node_modules"));
// The live site: by default the unmodified copy run by its own dev server, so the live side and the
// proposed side of Proof are rendered the same way and differ only by the change. (--live-build serves
// a production build instead; Caddow's build sets its display face at a different optical size than
// its dev server does, so in Proof the two headings would also differ in weight.)
let server, devServer;
if (opt["live-build"]) {
  log("building the live site");
  run("npm", ["--prefix", liveDir, "run", "build"], { env: { PATH: process.env.PATH, HOME: process.env.HOME } });
  const TYPES = { ".html": "text/html; charset=utf-8", ".css": "text/css", ".js": "text/javascript", ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg", ".webp": "image/webp", ".woff2": "font/woff2", ".json": "application/json", ".xml": "application/xml", ".ico": "image/x-icon" };
  const dist = join(liveDir, "dist");
  server = createServer((req, res) => {
    let path = decodeURIComponent(new URL(req.url, "http://x").pathname);
    let file = join(dist, path);
    if (!file.startsWith(dist)) return res.writeHead(403).end();
    if (existsSync(file) && statSync(file).isDirectory()) file = join(file, "index.html");
    if (!existsSync(file)) return res.writeHead(404).end("not found");
    res.writeHead(200, { "Content-Type": TYPES[extname(file)] || "application/octet-stream" });
    createReadStream(file).pipe(res);
  });
  await new Promise((ok, fail) => server.once("error", fail).listen(LIVE_PORT, "127.0.0.1", ok));
} else {
  log("starting the live site");
  devServer = spawn(join(liveDir, "node_modules", ".bin", "astro"), ["dev", "--port", String(LIVE_PORT), "--host", "127.0.0.1"], { cwd: liveDir, env: { PATH: process.env.PATH, HOME: process.env.HOME, ASTRO_TELEMETRY_DISABLED: "1" }, stdio: "ignore" });
  const t0 = Date.now();
  for (;;) {
    const ok = await fetch(`http://127.0.0.1:${LIVE_PORT}/`).then((r) => r.ok).catch(() => false);
    if (ok) break;
    if (Date.now() - t0 > 90000) throw new Error("the live site's dev server did not start");
    await sleep(500);
  }
}
const LIVE = `http://127.0.0.1:${LIVE_PORT}`;
log(`live site served at ${LIVE}`);

// Point the site's "live site" address at it (Settings › Addresses), and publish that setting so
// Proof shows only the content change.
const { config } = await api("GET", `/api/sites/${SITE_ID}/config`);
if (config?.urls?.production !== LIVE) {
  await api("PUT", `/api/sites/${SITE_ID}/config`, { config: { ...(config || {}), urls: { ...(config?.urls || {}), production: LIVE } } });
  git("add", "galley.config.json");
  git("commit", "-q", "-m", "Add the live site address");
  spawnSync("git", ["-C", SITE, "push", "-q", "-f", "origin", "HEAD"], { stdio: "ignore" });
}
await api("POST", `/api/sites/${SITE_ID}/refresh`);
// Versions are signed by the sample studio's fictional editor, not by whoever runs this script.
// (App setting "author"; cleared again at the end so the app falls back to git's own identity.)
await api("PATCH", "/api/settings", { author: AUTHOR });
// The live-site comparison is set up when the preview starts: restart it and wait for both.
await api("POST", `/api/sites/${SITE_ID}/preview/restart`);
{
  const t0 = Date.now();
  let st = null;
  while (Date.now() - t0 < 120000) {
    st = await api("GET", `/api/sites/${SITE_ID}/preview`);
    if (st.state === "ready" && st.baselineUrl) break;
    await sleep(500);
  }
  if (!st?.baselineUrl) throw new Error(`the preview did not pick up the live site (state: ${st?.state})`);
  log(`preview ready; comparing with the ${st.baselineSource} site`);
}

// ───────────────────────────────────────────────────────────── browser
// The scale is forced on the browser (not emulated per context) so the CDP screencast delivers
// device-resolution frames too; with an emulated scale it stays at CSS size.
const browser = await chromium.launch({ args: [`--force-device-scale-factor=${SCALE}`] });
const context = await browser.newContext({ viewport: VIEW, reducedMotion: "no-preference" });
// Hide the Astro dev toolbar inside previews (it belongs to the site's dev server, not the product).
await context.addInitScript(() => {
  const css = "astro-dev-toolbar{display:none!important}";
  const add = () => {
    if (!document.head) return;
    const s = document.createElement("style");
    s.textContent = css;
    document.head.appendChild(s);
  };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", add);
  else add();
});
const page = await context.newPage();
await page.goto(`${APP}/?token=${TOKEN}`); // exchanged for a cookie; never captured
await sleep(800);

const box = async (locator) => {
  const b = await locator.boundingBox();
  return b ? { x: round(b.x, 1), y: round(b.y, 1), w: round(b.width, 1), h: round(b.height, 1) } : null;
};
const shot = async (name) => {
  await page.mouse.move(VIEW.width - 2, VIEW.height - 2); // park the pointer: no hover states in stills
  await sleep(250);
  await deviceShot(page, join(OUT, name));
  log(`saved ${name}`);
};
/** A JPEG at device resolution (page.screenshot would give CSS size under a forced scale). */
async function deviceShot(target, file) {
  const cdp = await context.newCDPSession(target);
  const { data } = await cdp.send("Page.captureScreenshot", { format: "jpeg", quality: 92, captureBeyondViewport: false });
  writeFileSync(file, Buffer.from(data, "base64"));
  await cdp.detach().catch(() => {});
}
const previewFrame = (n = 0) => page.frames().filter((f) => f !== page.mainFrame() && /^https?:\/\/127\.0\.0\.1:\d+\//.test(f.url()) && !f.url().startsWith(APP))[n];
async function waitForPreviewHeading(frameIndex = 0, text = null, timeout = 60000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) {
    const f = previewFrame(frameIndex);
    if (f) {
      const h = await f.locator("h1").first().textContent({ timeout: 1000 }).catch(() => null);
      if (h && (!text || h.replace(/\s+/g, " ").includes(text.replace(/[.”“]/g, "").trim()))) return f;
    }
    await sleep(100);
  }
  throw new Error(`preview heading ${text ? `“${text}”` : ""} did not appear`);
}
async function headingBoxInPage(frame) {
  // Playwright reports boxes of elements inside frames relative to the main viewport (frame offset and
  // any scaling of the frame already applied).
  const hb = await frame.locator("h1").first().boundingBox();
  return { x: round(hb.x, 1), y: round(hb.y, 1), w: round(hb.width, 1), h: round(hb.height, 1) };
}
async function openEditor() {
  await page.goto(`${APP}/sites/${SITE_ID}/edit?path=src/content/pages/index.md`);
  await page.getByRole("button", { name: "Publish" }).waitFor();
  for (const name of ["Collapse sidebar", "Hide form"]) {
    const b = page.getByRole("button", { name });
    if (await b.isVisible().catch(() => false)) await b.click();
  }
  await waitForPreviewHeading(0);
  await sleep(1500);
}

/** The changed page on its own, as visitors will see it: the preview's dev server in a plain tab. */
async function siteAfter() {
  const url = previewFrame(0)?.url();
  if (!url) return log("no preview address: site-after.jpg not taken");
  const tab = await context.newPage();
  await tab.goto(url, { waitUntil: "networkidle" });
  await sleep(1500);
  await deviceShot(tab, join(OUT, "site-after.jpg"));
  manifest.after = { heading: await box(tab.locator("h1").first()) };
  await tab.close();
  log("saved site-after.jpg");
}

/** CDP screencast → numbered JPEG frames with timestamps → constant-30-fps H.264. */
async function startRecording() {
  const dir = mkdtempSync(join(tmpdir(), "galley-video-frames-"));
  const cdp = await context.newCDPSession(page);
  const frames = [];
  cdp.on("Page.screencastFrame", async ({ data, metadata, sessionId }) => {
    const file = join(dir, `f${String(frames.length).padStart(5, "0")}.jpg`);
    writeFileSync(file, Buffer.from(data, "base64"));
    frames.push({ file, t: metadata.timestamp });
    await cdp.send("Page.screencastFrameAck", { sessionId }).catch(() => {});
  });
  await cdp.send("Page.startScreencast", { format: "jpeg", quality: 92, maxWidth: VIEW.width * SCALE, maxHeight: VIEW.height * SCALE, everyNthFrame: 1 });
  await sleep(400);
  const t0 = Date.now() / 1000;
  return {
    now: () => round(Date.now() / 1000 - t0, 3),
    async stop(outFile) {
      const tEnd = Date.now() / 1000;
      await cdp.send("Page.stopScreencast");
      await sleep(300);
      // First frame sits at t0 (held from before); the rest keep their own timestamps.
      const list = [];
      const usable = frames.filter((f) => f.t >= t0 - 1);
      for (let k = 0; k < usable.length; k++) {
        const start = Math.max(usable[k].t, t0);
        const next = k + 1 < usable.length ? Math.max(usable[k + 1].t, t0) : tEnd;
        const d = Math.max(next - start, 0.001);
        list.push(`file '${usable[k].file}'`, `duration ${d.toFixed(4)}`);
      }
      list.push(`file '${usable.at(-1).file}'`);
      const listFile = join(dir, "list.txt");
      writeFileSync(listFile, list.join("\n") + "\n");
      // Leading hold: the first frame shown from t0 even if the screencast's first frame came later.
      const lead = Math.max(usable[0].t - t0, 0);
      run(FFMPEG, ["-y", "-v", "error", "-f", "concat", "-safe", "0", "-i", listFile, "-vf", `tpad=start_duration=${lead.toFixed(3)}:start_mode=clone,fps=30,format=yuv420p`, "-c:v", "libx264", "-preset", "slow", "-crf", "15", "-movflags", "+faststart", "-an", outFile]);
      rmSync(dir, { recursive: true, force: true });
      log(`saved ${outFile.split("/").pop()} (${usable.length} frames, ${(tEnd - t0).toFixed(1)} s)`);
    },
  };
}

let modelCalls = 0;
try {
  // ─────────────────────────────────────────── take: the live site
  if (ONLY.has("live")) {
    const live = await context.newPage();
    await live.goto(LIVE);
    await live.waitForLoadState("networkidle");
    await sleep(2500); // the campaign photograph fades in
    await deviceShot(live, join(OUT, "site-live.jpg"));
    manifest.live = { heading: await box(live.locator("h1").first()), url: "/" };
    await live.close();
    log("saved site-live.jpg");
  }

  // ─────────────────────────────────────────── take: click the text, then ask
  if (ONLY.has("ask") && !NO_AI) {
    await openEditor();
    await shot("editor-before.jpg");
    const frame = previewFrame(0);
    const heading = await headingBoxInPage(frame);
    const rec = await startRecording();
    const ev = {};
    await sleep(700);
    // Click the heading on the page: the inline editor opens on it.
    const cx = heading.x + heading.w * 0.42, cy = heading.y + heading.h * 0.32;
    await page.mouse.move(cx, cy, { steps: 12 });
    ev.hover = rec.now();
    await sleep(500);
    await page.mouse.click(cx, cy);
    ev.click = rec.now();
    const keep = page.getByRole("button", { name: "Leave as is" });
    await keep.waitFor({ timeout: 10000 });
    ev.popover = rec.now();
    const popover = await box(page.getByText("Leave as is").locator("xpath=ancestor::*[contains(@class,'pop') or @role='dialog'][1]")).catch(() => null);
    await sleep(1600);
    const keepBox = await box(keep);
    await page.mouse.move(keepBox.x + keepBox.w / 2, keepBox.y + keepBox.h / 2, { steps: 8 });
    await page.mouse.click(keepBox.x + keepBox.w / 2, keepBox.y + keepBox.h / 2);
    ev.leave = rec.now();
    await sleep(600);
    // Ask the assistant.
    const composer = page.locator("#chat-composer");
    const composerBox = await box(composer);
    await page.mouse.move(composerBox.x + 40, composerBox.y + composerBox.h / 2, { steps: 10 });
    await composer.click();
    ev.typeStart = rec.now();
    await composer.pressSequentially(REQUEST, { delay: 42 });
    ev.typeEnd = rec.now();
    await sleep(500);
    if (opt["dry-ask"]) {
      // Rehearsal: everything up to the request, nothing sent.
      ev.end = rec.now();
      await rec.stop(join(OUT, "editor-ask-dry.mp4"));
      manifest.askDry = { events: ev, boxes: { heading, popover, leaveAsIs: keepBox, composer: composerBox } };
      await composer.fill("");
      throw Object.assign(new Error("dry-ask: stopped before sending"), { dry: true });
    }
    await page.keyboard.press("Enter");
    modelCalls++;
    ev.send = rec.now();
    await waitForPreviewHeading(0, HEADING, 120000);
    ev.headingChanged = rec.now();
    const reviewBtn = page.getByRole("button", { name: "Review in Proof" }).last();
    await reviewBtn.waitFor({ timeout: 120000 });
    ev.replyDone = rec.now();
    await sleep(1800);
    ev.end = rec.now();
    await rec.stop(join(OUT, "editor-ask.mp4"));
    manifest.ask = {
      file: "editor-ask.mp4",
      events: ev,
      boxes: {
        heading,
        popover,
        leaveAsIs: keepBox,
        composer: composerBox,
        reviewInProof: await box(reviewBtn),
        headingAfter: await headingBoxInPage(previewFrame(0)),
        assistantPanel: await box(page.locator("#chat-composer").locator("xpath=ancestor::aside[1]")).catch(() => null),
      },
    };
    await shot("editor-after.jpg");
    await siteAfter();
  } else if (NO_AI && (ONLY.has("proof") || ONLY.has("publish"))) {
    const entry = await api("GET", `/api/sites/${SITE_ID}/entry?path=${encodeURIComponent("src/content/pages/index.md")}`);
    const idx = (entry.data?.sections || []).findIndex((s) => /hero$/.test(s.type));
    await api("PATCH", `/api/sites/${SITE_ID}/entry?path=${encodeURIComponent("src/content/pages/index.md")}`, { ops: [{ op: "set", path: ["sections", idx < 0 ? 0 : idx, "heading"], value: VALUE }] });
    log("made the edit through the content API (--no-ai)");
    await openEditor();
    await waitForPreviewHeading(0, HEADING);
    await siteAfter();
  }

  // ─────────────────────────────────────────── take: Proof
  if (ONLY.has("proof")) {
    await page.goto(`${APP}/sites/${SITE_ID}/proof`);
    await page.getByRole("tab", { name: "What changed" }).waitFor({ timeout: 20000 });
    await page.getByText(HEADING.replace(/[.]$/, "")).first().waitFor({ timeout: 20000 });
    await sleep(1200);
    await shot("proof-what-changed.jpg");
    const inserted = page.getByText(HEADING.replace(/[.]$/, "")).first();
    manifest.proof = {
      boxes: {
        inserted: await box(inserted),
        row: await box(inserted.locator("xpath=ancestor::*[contains(@class,'row') or self::li or self::section][1]")).catch(() => null),
        deleted: await box(page.getByText(FROM.replace(/[.]$/, "")).first()).catch(() => null),
        publish: await box(page.getByRole("button", { name: "Publish" }).first()),
        tabOnThePage: await box(page.getByRole("tab", { name: "On the page" })),
      },
    };
    await page.getByRole("tab", { name: "On the page" }).click();
    // Two previews: the live site and the proposed page.
    const t0 = Date.now();
    while (Date.now() - t0 < 60000) {
      const fs = page.frames().filter((f) => f !== page.mainFrame());
      const hs = await Promise.all(fs.map((f) => f.locator("h1").first().textContent({ timeout: 500 }).catch(() => null)));
      if (hs.filter(Boolean).length >= 2) break;
      await sleep(200);
    }
    await sleep(2500);
    await shot("proof-on-the-page.jpg");
    const frames = page.frames().filter((f) => f !== page.mainFrame());
    const heads = [];
    for (const f of frames) {
      const txt = await f.locator("h1").first().textContent({ timeout: 500 }).catch(() => null);
      if (txt) {
        const text = txt.replace(/\s+/g, " ").trim();
        heads.push({ side: text.includes(HEADING.replace(/[.]$/, "")) ? "proposed" : "live", text, box: await headingBoxInPage(f) });
      }
    }
    manifest.proof.onThePage = { headings: heads, publish: await box(page.getByRole("button", { name: "Publish" }).first()) };
  }

  // ─────────────────────────────────────────── take: Publish
  if (ONLY.has("publish")) {
    if (!ONLY.has("proof")) await page.goto(`${APP}/sites/${SITE_ID}/proof`);
    await page.getByRole("button", { name: "Publish" }).first().click();
    const dialog = page.getByRole("dialog");
    await dialog.waitFor();
    const note = dialog.getByPlaceholder("What changed, in a few words");
    if (opt.note) {
      await note.fill(opt.note);
    } else {
      modelCalls++;
      const t0 = Date.now();
      while (Date.now() - t0 < 30000 && !(await note.inputValue().catch(() => ""))) await sleep(200);
    }
    await sleep(600);
    const confirm = dialog.getByRole("button", { name: /^Publish \d+ change/ });
    await shot("publish-dialog.jpg");
    manifest.publish = { dialog: await box(dialog), confirm: await box(confirm), note: await note.inputValue().catch(() => "") };
    await confirm.click();
    await dialog.getByText("Published.").or(dialog.getByRole("status")).first().waitFor({ timeout: 60000 });
    await sleep(900);
    await shot("publish-done.jpg");
    manifest.publish.done = await box(page.getByRole("dialog"));
    const sha = git("rev-parse", "--short", "HEAD");
    manifest.publish.commit = {
      sha,
      subject: git("log", "-1", "--format=%s"),
      author: git("log", "-1", "--format=%an"),
      files: git("show", "--stat", "--format=", "HEAD").split("\n").filter(Boolean),
      diff: git("show", "--format=", "--unified=0", "HEAD").split("\n").filter((l) => /^[+-][^+-]/.test(l)),
    };
    await page.goto(`${APP}/sites/${SITE_ID}/history`);
    await sleep(2000);
    await shot("history.jpg");
    const latest = page.getByText(manifest.publish.commit.subject).first();
    manifest.history = { latest: await box(latest), row: await box(latest.locator("xpath=ancestor::li[1]")).catch(() => null) };
  }
} catch (err) {
  if (!err.dry) throw err;
  log(err.message);
} finally {
  manifest.modelCalls = modelCalls;
  manifest.capturedWith = { app: "local Galley", sampleSite: "astro-editorial (Caddow)", note: "Times in ask.events are seconds into editor-ask.mp4; boxes are CSS px in the viewport (multiply by scale for image px)." };
  writeFileSync(join(OUT, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
  await browser.close().catch(() => {});
  server?.close();
  devServer?.kill();
  rmSync(liveDir, { recursive: true, force: true });
  if (!opt.keep) {
    resetTree();
    git("reset", "-q", "--hard", START);
    spawnSync("git", ["-C", SITE, "push", "-q", "-f", "origin", "HEAD"], { stdio: "ignore" });
    await api("POST", `/api/sites/${SITE_ID}/refresh`).catch(() => {});
    log(`sample site rewound to ${START.slice(0, 7)}`);
  }
  if (ownRemote) git("remote", "remove", "origin");
  await api("PATCH", "/api/settings", { author: { name: "", email: "" } }).catch(() => {});
  log(`model calls this run: ${modelCalls}`);
}
