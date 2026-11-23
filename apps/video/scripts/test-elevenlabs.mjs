#!/usr/bin/env node
/**
 * test-elevenlabs — exercises make-voiceover.mjs's ElevenLabs path against a local stand-in that
 * answers exactly like the documented API (POST /v1/text-to-speech/{voice_id}/with-timestamps →
 * { audio_base64, alignment{characters, character_start_times_seconds, character_end_times_seconds},
 *   normalized_alignment }). No network, no key, no cost.
 *
 *   node scripts/test-elevenlabs.mjs [--port 4482]
 *
 * Checks: the request shape (xi-api-key header, output_format query, text/model_id/voice_settings,
 * previous_text/next_text), the timings file (one entry per line, measured word times in order,
 * words matching the script), the WAV written, and that a 401 stops the script with the API's message.
 */
import { spawnSync } from "node:child_process";
import { createServer } from "node:http";
import { mkdtempSync, readFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FFMPEG, args, p, readScript, run, splitWords } from "./lib/common.mjs";

const opt = args();
const PORT = Number(opt.port || 4482);
const work = mkdtempSync(join(tmpdir(), "galley-el-test-"));
const requests = [];
let reject = false;

/** Silence, a tone standing in for speech, silence — as MP3 bytes (ffmpeg). */
function mp3Of(lead, speech, tail) {
  const file = join(work, `tone-${requests.length}.mp3`);
  run(FFMPEG, ["-y", "-v", "error", "-f", "lavfi", "-i", `anullsrc=r=44100:cl=mono:d=${lead}`, "-f", "lavfi", "-i", `sine=frequency=220:duration=${speech.toFixed(3)}`, "-f", "lavfi", "-i", `anullsrc=r=44100:cl=mono:d=${tail}`, "-filter_complex", "[0][1][2]concat=n=3:v=0:a=1", "-ac", "1", "-ar", "44100", "-b:a", "128k", file]);
  return readFileSync(file);
}

const server = createServer((req, res) => {
  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", () => {
    const url = new URL(req.url, "http://x");
    const m = url.pathname.match(/^\/v1\/text-to-speech\/([^/]+)\/with-timestamps$/);
    const json = body ? JSON.parse(body) : {};
    requests.push({ path: url.pathname, voice: m?.[1], query: Object.fromEntries(url.searchParams), key: req.headers["xi-api-key"], body: json });
    if (reject || !req.headers["xi-api-key"]) {
      res.writeHead(401, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({ detail: { status: "invalid_api_key", message: "Invalid API key" } }));
    }
    if (req.method !== "POST" || !m || !json.text) {
      res.writeHead(422, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({ detail: [{ loc: ["body", "text"], msg: "field required", type: "value_error.missing" }] }));
    }
    // 0.15 s lead-in, 0.06 s a character, 0.2 s tail — like a real take, with silence at both ends.
    const chars = [...json.text];
    const lead = 0.15, per = 0.06;
    const starts = chars.map((_, k) => +(lead + k * per).toFixed(3));
    const ends = chars.map((_, k) => +(lead + (k + 1) * per).toFixed(3));
    const audio = mp3Of(lead, chars.length * per, 0.2);
    const alignment = { characters: chars, character_start_times_seconds: starts, character_end_times_seconds: ends };
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ audio_base64: audio.toString("base64"), alignment, normalized_alignment: alignment }));
  });
});
await new Promise((ok) => server.listen(PORT, "127.0.0.1", ok));

const fails = [];
const check = (cond, msg) => (cond ? console.log(`  ✓ ${msg}`) : (fails.push(msg), console.log(`  ✗ ${msg}`)));
const env = { ...process.env, ELEVENLABS_API_KEY: "test-key-not-real", ELEVENLABS_API_BASE: `http://127.0.0.1:${PORT}` };
const runVo = (out) =>
  new Promise((resolve) => {
    // Async spawn so this process keeps serving requests while the script runs.
    import("node:child_process").then(({ spawn }) => {
      const child = spawn(process.execPath, [p("scripts", "make-voiceover.mjs"), "--provider", "elevenlabs", "--out", out], { env });
      let stdout = "", stderr = "";
      child.stdout.on("data", (d) => (stdout += d));
      child.stderr.on("data", (d) => (stderr += d));
      child.on("close", (status) => resolve({ status, stdout, stderr }));
    });
  });

console.log("ElevenLabs path against a scripted API:");
const out = join(work, "ok");
const r1 = await runVo(out);
check(r1.status === 0, "make-voiceover exits 0");
const script = readScript();
check(requests.length === script.length, `one request per line (${requests.length}/${script.length})`);
const q = requests[0] || {};
check(q.key === "test-key-not-real", "sends the key in the xi-api-key header");
check(q.query?.output_format === "mp3_44100_128", "asks for output_format=mp3_44100_128");
check(typeof q.body?.model_id === "string" && q.body.voice_settings && typeof q.body.voice_settings.stability === "number", "sends model_id and voice_settings");
check(requests[1]?.body?.previous_text === script[0] && requests[1]?.body?.next_text === script[2], "sends previous_text / next_text for continuity");
const timingsFile = join(out, "voiceover.timings.json");
if (existsSync(timingsFile)) {
  const t = JSON.parse(readFileSync(timingsFile, "utf8"));
  check(t.provider === "elevenlabs" && t.lines.length === script.length, "timings: provider and one entry per line");
  const allWords = t.lines.flatMap((l) => l.words);
  check(t.lines.every((l, k) => l.words.map((w) => w.text).join(" ") === splitWords(script[k]).join(" ")), "timings: words match the script");
  check(allWords.every((w) => !w.estimated), "timings: every word time is measured (from the alignment)");
  check(allWords.every((w, k) => w.end >= w.start && (k === 0 || w.start >= allWords[k - 1].start)), "timings: word times increase");
  const first = t.lines[0];
  check(Math.abs(first.words[0].start - first.start) < 0.12, "timings: the take was trimmed to its speech (first word within 0.12 s of the line start)");
  check(existsSync(join(out, "voiceover.wav")), "writes voiceover.wav");
} else check(false, "writes voiceover.timings.json");

reject = true;
const r2 = await runVo(join(work, "rejected"));
check(r2.status !== 0 && /HTTP 401/.test(r2.stderr) && /invalid_api_key/.test(r2.stderr), "a rejected key stops the script and reports the API's status and error");
check(!/test-key-not-real/.test(r1.stdout + r1.stderr + r2.stdout + r2.stderr), "never prints the key");

server.close();
rmSync(work, { recursive: true, force: true });
console.log(fails.length ? `${fails.length} check(s) failed` : "all checks passed");
process.exit(fails.length ? 1 : 0);
