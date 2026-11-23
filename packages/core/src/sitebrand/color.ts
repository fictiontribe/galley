/**
 * Colour maths, dependency-free (the overlay bundles it into the page).
 *
 * Parsing covers what sites actually write and browsers actually report:
 * hex, rgb(), hsl(), oklch(), oklab(), color(srgb|display-p3 …) and a few
 * names. Anything else — var(), color-mix(), lab()/lch(), a name we don't
 * know — comes back null: a colour that can't be read is never guessed.
 *
 * Contrast is WCAG 2.x relative luminance. Closeness is ΔE in OKLab ×100,
 * where ~2 is "can't tell apart side by side".
 */

export interface Rgba {
  /** Gamma-encoded sRGB, 0–1. */
  r: number;
  g: number;
  b: number;
  /** 0–1. */
  a: number;
}

const NAMED: Record<string, string> = {
  black: "#000000",
  white: "#ffffff",
  red: "#ff0000",
  green: "#008000",
  blue: "#0000ff",
  yellow: "#ffff00",
  orange: "#ffa500",
  purple: "#800080",
  gray: "#808080",
  grey: "#808080",
  silver: "#c0c0c0",
  navy: "#000080",
  teal: "#008080",
  maroon: "#800000",
  olive: "#808000",
  lime: "#00ff00",
  aqua: "#00ffff",
  fuchsia: "#ff00ff",
  whitesmoke: "#f5f5f5",
  ivory: "#fffff0",
};

const clamp01 = (value: number) => Math.min(1, Math.max(0, value));

function number(part: string, percentScale: number): number | null {
  const trimmed = part.trim();

  if (trimmed === "none") return 0;
  const match = /^([+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?)(%|deg|rad|turn|grad)?$/i.exec(trimmed);

  if (!match) return null;
  const value = Number(match[1]);
  const unit = (match[2] ?? "").toLowerCase();

  if (!Number.isFinite(value)) return null;
  if (unit === "%") return (value / 100) * percentScale;
  if (unit === "rad") return (value * 180) / Math.PI;
  if (unit === "turn") return value * 360;
  if (unit === "grad") return value * 0.9;
  return value;
}

/** "a b c / d" or "a, b, c, d" → the channel strings and the alpha string. */
function channels(inner: string): { parts: string[]; alpha: string | null } | null {
  const slash = inner.split("/");

  if (slash.length > 2) return null;
  const main = slash[0]!.trim();
  const parts = main.includes(",") ? main.split(",").map((p) => p.trim()) : main.split(/\s+/).filter(Boolean);
  let alpha = slash.length === 2 ? slash[1]!.trim() : null;

  if (parts.length === 4 && alpha === null) alpha = parts.pop()!;
  return parts.length === 3 ? { parts, alpha } : null;
}

function alphaOf(text: string | null): number | null {
  if (text === null) return 1;
  const value = number(text, 1);

  return value === null ? null : clamp01(value);
}

function linearToGamma(value: number): number {
  const v = clamp01(value);

  return v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055;
}

function gammaToLinear(value: number): number {
  return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
}

function oklabToRgb(L: number, A: number, B: number): { r: number; g: number; b: number } {
  const l = (L + 0.3963377774 * A + 0.2158037573 * B) ** 3;
  const m = (L - 0.1055613458 * A - 0.0638541728 * B) ** 3;
  const s = (L - 0.0894841775 * A - 1.291485548 * B) ** 3;

  return {
    r: linearToGamma(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
    g: linearToGamma(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
    b: linearToGamma(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s),
  };
}

/** sRGB (gamma-encoded) → OKLab. */
export function toOklab(color: Rgba): { L: number; a: number; b: number } {
  const r = gammaToLinear(color.r);
  const g = gammaToLinear(color.g);
  const b = gammaToLinear(color.b);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);

  return {
    L: 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    a: 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    b: 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  };
}

export function toOklch(color: Rgba): { L: number; C: number; H: number } {
  const lab = toOklab(color);
  const C = Math.hypot(lab.a, lab.b);
  let H = (Math.atan2(lab.b, lab.a) * 180) / Math.PI;

  if (H < 0) H += 360;
  return { L: lab.L, C, H };
}

function hslToRgb(h: number, s: number, l: number): { r: number; g: number; b: number } {
  const hue = (((h % 360) + 360) % 360) / 360;
  const f = (n: number) => {
    const k = (n + hue * 12) % 12;
    const a = s * Math.min(l, 1 - l);

    return l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
  };

  return { r: f(0), g: f(8), b: f(4) };
}

/** Display P3 (gamma-encoded) → sRGB, clipped into the sRGB gamut. */
function p3ToRgb(r: number, g: number, b: number): { r: number; g: number; b: number } {
  const lr = gammaToLinear(r);
  const lg = gammaToLinear(g);
  const lb = gammaToLinear(b);
  // P3 linear → XYZ (D65) → sRGB linear, combined.
  const sr = 1.2249401 * lr - 0.2249404 * lg + 0 * lb;
  const sg = -0.0420569 * lr + 1.0420571 * lg + 0 * lb;
  const sb = -0.0196376 * lr - 0.0786361 * lg + 1.0982735 * lb;

  return { r: linearToGamma(sr), g: linearToGamma(sg), b: linearToGamma(sb) };
}

/** A CSS colour as sRGB, or null when it can't be read without guessing. */
export function parseColor(input: string): Rgba | null {
  const text = input.trim().toLowerCase();

  if (!text) return null;
  if (text === "transparent") return { r: 0, g: 0, b: 0, a: 0 };
  const named = NAMED[text];

  if (named) return parseColor(named);
  if (text.startsWith("#")) {
    const hex = text.slice(1);

    if (!/^[0-9a-f]+$/.test(hex) || ![3, 4, 6, 8].includes(hex.length)) return null;
    const full = hex.length <= 4 ? [...hex].map((c) => c + c).join("") : hex;
    const value = (i: number) => parseInt(full.slice(i, i + 2), 16) / 255;

    return { r: value(0), g: value(2), b: value(4), a: full.length === 8 ? value(6) : 1 };
  }
  const fn = /^([a-z-]+)\((.*)\)$/s.exec(text);

  if (!fn) return null;
  const name = fn[1]!;
  const inner = fn[2]!;

  if (/var\(|calc\(|color-mix|from /.test(inner)) return null;
  if (name === "rgb" || name === "rgba") {
    const c = channels(inner);

    if (!c) return null;
    const values = c.parts.map((p) => number(p, 255));
    const a = alphaOf(c.alpha);

    if (values.some((v) => v === null) || a === null) return null;
    const [r, g, b] = values as number[];

    return { r: clamp01(r! / 255), g: clamp01(g! / 255), b: clamp01(b! / 255), a };
  }
  if (name === "hsl" || name === "hsla") {
    const c = channels(inner);

    if (!c) return null;
    const h = number(c.parts[0]!, 360);
    const s = number(c.parts[1]!.endsWith("%") ? c.parts[1]! : `${c.parts[1]}%`, 1);
    const l = number(c.parts[2]!.endsWith("%") ? c.parts[2]! : `${c.parts[2]}%`, 1);
    const a = alphaOf(c.alpha);

    if (h === null || s === null || l === null || a === null) return null;
    return { ...hslToRgb(h, clamp01(s), clamp01(l)), a };
  }
  if (name === "oklch" || name === "oklab") {
    const c = channels(inner);

    if (!c) return null;
    const L = number(c.parts[0]!, 1);
    const second = number(c.parts[1]!, 0.4);
    const third = number(c.parts[2]!, name === "oklch" ? 360 : 0.4);
    const a = alphaOf(c.alpha);

    if (L === null || second === null || third === null || a === null) return null;
    const lightness = c.parts[0]!.endsWith("%") ? L : L > 1.5 ? L / 100 : L;
    const [A, B] = name === "oklch" ? [second * Math.cos((third * Math.PI) / 180), second * Math.sin((third * Math.PI) / 180)] : [second, third];

    return { ...oklabToRgb(lightness, A, B), a };
  }
  if (name === "color") {
    const match = /^\s*(srgb|display-p3)\s+(.*)$/s.exec(inner);

    if (!match) return null;
    const c = channels(match[2]!);

    if (!c) return null;
    const values = c.parts.map((p) => number(p, 1));
    const a = alphaOf(c.alpha);

    if (values.some((v) => v === null) || a === null) return null;
    const [r, g, b] = (values as number[]).map(clamp01) as [number, number, number];

    return match[1] === "srgb" ? { r, g, b, a } : { ...p3ToRgb(r, g, b), a };
  }
  return null;
}

const hex2 = (value: number) => Math.round(clamp01(value) * 255).toString(16).padStart(2, "0");

/** "#RRGGBB", or "#RRGGBBAA" when not opaque. Upper case, so values compare as strings. */
export function toHex(color: Rgba): string {
  const base = `#${hex2(color.r)}${hex2(color.g)}${hex2(color.b)}`;

  return (color.a < 0.999 ? `${base}${hex2(color.a)}` : base).toUpperCase();
}

/** Any readable CSS colour as hex, or null. */
export function normalizeColor(input: string): string | null {
  const parsed = parseColor(input);

  return parsed ? toHex(parsed) : null;
}

/** `top` drawn over an opaque `bottom`. */
export function composite(top: Rgba, bottom: Rgba): Rgba {
  const a = top.a;

  return { r: top.r * a + bottom.r * (1 - a), g: top.g * a + bottom.g * (1 - a), b: top.b * a + bottom.b * (1 - a), a: 1 };
}

export function luminance(color: Rgba): number {
  return 0.2126 * gammaToLinear(color.r) + 0.7152 * gammaToLinear(color.g) + 0.0722 * gammaToLinear(color.b);
}

/** WCAG 2.x contrast ratio of two opaque colours (a translucent text colour is composited over the ground first). */
export function contrastRatio(text: Rgba | string, ground: Rgba | string): number {
  const bg = typeof ground === "string" ? parseColor(ground) : ground;
  const fg = typeof text === "string" ? parseColor(text) : text;

  if (!bg || !fg) return 0;
  const solidBg = bg.a < 1 ? composite(bg, { r: 1, g: 1, b: 1, a: 1 }) : bg;
  const solidFg = fg.a < 1 ? composite(fg, solidBg) : fg;
  const a = luminance(solidFg);
  const b = luminance(solidBg);
  const ratio = (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);

  return Math.round(ratio * 100) / 100;
}

/** aaa ≥ 7, aa ≥ 4.5, large ≥ 3 (headings 24 px+, or 18.66 px bold), else fail. */
export function contrastResult(ratio: number): "aaa" | "aa" | "large" | "fail" {
  if (ratio >= 7) return "aaa";
  if (ratio >= 4.5) return "aa";
  if (ratio >= 3) return "large";
  return "fail";
}

/** ΔE in OKLab ×100. */
export function deltaE(a: Rgba | string, b: Rgba | string): number {
  const x = typeof a === "string" ? parseColor(a) : a;
  const y = typeof b === "string" ? parseColor(b) : b;

  if (!x || !y) return Number.POSITIVE_INFINITY;
  const p = toOklab(x);
  const q = toOklab(y);

  return Math.hypot(p.L - q.L, p.a - q.a, p.b - q.b) * 100;
}

/** Low-chroma colours: the greys, off-whites and near-blacks. */
export function isNeutral(color: Rgba | string, chroma = 0.025): boolean {
  const parsed = typeof color === "string" ? parseColor(color) : color;

  return parsed ? toOklch(parsed).C < chroma : false;
}

/**
 * The colour in the notation a file already uses, so an edit reads like the
 * rest of it. oklch is written with just enough precision to round-trip to
 * the same hex.
 */
export function formatLike(hex: string, example: string): string {
  const parsed = parseColor(hex);

  if (!parsed) return hex;
  const written = example.trim();
  const style = written.toLowerCase();

  if (style.startsWith("oklch(")) {
    const { L, C, H } = toOklch(parsed);

    for (const digits of [1, 2, 3]) {
      const text = `oklch(${(L * 100).toFixed(digits)}% ${C.toFixed(digits + 2)} ${C < 0.0005 ? "0" : H.toFixed(digits)})`;

      if (normalizeColor(text) === toHex(parsed)) return text.replace(/(\.\d*?[1-9])0+(?=[%\s)])|\.0+(?=[%\s)])/g, "$1");
    }
    return toHex(parsed);
  }
  if (style.startsWith("rgb")) return `rgb(${Math.round(parsed.r * 255)} ${Math.round(parsed.g * 255)} ${Math.round(parsed.b * 255)})`;
  if (written.startsWith("#") && written.length <= 7 && written === written.toLowerCase()) return toHex(parsed).toLowerCase();
  return toHex(parsed);
}
