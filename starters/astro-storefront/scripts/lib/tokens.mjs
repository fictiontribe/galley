// Reads colour custom properties out of a tokens file and turns oklch() into
// sRGB, so the photography scripts can paint placeholders in the active look's
// palette. No dependencies; handles the plain `oklch(L% C H)` and
// `oklch(L% C H / a)` forms tokens.css uses.

import { readFileSync } from "node:fs";

/** Every `--name: value;` declaration in the file's first :root block. */
export function readTokens(file) {
  const css = readFileSync(file, "utf8");
  const root = css.match(/:root\s*\{([\s\S]*?)\n\}/);
  const tokens = {};
  for (const match of (root ? root[1] : css).matchAll(/--([\w-]+)\s*:\s*([^;]+);/g)) tokens[match[1]] = match[2].trim();
  return tokens;
}

/** oklch(L% C H [/ a]) → { r, g, b, a } with r/g/b 0–255 (gamut-clipped). */
export function oklchToRgb(value) {
  const match = String(value).match(/oklch\(\s*([\d.]+)%?\s+([\d.]+)\s+([\d.]+)(?:\s*\/\s*([\d.]+))?\s*\)/);
  if (!match) throw new Error(`Not an oklch() colour: ${value}`);
  const L = Number(match[1]) > 1 ? Number(match[1]) / 100 : Number(match[1]);
  const C = Number(match[2]);
  const h = (Number(match[3]) * Math.PI) / 180;
  const a = C * Math.cos(h);
  const b = C * Math.sin(h);
  const l_ = L + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = L - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = L - 0.0894841775 * a - 1.291485548 * b;
  const l = l_ ** 3;
  const m = m_ ** 3;
  const s = s_ ** 3;
  const linear = [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
  const [r, g, bl] = linear.map((c) => {
    const v = Math.min(1, Math.max(0, c));
    return Math.round((v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055) * 255);
  });
  return { r, g, b: bl, a: match[4] === undefined ? 1 : Number(match[4]) };
}

/** "#rrggbb" for an oklch() value. */
export function toHex(value) {
  const { r, g, b } = oklchToRgb(value);
  return `#${[r, g, b].map((n) => n.toString(16).padStart(2, "0")).join("")}`;
}

/** WCAG relative luminance of { r, g, b } (0–255). */
export function luminance({ r, g, b }) {
  const lin = (c) => {
    const v = c / 255;
    return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

/** WCAG contrast ratio between two { r, g, b } colours. */
export function contrast(one, two) {
  const [hi, lo] = [luminance(one), luminance(two)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}
