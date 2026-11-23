// Shared helpers for the video scripts. Node 22+, no dependencies.
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const PROJECT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
export const p = (...parts) => resolve(PROJECT, ...parts);

/** ffmpeg / ffprobe: FFMPEG_PATH, then HYPERFRAMES_FFMPEG_PATH, then PATH. */
export const FFMPEG = process.env.FFMPEG_PATH || process.env.HYPERFRAMES_FFMPEG_PATH || "ffmpeg";
export const FFPROBE = process.env.FFPROBE_PATH || process.env.HYPERFRAMES_FFPROBE_PATH || "ffprobe";

/**
 * The HyperFrames CLI as an argv prefix. HYPERFRAMES_CLI overrides it, e.g.
 * HYPERFRAMES_CLI='node /path/to/plugin-cli.mjs' inside the agent plugin.
 */
export function hyperframesCli() {
  const raw = process.env.HYPERFRAMES_CLI || "npx --yes hyperframes@0.9.41";
  return raw.split(" ").filter(Boolean);
}

export function run(cmd, args, opts = {}) {
  const res = spawnSync(cmd, args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024, ...opts });
  if (res.status !== 0) {
    const msg = `${cmd} ${args.slice(0, 6).join(" ")} … exited ${res.status}\n${(res.stderr || "").slice(-2000)}`;
    throw new Error(msg);
  }
  return res;
}

export function probeDuration(file) {
  const res = run(FFPROBE, ["-v", "error", "-show_entries", "format=duration", "-of", "default=nw=1:nk=1", file]);
  return Number.parseFloat(res.stdout.trim());
}

export function readJson(file) {
  return JSON.parse(readFileSync(file, "utf8"));
}

/** Parse --key value / --flag arguments. */
export function args(argv = process.argv.slice(2)) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) {
      out._.push(a);
      continue;
    }
    const [k, inline] = a.slice(2).split("=");
    if (inline !== undefined) out[k] = inline;
    else if (argv[i + 1] !== undefined && !argv[i + 1].startsWith("--")) out[k] = argv[++i];
    else out[k] = true;
  }
  return out;
}

export const round = (n, d = 3) => Math.round(n * 10 ** d) / 10 ** d;

/** Script lines from voiceover.txt: one sentence per non-empty line, # comments allowed. */
export function readScript(file = p("voiceover.txt")) {
  return readFileSync(file, "utf8")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("#"));
}

/** Split a line into display words (keeps punctuation on the word). */
export const splitWords = (text) => text.split(/\s+/).filter(Boolean);
