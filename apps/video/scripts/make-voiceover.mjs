#!/usr/bin/env node
/**
 * make-voiceover — voiceover.txt → assets/audio/voiceover.wav + voiceover.timings.json
 *
 *   node scripts/make-voiceover.mjs                 # ElevenLabs if ELEVENLABS_API_KEY is set, else Kokoro (on device)
 *   node scripts/make-voiceover.mjs --provider kokoro
 *   node scripts/make-voiceover.mjs --provider elevenlabs --voice <voice_id> --model eleven_v4
 *   node scripts/make-voiceover.mjs --out /tmp/vo-test   # write somewhere else (tests)
 *   node scripts/make-voiceover.mjs --reuse              # re-lay the takes in assets/audio/lines/ after changing pauses (free)
 *   node scripts/make-voiceover.mjs --test-line "Text" --name try1 [--voice id] [--model id]   # audition one line
 *   node scripts/make-voiceover.mjs --only start      # re-record ONE line (its text from voiceover.txt) and splice it
 *                                                     # into the existing voiceover.wav; every other sample is kept
 *
 * Each line of voiceover.txt is synthesised on its own, so every sentence has an
 * exact start and end; the lines are then laid end to end with the pauses in
 * film.config.json and mixed into one file. Word timings:
 *   - ElevenLabs: from the API's character alignment (POST /v1/text-to-speech/{voice_id}/with-timestamps).
 *   - Kokoro: from `hyperframes transcribe` (whisper base.en) on each line, matched to the script's
 *     words; when the transcript does not match word for word, spread over the line by character count.
 *
 * Env: ELEVENLABS_API_KEY (switches ElevenLabs on), ELEVENLABS_API_BASE (default https://api.elevenlabs.io),
 *      ELEVENLABS_VOICE_ID / ELEVENLABS_MODEL_ID (override film.config.json),
 *      HYPERFRAMES_CLI (argv prefix for the HyperFrames CLI), HYPERFRAMES_PYTHON (python with kokoro-onnx),
 *      FFMPEG_PATH / FFPROBE_PATH.
 * After it runs: node scripts/apply-timings.mjs, then check, review and render (README).
 */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FFMPEG, args, hyperframesCli, p, probeDuration, readJson, readScript, round, run, splitWords } from "./lib/common.mjs";

const opt = args();
const config = readJson(p("film.config.json"));
const script = readScript(opt.script || p("voiceover.txt"));
const outDir = opt.out ? opt.out : p("assets", "audio");
const linesDir = join(outDir, "lines");
mkdirSync(linesDir, { recursive: true });

if (script.length !== config.lines.length) {
  throw new Error(`voiceover.txt has ${script.length} lines but film.config.json lists ${config.lines.length}. Keep one sentence group per scene.`);
}

const provider = opt.provider || (process.env.ELEVENLABS_API_KEY ? "elevenlabs" : "kokoro");
console.log(`voice: ${provider}`);
const work = mkdtempSync(join(tmpdir(), "galley-vo-"));
process.on("exit", () => rmSync(work, { recursive: true, force: true })); // also when a request fails

// ───────────────────────────────────────────────────────── ElevenLabs
let charsSent = 0;
// Tolerate a key written as KEY="…" in a dotenv file.
const API_KEY = (process.env.ELEVENLABS_API_KEY || "").trim().replace(/^(["'])(.*)\1$/, "$2");
async function elevenLabsLine(text, i, name) {
  const el = config.voice.elevenlabs;
  const voiceId = opt.voice || process.env.ELEVENLABS_VOICE_ID || el.voiceId;
  const modelId = opt.model || process.env.ELEVENLABS_MODEL_ID || el.modelId;
  const base = (process.env.ELEVENLABS_API_BASE || "https://api.elevenlabs.io").replace(/\/$/, "");
  const url = `${base}/v1/text-to-speech/${encodeURIComponent(voiceId)}/with-timestamps?output_format=${el.outputFormat}`;
  const body = {
    text,
    model_id: modelId,
    voice_settings: el.voiceSettings,
    seed: 20261123,
    previous_text: i >= 0 ? script[i - 1] ?? undefined : undefined,
    next_text: i >= 0 ? script[i + 1] ?? undefined : undefined,
  };
  if (opt.stability) body.voice_settings = { ...body.voice_settings, stability: Number(opt.stability) };
  if (opt["el-speed"]) body.voice_settings = { ...body.voice_settings, speed: Number(opt["el-speed"]) };
  charsSent += text.length;
  let res;
  for (let attempt = 0; attempt < 3; attempt++) {
    res = await fetch(url, {
      method: "POST",
      headers: { "xi-api-key": API_KEY, "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(body),
    });
    if (res.ok || (res.status !== 429 && res.status < 500)) break;
    await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)));
  }
  if (!res.ok) {
    const detail = await res.text();
    throw new Error(`ElevenLabs refused line ${i + 1} (HTTP ${res.status}): ${detail.slice(0, 400)}`);
  }
  const data = await res.json();
  if (!data.audio_base64) throw new Error("ElevenLabs response has no audio_base64");
  const mp3 = join(work, `line-${i}.mp3`);
  writeFileSync(mp3, Buffer.from(data.audio_base64, "base64"));
  const wav = join(linesDir, `${name || config.lines[i].id}.wav`);
  run(FFMPEG, ["-y", "-v", "error", "-i", mp3, "-ac", "1", "-ar", "48000", "-c:a", "pcm_s16le", wav]);
  // Prefer the alignment of the original text (its characters match the script).
  const al = data.alignment || data.normalized_alignment;
  const words = al ? wordsFromAlignment(al) : null;
  return { wav, words, voice: { provider: "elevenlabs", voiceId, model: modelId } };
}

/** Character alignment → words: a word runs from its first character's start to its last character's end. */
export function wordsFromAlignment(al) {
  const { characters: ch, character_start_times_seconds: s, character_end_times_seconds: e } = al;
  const words = [];
  let cur = null;
  for (let k = 0; k < ch.length; k++) {
    if (/\s/.test(ch[k])) {
      if (cur) words.push(cur), (cur = null);
      continue;
    }
    if (!cur) cur = { text: "", start: s[k], end: e[k] };
    cur.text += ch[k];
    cur.end = e[k];
  }
  if (cur) words.push(cur);
  return words.map((w) => ({ text: w.text, start: round(w.start), end: round(w.end) }));
}

// ───────────────────────────────────────────────────────── Kokoro (on device)
function kokoroLine(text, i) {
  const k = config.voice.kokoro;
  const voice = opt.voice || k.voice;
  const wavRaw = join(work, `line-${i}.wav`);
  const [cmd, ...pre] = hyperframesCli();
  run(cmd, [...pre, "tts", text, "-v", voice, "-s", String(opt.speed || k.speed), "-o", wavRaw, "--json"]);
  const wav = join(linesDir, `${config.lines[i].id}.wav`);
  run(FFMPEG, ["-y", "-v", "error", "-i", wavRaw, "-ac", "1", "-ar", "48000", "-c:a", "pcm_s16le", wav]);
  let words = null;
  if (!opt["no-transcribe"]) {
    try {
      const dir = mkdtempSync(join(work, "tr-"));
      run(cmd, [...pre, "transcribe", wav, "--model", "base.en", "--json", "-d", dir]);
      const tr = JSON.parse(readFileSync(join(dir, "transcript.json"), "utf8"));
      const list = Array.isArray(tr) ? tr : tr.words || [];
      words = list.map((w) => ({ text: w.text, start: w.start, end: w.end }));
    } catch (err) {
      console.warn(`  transcription unavailable for line ${i + 1} (${err.message.split("\n")[0]}); spreading words by length`);
    }
  }
  return { wav, words, voice: { provider: "kokoro", voice, speed: Number(opt.speed || k.speed) } };
}

/**
 * Match recognised words to the script's words. Same count: take their times
 * one for one (the recogniser's spelling is discarded; the script's is kept).
 * Otherwise spread the script's words over the recognised speech span by length.
 */
function alignToScript(text, recognised, duration) {
  const words = splitWords(text);
  if (recognised && recognised.length === words.length) {
    return words.map((w, k) => ({ text: w, start: round(recognised[k].start), end: round(recognised[k].end) }));
  }
  const s0 = recognised?.length ? recognised[0].start : 0.05;
  const s1 = recognised?.length ? recognised.at(-1).end : Math.max(duration - 0.05, s0 + 0.1);
  const weights = words.map((w) => w.length + 1);
  const total = weights.reduce((a, b) => a + b, 0);
  let t = s0;
  return words.map((w, k) => {
    const d = ((s1 - s0) * weights[k]) / total;
    const out = { text: w, start: round(t), end: round(t + d), estimated: true };
    t += d;
    return out;
  });
}

// ───────────────────────────────────────────────────────── one-line audition (--test-line "text")
if (opt["test-line"]) {
  const text = String(opt["test-line"]);
  const got = provider === "elevenlabs" ? await elevenLabsLine(text, -1, opt.name || "test") : kokoroLine(text, 0);
  const duration = probeDuration(got.wav);
  const words = alignToScript(text, got.words, duration);
  writeFileSync(got.wav.replace(/\.wav$/, ".words.json"), JSON.stringify({ voice: got.voice, duration, words }, null, 2) + "\n");
  const wpm = (splitWords(text).length / (words.at(-1).end - words[0].start)) * 60;
  console.log(`test: ${got.wav} ${duration.toFixed(2)} s, ${wpm.toFixed(0)} wpm while speaking${provider === "elevenlabs" ? `, ${charsSent} characters sent` : ""}`);
  rmSync(work, { recursive: true, force: true });
  process.exit(0);
}

// ───────────────────────────────────────────────────────── re-record one line (--only <id>)
// The existing voiceover.wav is kept sample for sample outside the line's slot. The new take starts
// where the old one started (after the same pause), is trimmed to its speech like every take, and is
// gain-matched to the old line's measured loudness (EBU R128 integrated) so the join is level, and
// peak-limited at −2 dBFS (the rest of the file was normalised to a −1.5 dBTP ceiling).
if (opt.only) {
  const id = String(opt.only);
  const i = config.lines.findIndex((l) => l.id === id);
  if (i < 0) throw new Error(`no line "${id}" in film.config.json`);
  const timingsFile = join(outDir, "voiceover.timings.json");
  const old = readJson(timingsFile);
  const oldLine = old.lines.find((l) => l.id === id);
  const next = old.lines[old.lines.indexOf(oldLine) + 1];
  let got;
  if (opt.reuse) {
    // Splice the take already in lines/ (free; used to test the splice).
    const saved = JSON.parse(readFileSync(join(linesDir, `${id}.words.json`), "utf8"));
    got = { wav: join(linesDir, `${id}.wav`), words: saved.words, voice: saved.voice };
  } else got = provider === "elevenlabs" ? await elevenLabsLine(script[i], i) : kokoroLine(script[i], i);
  const raw = probeDuration(got.wav);
  const words = alignToScript(script[i], got.words, raw);
  if (!opt.reuse) writeFileSync(join(linesDir, `${id}.words.json`), JSON.stringify({ voice: got.voice, words }, null, 1) + "\n");
  const sb = speechBounds(got.wav, raw);
  const s0 = Math.max(0, Math.min(words[0].start, sb.start) - 0.06), s1 = Math.min(raw, sb.end + 0.16);
  const trimmed = join(work, `trim-${id}.wav`);
  run(FFMPEG, ["-y", "-v", "error", "-i", got.wav, "-ss", s0.toFixed(3), "-to", s1.toFixed(3), "-af", "afade=t=in:d=0.02,areverse,afade=t=in:d=0.06,areverse", "-c:a", "pcm_s16le", trimmed]);
  const dur = probeDuration(trimmed);
  const lufs = (file, ss, t) => {
    const a = ss !== undefined ? ["-ss", ss.toFixed(3), "-t", t.toFixed(3)] : [];
    const log = run(FFMPEG, ["-hide_banner", "-nostats", ...a, "-i", file, "-af", "ebur128", "-f", "null", "-"]).stderr;
    return Number(log.slice(log.lastIndexOf("Summary")).match(/I:\s+(-?[\d.]+) LUFS/)[1]);
  };
  const src = join(outDir, "voiceover.wav");
  const target = lufs(src, oldLine.start, oldLine.end - oldLine.start);
  const gain = round(target - lufs(trimmed), 2);
  const start = oldLine.start, end = round(start + dur);
  if (next && end > next.start - 0.2) throw new Error(`the new take (${dur.toFixed(2)} s) runs into the next line`);
  const total = round(Math.max(end + 0.25, next ? old.duration : 0));
  const out = join(work, "voiceover.wav");
  // Old file up to 0.05 s before the slot (a 30 ms fade into the silence), then the new take at the slot.
  const cut = round(start - 0.05);
  run(FFMPEG, ["-y", "-v", "error", "-i", src, "-i", trimmed, "-filter_complex",
    `[0:a]atrim=0:${cut},afade=t=out:st=${round(cut - 0.03)}:d=0.03[a];[1:a]volume=${gain}dB,alimiter=limit=0.79:level=0:attack=2:release=40,adelay=${Math.round(start * 1000)}:all=1[b];[a][b]amix=inputs=2:normalize=0:duration=longest,apad=whole_dur=${total}[o]`,
    "-map", "[o]", "-ac", "1", "-ar", "48000", "-c:a", "pcm_s16le", "-t", String(total), out]);
  writeFileSync(src, readFileSync(out));
  Object.assign(oldLine, {
    text: script[i], end, speechStart: round(start + (words[0].start - s0)), speechEnd: round(start + Math.min(words.at(-1).end - s0, dur)),
    words: words.map((w) => ({ ...w, start: round(start + Math.max(w.start - s0, 0)), end: round(start + Math.min(w.end - s0, dur)) })),
  });
  old.duration = probeDuration(src);
  old.spliced = { line: id, gainDb: gain, matchedTo: `${target} LUFS (the old take's slot)`, at: start };
  writeFileSync(timingsFile, JSON.stringify(old, null, 2) + "\n");
  console.log(`spliced "${id}": ${dur.toFixed(2)} s at ${start.toFixed(2)} s, gain ${gain} dB → ${target} LUFS; voiceover ${old.duration.toFixed(2)} s`);
  if (provider === "elevenlabs") console.log(`ElevenLabs characters sent: ${charsSent}`);
  rmSync(work, { recursive: true, force: true });
  process.exit(0);
}

/** First and last moment above -42 dBFS (silencedetect), so takes can be trimmed to their speech. */
function speechBounds(file, duration) {
  const res = run(FFMPEG, ["-hide_banner", "-nostats", "-i", file, "-af", "silencedetect=n=-42dB:d=0.06", "-f", "null", "-"]);
  const log = res.stderr || "";
  const starts = [...log.matchAll(/silence_start: ([\d.]+)/g)].map((m) => Number(m[1]));
  const ends = [...log.matchAll(/silence_end: ([\d.]+)/g)].map((m) => Number(m[1]));
  let start = 0, end = duration;
  if (starts.length && starts[0] < 0.01 && ends.length) start = ends[0];
  if (starts.length && starts.length > ends.length) end = starts.at(-1);
  else if (ends.length && Math.abs(ends.at(-1) - duration) < 0.02 && starts.length) end = starts.at(-1);
  return { start, end };
}

// ───────────────────────────────────────────────────────── build
const lines = [];
let voiceInfo = null;
for (let i = 0; i < script.length; i++) {
  const id = config.lines[i].id;
  let got;
  if (opt.reuse) {
    // Re-lay the takes already in assets/audio/lines/ (no synthesis, no cost).
    const saved = JSON.parse(readFileSync(join(linesDir, `${id}.words.json`), "utf8"));
    got = { wav: join(linesDir, `${id}.wav`), words: saved.words, voice: saved.voice };
  } else {
    console.log(`  line ${i + 1}/${script.length}: ${script[i]}`);
    got = provider === "elevenlabs" ? await elevenLabsLine(script[i], i) : kokoroLine(script[i], i);
  }
  voiceInfo = got.voice;
  const rawDuration = probeDuration(got.wav);
  const words = alignToScript(script[i], got.words, rawDuration);
  if (!opt.reuse) writeFileSync(join(linesDir, `${id}.words.json`), JSON.stringify({ voice: got.voice, words }, null, 1) + "\n");
  // Trim each take to its speech (+ a breath), so film.config.json's pauses are the only gaps.
  // (Measured on the audio: some providers' alignment runs the first and last words into the silence.)
  const sb = speechBounds(got.wav, rawDuration);
  const s0 = Math.max(0, Math.min(words[0].start, sb.start) - 0.06), s1 = Math.min(rawDuration, sb.end + 0.16);
  const trimmed = join(work, `trim-${id}.wav`);
  run(FFMPEG, ["-y", "-v", "error", "-i", got.wav, "-ss", s0.toFixed(3), "-to", s1.toFixed(3), "-af", "afade=t=in:d=0.02,areverse,afade=t=in:d=0.06,areverse", "-c:a", "pcm_s16le", trimmed]);
  const duration = probeDuration(trimmed);
  lines.push({ ...config.lines[i], text: script[i], wav: trimmed, duration, words: words.map((w) => ({ ...w, start: round(Math.max(w.start - s0, 0)), end: round(Math.min(w.end - s0, duration)) })) });
}

// Lay the lines end to end with their pauses.
let t = 0;
for (const line of lines) {
  t += line.pauseBefore;
  line.start = round(t);
  t += line.duration;
  line.end = round(t);
}
const total = round(t + 0.25);

const out = join(outDir, "voiceover.wav");
const inputs = lines.flatMap((l) => ["-i", l.wav]);
const filters = lines.map((l, k) => `[${k}:a]adelay=${Math.round(l.start * 1000)}:all=1[d${k}]`);
const mix = `${lines.map((_, k) => `[d${k}]`).join("")}amix=inputs=${lines.length}:normalize=0:duration=longest,apad=whole_dur=${total},loudnorm=I=-16:TP=-1.5:LRA=11,aresample=48000[out]`;
run(FFMPEG, ["-y", "-v", "error", ...inputs, "-filter_complex", [...filters, mix].join(";"), "-map", "[out]", "-ac", "1", "-ar", "48000", "-c:a", "pcm_s16le", "-t", String(total), out]);

const timings = {
  $comment: "Written by scripts/make-voiceover.mjs. Times are seconds from the start of voiceover.wav (= the start of the film). words[].estimated marks words spread by length rather than measured.",
  provider: voiceInfo.provider,
  voice: voiceInfo,
  file: "assets/audio/voiceover.wav",
  duration: probeDuration(out),
  lines: lines.map((l) => ({
    id: l.id,
    scene: l.scene,
    text: l.text,
    start: l.start,
    end: l.end,
    speechStart: round(l.start + (l.words[0]?.start ?? 0)),
    speechEnd: round(l.start + (l.words.at(-1)?.end ?? l.duration)),
    words: l.words.map((w) => ({ ...w, start: round(l.start + w.start), end: round(l.start + w.end) })),
  })),
};
writeFileSync(join(outDir, "voiceover.timings.json"), JSON.stringify(timings, null, 2) + "\n");
rmSync(work, { recursive: true, force: true });
console.log(`wrote ${out} (${timings.duration.toFixed(2)} s) and voiceover.timings.json`);
if (provider === "elevenlabs") console.log(`ElevenLabs characters sent: ${charsSent}`);
for (const l of timings.lines) console.log(`  ${l.id.padEnd(8)} ${l.start.toFixed(2)} → ${l.end.toFixed(2)}  ${l.text}`);
if (!existsSync(out)) process.exit(1);
