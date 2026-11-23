#!/usr/bin/env node
/**
 * apply-timings — makes the edit follow the voice and the footage.
 *
 *   node scripts/apply-timings.mjs [--dry-run]
 *
 * Reads film.config.json, assets/audio/voiceover.timings.json (make-voiceover.mjs) and
 * assets/footage/manifest.json (capture-footage.mjs), then rewrites, in place:
 *   index.html               every scene host's data-start / data-duration, the root's data-duration,
 *                            the voice and music clip lengths, and the window.__FILM data block the
 *                            scenes read (word times, element boxes from the capture)
 *   compositions/s2-ask.html the four cuts of editor-ask.mp4 (start, length, media offset, speed) and
 *                            the click / typing sounds, so the click lands on the word "click" and the
 *                            heading changes on "plain" whatever the new read or recording.
 * Everything else inside a scene is timed from its own start (scene-local seconds) and from the word
 * times in window.__FILM, so it moves with the scene.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { p, readJson, round } from "./lib/common.mjs";

const dry = process.argv.includes("--dry-run");
const config = readJson(p("film.config.json"));
const vo = readJson(p("assets", "audio", "voiceover.timings.json"));
const manifest = readJson(p("assets", "footage", "manifest.json"));

// ── scenes from sentences
const scenes = {};
const lines = config.lines.map((l) => {
  const t = vo.lines.find((x) => x.id === l.id);
  if (!t) throw new Error(`voiceover.timings.json has no line "${l.id}"`);
  return { ...l, ...t };
});
lines.forEach((l, i) => {
  const start = i === 0 ? 0 : round(l.start - config.preRoll, 3);
  scenes[l.scene] = { start };
});
const lastEnd = round(lines.at(-1).end + config.tailAfterLastLine, 3);
scenes[config.endCard.scene] = { start: lastEnd };
const order = [...lines.map((l) => l.scene), config.endCard.scene];
const total = round(lastEnd + config.endCard.duration, 3);
order.forEach((id, i) => {
  const next = i + 1 < order.length ? scenes[order[i + 1]].start : total;
  scenes[id].duration = round(next - scenes[id].start, 3);
});

// ── s2: the four cuts of the editor recording
const s2 = scenes["s2-ask"];
const askLine = lines.find((l) => l.scene === "s2-ask");
const word = (line, text, n = 0) => {
  const hits = line.words.filter((w) => w.text.toLowerCase().replace(/[^a-z']/g, "") === text);
  if (!hits[n]) throw new Error(`no word "${text}" in line "${line.id}" — update apply-timings.mjs anchors to the new script`);
  return hits[n].start;
};
const ev = manifest.ask?.events;
if (!ev) throw new Error("assets/footage/manifest.json has no ask.events — run capture-footage.mjs with the ask take");
const local = (abs) => round(abs - s2.start, 3);
const tClick = local(word(askLine, "click"));
const tOr = local(word(askLine, "or"));
const tPlain = local(word(askLine, "plain"));
const cutB = round(tOr - 0.38, 3);
const B = { start: cutB, mediaStart: round(ev.typeStart - 0.1, 3), rate: 2 };
const typeSpan = ev.typeEnd + 0.25 - B.mediaStart;
const C2 = { mediaStart: round(ev.headingChanged - 0.37, 3), rate: 1 };
C2.start = round(Math.max(tPlain - 0.37, cutB + 1.0), 3);
const C1 = { mediaStart: round(ev.send - 0.15, 3), rate: 4 };
// B gets what it needs at 2x (or faster, up to 4x, if the read leaves less room); C1 takes the rest.
B.duration = round(Math.min(typeSpan / 2, C2.start - cutB - 0.35), 3);
B.rate = round(Math.min(Math.max(typeSpan / B.duration, 2), 4), 3);
C1.start = round(B.start + B.duration, 3);
C1.duration = round(C2.start - C1.start, 3);
C2.duration = round(s2.duration - C2.start, 3);
const A = { start: 0, duration: cutB, mediaStart: round(Math.max(ev.click - tClick, 0), 3), rate: 1 };
const cuts = { "s2-vid-a": A, "s2-vid-b": B, "s2-vid-c1": C1, "s2-vid-c2": C2 };
const s2Events = {
  click: round(A.start + (ev.click - A.mediaStart), 3),
  popover: round(A.start + (ev.popover - A.mediaStart), 3),
  typeStart: round(B.start + (ev.typeStart - B.mediaStart) / B.rate, 3),
  headingChanged: round(C2.start + (ev.headingChanged - C2.mediaStart), 3),
};

// ── write helpers
function setAttrs(html, id, attrs) {
  const re = new RegExp(`<([a-z0-9-]+)([^>]*?)\\sid="${id}"([^>]*)>`, "i");
  const m = html.match(re);
  if (!m) throw new Error(`no element id="${id}"`);
  let tag = m[0];
  for (const [k, v] of Object.entries(attrs)) {
    const ar = new RegExp(`\\s${k}="[^"]*"`);
    tag = ar.test(tag) ? tag.replace(ar, ` ${k}="${v}"`) : tag.replace(/\s*>$/, ` ${k}="${v}">`);
  }
  return html.replace(m[0], tag);
}

const film = {
  total,
  scenes,
  vo: lines.map((l) => ({ id: l.id, scene: l.scene, start: l.start, end: l.end, words: l.words.map((w) => ({ t: w.text, s: w.start, e: w.end })) })),
  s2: { cuts, events: s2Events },
  footage: { viewport: manifest.viewport, live: manifest.live, after: manifest.after, ask: manifest.ask?.boxes, proof: manifest.proof, publish: { dialog: manifest.publish?.dialog, confirm: manifest.publish?.confirm, done: manifest.publish?.done }, history: manifest.history },
};

let index = readFileSync(p("index.html"), "utf8");
index = setAttrs(index, "root", { "data-duration": total });
for (const id of order) index = setAttrs(index, id, { "data-start": scenes[id].start, "data-duration": scenes[id].duration });
index = setAttrs(index, "voice", { "data-duration": round(Math.min(vo.duration, total), 3) });
// Music: a little up before the first word, about 0.15 under the voice, lifted for the end card.
const endStart = scenes[config.endCard.scene].start;
// The bed also rises into the long pause after the proof line, so the proof holds on music, not silence.
const proofL = lines.find((l) => l.scene === "s3-proof"), pubL = lines.find((l) => l.scene === "s4-publish");
const lane = { version: 1, lanes: [{ target: "volume", points: [
  { t: 0, v: 0.26 }, { t: round(Math.max(lines[0].start - 0.05, 0.1), 3), v: 0.15 },
  { t: round(proofL.end + 0.05, 3), v: 0.15 }, { t: round(proofL.end + 0.5, 3), v: 0.3 }, { t: round(pubL.start - 0.35, 3), v: 0.3 }, { t: round(pubL.start - 0.05, 3), v: 0.15 },
  { t: round(endStart - 0.4, 3), v: 0.15 }, { t: round(endStart + 0.6, 3), v: 0.55 },
] }] };
index = setAttrs(index, "music", { "data-duration": total, "data-automation": JSON.stringify(lane).replace(/"/g, "&quot;") });
const block = `<!-- film-data:start (written by scripts/apply-timings.mjs; do not edit by hand) -->\n    <script>window.__FILM = ${JSON.stringify(film)};</script>\n    <!-- film-data:end -->`;
index = index.replace(/<!-- film-data:start[\s\S]*?<!-- film-data:end -->/, block);

let ask = readFileSync(p("compositions", "s2-ask.html"), "utf8");
for (const [id, c] of Object.entries(cuts)) {
  ask = setAttrs(ask, id, { "data-start": c.start, "data-duration": c.duration, "data-media-start": c.mediaStart, "data-playback-rate": c.rate });
}
// Sound peaks land one frame after their picture: start = picture + 1/30 − the file's peak time
// (peaks measured with `hyperframes audio <file> --json`: clicks 0.073 s, typing 0.457 s, whoosh 0.162 s).
const PEAK = { click: 0.073, typing: 0.457, whoosh: 0.162 };
const at = (t, peak) => round(Math.max(t + 1 / 30 - peak, 0), 3);
ask = setAttrs(ask, "s2-sfx-click", { "data-start": at(s2Events.click, PEAK.click) });
ask = setAttrs(ask, "s2-sfx-type", { "data-start": at(B.start, PEAK.typing), "data-duration": round(Math.min(B.duration + PEAK.typing - 0.1, 1.49), 3) });

// s3: the Publish click sound follows the scene's length (the click is 0.26 s before its end).
let proofHtml = readFileSync(p("compositions", "s3-proof.html"), "utf8");
proofHtml = setAttrs(proofHtml, "s3-sfx-publish", { "data-start": at(scenes["s3-proof"].duration - 0.26, PEAK.click), "data-duration": 0.2 });

// Sounds whose pictures are timed from a scene's end or from a word.
let needHtml = readFileSync(p("compositions", "s1-need.html"), "utf8");
const whooshAt = at(scenes["s1-need"].duration - 0.06, PEAK.whoosh);
needHtml = setAttrs(needHtml, "s1-sfx-whoosh", { "data-start": whooshAt, "data-duration": round(scenes["s1-need"].duration - whooshAt - 0.01, 3) });
// The end card's address: the site's own (apps/site/src/data/site.json), without the scheme.
let endHtml = readFileSync(p("compositions", "s6-end.html"), "utf8");
try {
  const site = readJson(p("..", "site", "src", "data", "site.json"));
  const address = String(site.url || "").replace(/^https?:\/\//, "").replace(/\/$/, "");
  if (address) {
    endHtml = endHtml.replace(/("id":"s6Url"[^}]*"default":")[^"]*(")/, `$1${address}$2`);
    endHtml = endHtml.replace(/(<p id="s6-url"[^>]*>)[^<]*(<\/p>)/, `$1${address}$2`);
  }
} catch (err) {
  console.warn(`site address not updated (${err.message})`);
}
const proofLine = lines.find((l) => l.scene === "s3-proof");
const tTab = round(Math.max(2.6, word(proofLine, "beside") - scenes["s3-proof"].start - 1.5), 3);
proofHtml = setAttrs(proofHtml, "s3-sfx-tab", { "data-start": at(tTab, PEAK.click) });
film.s3 = { click: tTab };
// The Proof stills swap on the click; the last still of each scene lasts to the scene's end.
proofHtml = setAttrs(proofHtml, "s3-what", { "data-start": 0, "data-duration": round(tTab + 0.05, 3) });
proofHtml = setAttrs(proofHtml, "s3-page", { "data-start": round(tTab + 0.05, 3), "data-duration": round(scenes["s3-proof"].duration - tTab - 0.05, 3) });
let pubHtml = readFileSync(p("compositions", "s4-publish.html"), "utf8");
pubHtml = setAttrs(pubHtml, "s4-hist", { "data-start": 1.75, "data-duration": round(scenes["s4-publish"].duration - 1.75, 3) });
index = index.replace(/<script>window\.__FILM = .*?;<\/script>/s, `<script>window.__FILM = ${JSON.stringify(film)};</script>`);

console.log(`film ${total} s`);
for (const id of order) console.log(`  ${id.padEnd(11)} ${scenes[id].start.toFixed(3).padStart(7)} +${scenes[id].duration.toFixed(3)}`);
for (const [id, c] of Object.entries(cuts)) console.log(`  ${id.padEnd(11)} at ${c.start} for ${c.duration} from ${c.mediaStart} ×${c.rate}`);
if (dry) process.exit(0);
writeFileSync(p("index.html"), index);
writeFileSync(p("compositions", "s2-ask.html"), ask);
writeFileSync(p("compositions", "s3-proof.html"), proofHtml);
writeFileSync(p("compositions", "s1-need.html"), needHtml);
writeFileSync(p("compositions", "s6-end.html"), endHtml);
writeFileSync(p("compositions", "s4-publish.html"), pubHtml);
console.log("updated index.html and compositions/s1-need, s2-ask, s3-proof, s4-publish, s6-end");
