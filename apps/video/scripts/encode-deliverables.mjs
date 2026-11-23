#!/usr/bin/env node
/**
 * encode-deliverables — the rendered master → the files the website uses.
 *
 *   node scripts/encode-deliverables.mjs [--master renders/galley-explainer-master.mp4] [--out ../site/public/video]
 *                                        [--video-bitrate 640k] [--webm-bitrate 420k] [--poster-at <seconds>] [--no-webm]
 *
 * Writes (name: galley-explainer):
 *   .mp4          H.264 High 4.1 + AAC 96k, two-pass at ~640 kb/s (≈ 2.8 MB for 31 s), faststart
 *                 (audio trimmed 1.2 dB so the encoded true peak stays under −1 dBTP)
 *   .webm         VP9 two-pass at ~420 kb/s + Opus 64k (≈ 1.9 MB)
 *   The site shows the film ~620–830 px wide; the size targets are ≤ 3 MB (mp4) and ≤ 2 MB (webm).
 *   -poster.webp  the proof moment (live site beside the proposed page), 1920×1080
 *   .en.vtt/.txt  captions and transcript from the voice timings (scripts/make-captions.mjs)
 */
import { mkdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { FFMPEG, args, p, probeDuration, run } from "./lib/common.mjs";

const opt = args();
const master = resolve(opt.master || p("renders", "galley-explainer-master.mp4"));
const out = resolve(opt.out || p("..", "site", "public", "video"));
const name = "galley-explainer";
const vb = opt["video-bitrate"] || "640k";
const vbWebm = opt["webm-bitrate"] || "420k";
mkdirSync(out, { recursive: true });

// Poster time: 2.15 s after the click that opens "On the page" (the window has grown, the line is set).
let posterAt = opt["poster-at"] ? Number(opt["poster-at"]) : null;
if (posterAt === null) {
  const m = readFileSync(p("index.html"), "utf8").match(/window\.__FILM = (\{.*?\});<\/script>/s);
  const film = m ? JSON.parse(m[1]) : null;
  posterAt = film ? film.scenes["s3-proof"].start + film.s3.click + 2.15 : 17.3;
}

const log = join(tmpdir(), `galley-x264-${process.pid}`);
const mp4 = join(out, `${name}.mp4`);
run(FFMPEG, ["-v", "error", "-y", "-i", master, "-c:v", "libx264", "-preset", "slow", "-b:v", vb, "-pass", "1", "-passlogfile", log, "-an", "-f", "mp4", "/dev/null"]);
run(FFMPEG, ["-v", "error", "-y", "-i", master, "-c:v", "libx264", "-preset", "slow", "-b:v", vb, "-maxrate", "1600k", "-bufsize", "3200k", "-pass", "2", "-passlogfile", log, "-profile:v", "high", "-level", "4.1", "-pix_fmt", "yuv420p", "-af", "volume=-1.2dB", "-c:a", "aac", "-b:a", "96k", "-ar", "48000", "-movflags", "+faststart", mp4]);
for (const suffix of ["-0.log", "-0.log.mbtree"]) rmSync(log + suffix, { force: true });

if (!opt["no-webm"]) {
  const vp9 = ["-c:v", "libvpx-vp9", "-b:v", vbWebm, "-deadline", "good", "-cpu-used", "2", "-row-mt", "1", "-tile-columns", "2", "-pix_fmt", "yuv420p", "-passlogfile", log + "-vp9"];
  run(FFMPEG, ["-v", "error", "-y", "-i", master, ...vp9, "-pass", "1", "-an", "-f", "webm", "/dev/null"]);
  run(FFMPEG, ["-v", "error", "-y", "-i", master, ...vp9, "-pass", "2", "-af", "volume=-1.2dB", "-c:a", "libopus", "-b:a", "64k", join(out, `${name}.webm`)]);
  rmSync(log + "-vp9-0.log", { force: true });
}
run(FFMPEG, ["-v", "error", "-y", "-ss", posterAt.toFixed(3), "-i", master, "-frames:v", "1", "-c:v", "libwebp", "-quality", "86", "-compression_level", "6", join(out, `${name}-poster.webp`)]);
spawnSync(process.execPath, [p("scripts", "make-captions.mjs"), "--out", out], { stdio: "inherit" });

for (const f of [`${name}.mp4`, `${name}.webm`, `${name}-poster.webp`]) {
  try {
    const st = statSync(join(out, f));
    console.log(`${f.padEnd(28)} ${(st.size / 1e6).toFixed(2)} MB${f.endsWith("webp") ? ` (frame at ${posterAt.toFixed(2)} s)` : `  ${probeDuration(join(out, f)).toFixed(2)} s`}`);
  } catch {}
}
