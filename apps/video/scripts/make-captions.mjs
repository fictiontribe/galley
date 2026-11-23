#!/usr/bin/env node
/**
 * make-captions — assets/audio/voiceover.timings.json → WebVTT captions + plain transcript.
 *
 *   node scripts/make-captions.mjs [--out ../site/public/video] [--name galley-explainer]
 *
 * Cues follow the voice's own word timings (measured, not spread), break at punctuation,
 * keep to 42 characters a line and two lines a cue, and never overlap. The transcript adds
 * the on-screen end line, which is not spoken.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { args, p, readJson } from "./lib/common.mjs";

const opt = args();
const out = resolve(opt.out || p("..", "site", "public", "video"));
const name = opt.name || "galley-explainer";
const vo = readJson(p("assets", "audio", "voiceover.timings.json"));
const MAX_LINE = 42;

const ts = (t) => {
  const ms = Math.max(0, Math.round(t * 1000));
  const h = Math.floor(ms / 3600000), m = Math.floor((ms % 3600000) / 60000), s = Math.floor((ms % 60000) / 1000);
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}.${String(ms % 1000).padStart(3, "0")}`;
};

// Phrases: split each line's words after , : ; . ? when the phrase is long enough to stand alone.
const cues = [];
for (const line of vo.lines) {
  let cur = [];
  const flush = () => {
    if (cur.length) cues.push(cur);
    cur = [];
  };
  for (const w of line.words) {
    cur.push(w);
    const text = cur.map((x) => x.text).join(" ");
    if (/[.?!:;,]$/.test(w.text) && text.length >= 14) flush();
    else if (text.length > MAX_LINE * 2 - 8) flush();
  }
  flush();
}
// Merge a very short tail into the previous cue of the same sentence group.
const merged = [];
for (const c of cues) {
  const prev = merged.at(-1);
  const text = c.map((x) => x.text).join(" ");
  if (prev && text.length < 12 && prev.map((x) => x.text).join(" ").length + text.length < MAX_LINE * 2 - 4 && c[0].start - prev.at(-1).end < 0.4) prev.push(...c);
  else merged.push([...c]);
}
const wrap = (text) => {
  if (text.length <= MAX_LINE) return text;
  const words = text.split(" ");
  let best = null;
  for (let k = 1; k < words.length; k++) {
    const a = words.slice(0, k).join(" "), b = words.slice(k).join(" ");
    if (a.length > MAX_LINE || b.length > MAX_LINE) continue;
    const score = Math.abs(a.length - b.length);
    if (!best || score < best.score) best = { score, text: `${a}\n${b}` };
  }
  return best ? best.text : text;
};
const vtt = ["WEBVTT", "Kind: captions", "Language: en", ""];
merged.forEach((c, i) => {
  const start = c[0].start;
  const next = merged[i + 1]?.[0].start ?? Infinity;
  const end = Math.min(c.at(-1).end + 0.35, next - 0.04);
  vtt.push(String(i + 1), `${ts(start)} --> ${ts(end)}`, wrap(c.map((x) => x.text).join(" ")), "");
});

// The end card's words (on screen only): the line, the descriptor and the site's address.
let address = "galley.fictiontribe.com";
try {
  address = String(readJson(p("..", "site", "src", "data", "site.json")).url || address).replace(/^https?:\/\//, "").replace(/\/$/, "");
} catch {}
const transcript = [
  "Galley — the open-source AI CMS for Astro. Explainer video transcript.",
  "",
  ...vo.lines.map((l) => l.text),
  "",
  `On screen at the end: Prompt it. Proof it. Publish it. — Open source · built for Astro — ${address}`,
  "",
].join("\n");

mkdirSync(out, { recursive: true });
writeFileSync(join(out, `${name}.en.vtt`), vtt.join("\n"));
writeFileSync(join(out, `${name}.txt`), transcript);
console.log(`wrote ${merged.length} cues to ${join(out, `${name}.en.vtt`)} and the transcript`);
