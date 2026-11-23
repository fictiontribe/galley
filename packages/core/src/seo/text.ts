/**
 * Text measures the checks share: markdown to plain text, word counts, the
 * pixel-width estimate for result titles and descriptions, and near-duplicate
 * detection by shingle similarity. Pure functions.
 */

/** Markdown (or a markdown-ish field) to plain text, keeping words and dropping syntax. */
export function plainText(markdown: string): string {
  return markdown
    .replace(/^```[\s\S]*?^```/gm, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<(script|style)\b[\s\S]*?<\/\1>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, " ")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/^\s{0,3}(#{1,6}|>|[-*+]|\d+[.)])\s+/gm, "")
    .replace(/^(import|export)\s.*$/gm, " ")
    .replace(/[*_`~]+/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function words(text: string): string[] {
  return text.toLowerCase().match(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu) ?? [];
}

export function wordCount(text: string): number {
  return words(text).length;
}

export function collapse(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

export function cut(text: string, max: number): string {
  const clean = collapse(text);

  return clean.length > max ? `${clean.slice(0, max - 1).trimEnd()}…` : clean;
}

// ─────────────────────────────────────────────── pixel widths

/**
 * Advance widths of Arial/Helvetica (units per 1000 em, from the standard
 * Helvetica metrics Arial matches). Google publishes no title length: it
 * cuts titles to fit the device. Measuring in pixels is closer to what is
 * seen than counting characters — "iiii" and "WWWW" differ fourfold.
 */
const WIDTHS: Record<string, number> = {
  " ": 278, "!": 278, '"': 355, "#": 556, $: 556, "%": 889, "&": 667, "'": 191, "(": 333, ")": 333, "*": 389, "+": 584, ",": 278, "-": 333, ".": 278, "/": 278,
  ":": 278, ";": 278, "<": 584, "=": 584, ">": 584, "?": 556, "@": 1015, "[": 278, "\\": 278, "]": 278, "^": 469, _: 556, "`": 333, "{": 334, "|": 260, "}": 334, "~": 584,
  A: 667, B: 667, C: 722, D: 722, E: 667, F: 611, G: 778, H: 722, I: 278, J: 500, K: 667, L: 556, M: 833, N: 722, O: 778, P: 667, Q: 778, R: 722, S: 667, T: 611, U: 722, V: 667, W: 944, X: 667, Y: 667, Z: 611,
  a: 556, b: 556, c: 500, d: 556, e: 556, f: 278, g: 556, h: 556, i: 222, j: 222, k: 500, l: 222, m: 833, n: 556, o: 556, p: 556, q: 556, r: 333, s: 500, t: 278, u: 556, v: 500, w: 722, x: 500, y: 500, z: 500,
  "·": 278, "–": 556, "—": 1000, "…": 1000, "‘": 222, "’": 222, "“": 333, "”": 333, "•": 350, "›": 333, "‹": 333, "«": 556, "»": 556, "©": 737, "®": 737, "€": 556, "£": 556,
};
for (const digit of "0123456789") WIDTHS[digit] = 556;

function charWidth(char: string): number {
  const known = WIDTHS[char];

  if (known !== undefined) return known;
  const code = char.codePointAt(0) ?? 0;

  // CJK, Hangul and full-width forms are a full em; emoji about the same.
  if ((code >= 0x2e80 && code <= 0x9fff) || (code >= 0xac00 && code <= 0xd7af) || (code >= 0xff00 && code <= 0xffef) || code >= 0x1f300) return 1000;
  // Accented Latin letters take their base letter's width.
  const base = char.normalize("NFD")[0];

  if (base && base !== char && WIDTHS[base] !== undefined) return WIDTHS[base]!;
  return 556;
}

export function textWidth(text: string, fontPx: number): number {
  let units = 0;

  for (const char of text) units += charWidth(char);
  return Math.round((units * fontPx) / 1000);
}

/** The text as it would fit in `limit` pixels, cut at a word with an ellipsis when it doesn't. */
export function fitWidth(text: string, fontPx: number, limit: number): { shown: string; width: number; cut: boolean } {
  const clean = collapse(text);
  const width = textWidth(clean, fontPx);

  if (width <= limit) return { shown: clean, width, cut: false };
  const ellipsis = textWidth(" …", fontPx);
  let used = 0;
  let end = 0;

  for (const char of clean) {
    const next = used + (charWidth(char) * fontPx) / 1000;

    if (next + ellipsis > limit) break;
    used = next;
    end += char.length;
  }
  let shown = clean.slice(0, end);
  const space = shown.lastIndexOf(" ");

  if (space > end * 0.6) shown = shown.slice(0, space);
  return { shown: `${shown.replace(/[\s,;:·|–—-]+$/, "")} …`, width, cut: true };
}

/**
 * The result-display estimates, with the reasoning stated wherever they are
 * shown. These are observations of desktop results, not numbers Google
 * publishes; they only ever produce "idea" findings.
 */
export const DISPLAY = {
  title: { fontPx: 20, limit: 600, reasoning: "Measured at 20 px Arial against a 600 px line, a common observation of desktop results. Google publishes no limit: it cuts titles to fit the screen." },
  description: { fontPx: 14, limit: 1200, reasoning: "Measured at 14 px Arial against two 600 px lines, about what desktop results show. Google publishes no limit and often writes its own snippet from the page." },
} as const;

// ─────────────────────────────────────────────── near-duplicates

const SHINGLE = 5;
const HASHES = 64;
const BANDS = 16;
const ROWS = HASHES / BANDS;

function fnv1a(text: string, seed = 0x811c9dc5): number {
  let hash = seed >>> 0;

  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

/** Hashed five-word shingles of a text. */
export function shingles(text: string): Set<number> {
  const list = words(text);
  const out = new Set<number>();

  for (let i = 0; i + SHINGLE <= list.length; i += 1) out.add(fnv1a(list.slice(i, i + SHINGLE).join(" ")));
  return out;
}

export function jaccard(a: Set<number>, b: Set<number>): number {
  if (a.size === 0 || b.size === 0) return 0;
  const [small, large] = a.size < b.size ? [a, b] : [b, a];
  let shared = 0;

  for (const value of small) if (large.has(value)) shared += 1;
  return shared / (a.size + b.size - shared);
}

const SEEDS = Array.from({ length: HASHES }, (_, index) => fnv1a(`seed-${index}`));

const signatures = new WeakMap<Set<number>, Uint32Array>();

/** MinHash signature, kept per shingle set so an unchanged page is never re-hashed. */
function signature(set: Set<number>): Uint32Array {
  const known = signatures.get(set);

  if (known) return known;
  const out = new Uint32Array(HASHES).fill(0xffffffff);

  for (const value of set) {
    for (let i = 0; i < HASHES; i += 1) {
      const mixed = Math.imul(value ^ SEEDS[i]!, 0x9e3779b1) >>> 0;

      if (mixed < out[i]!) out[i] = mixed;
    }
  }
  signatures.set(set, out);
  return out;
}

/**
 * Pairs of documents whose shingle sets overlap at least `threshold`
 * (Jaccard). MinHash with banding finds candidates without comparing every
 * pair; each candidate is then confirmed exactly, so nothing is reported on
 * the estimate alone.
 */
export function similarPairs(docs: Array<{ id: string; shingles: Set<number> }>, threshold: number): Array<{ a: string; b: string; similarity: number }> {
  const buckets = new Map<string, string[]>();
  const byId = new Map(docs.map((doc) => [doc.id, doc]));

  for (const doc of docs) {
    if (doc.shingles.size === 0) continue;
    const sig = signature(doc.shingles);

    for (let band = 0; band < BANDS; band += 1) {
      const key = `${band}:${Array.from(sig.subarray(band * ROWS, band * ROWS + ROWS)).join(",")}`;
      const list = buckets.get(key);

      if (list) list.push(doc.id);
      else buckets.set(key, [doc.id]);
    }
  }
  const seen = new Set<string>();
  const out: Array<{ a: string; b: string; similarity: number }> = [];

  for (const list of buckets.values()) {
    if (list.length < 2) continue;
    // A huge bucket is a mass of copies (a template stamped out many times):
    // comparing each with the first finds them without a quadratic blow-up.
    const wide = list.length > 200;

    for (let i = 0; i < (wide ? 1 : list.length); i += 1) {
      for (let j = i + 1; j < list.length; j += 1) {
        const [a, b] = [list[i]!, list[j]!].sort();
        const key = `${a}\u0000${b}`;

        if (seen.has(key)) continue;
        seen.add(key);
        const similarity = jaccard(byId.get(a!)!.shingles, byId.get(b!)!.shingles);

        if (similarity >= threshold) out.push({ a: a!, b: b!, similarity });
      }
    }
  }
  return out.sort((x, y) => y.similarity - x.similarity);
}
