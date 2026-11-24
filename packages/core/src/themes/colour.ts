/**
 * The colour maths themes need, and no more: sRGB ↔ OKLab/OKLCH, the two
 * kinds of mix tokens.css uses (`color-mix(in oklab …)` and `in srgb`),
 * relative luminance and WCAG 2 contrast.
 *
 * Colours travel as gamma-encoded sRGB channels that are NOT clamped: CSS
 * keeps a colour outside sRGB (a dark, saturated `oklch(from … min(l, 0.45)
 * c h)`) as it is through later mixes and only fits it to the screen when it
 * paints. `display()` is that last step (each channel clipped, as the
 * browser does for an sRGB screen); contrast is always measured on it.
 */

export interface Rgb {
  r: number;
  g: number;
  b: number;
}

export interface Oklch {
  L: number;
  C: number;
  H: number;
}

const HEX = /^#[0-9A-Fa-f]{6}$/;

/** A theme colour: exactly `#RRGGBB`. */
export function isHex(value: unknown): value is string {
  return typeof value === "string" && HEX.test(value);
}

export function fromHex(hex: string): Rgb {
  const value = (offset: number) => parseInt(hex.slice(1 + offset, 3 + offset), 16) / 255;

  return { r: value(0), g: value(2), b: value(4) };
}

const clip = (value: number) => Math.min(1, Math.max(0, value));

/** The colour as an sRGB screen shows it: every channel clipped into 0–1. */
export function display(color: Rgb): Rgb {
  return { r: clip(color.r), g: clip(color.g), b: clip(color.b) };
}

/** `#RRGGBB`, upper case, of the colour as shown. */
export function toHex(color: Rgb): string {
  const shown = display(color);
  const pair = (value: number) => Math.round(value * 255).toString(16).padStart(2, "0");

  return `#${pair(shown.r)}${pair(shown.g)}${pair(shown.b)}`.toUpperCase();
}

/** sRGB transfer, extended to values outside 0–1 by mirroring (as CSS Color 4 does). */
export function toLinear(value: number): number {
  const magnitude = Math.abs(value);
  const linear = magnitude <= 0.04045 ? magnitude / 12.92 : ((magnitude + 0.055) / 1.055) ** 2.4;

  return value < 0 ? -linear : linear;
}

export function fromLinear(value: number): number {
  const magnitude = Math.abs(value);
  const gamma = magnitude <= 0.0031308 ? 12.92 * magnitude : 1.055 * magnitude ** (1 / 2.4) - 0.055;

  return value < 0 ? -gamma : gamma;
}

export function toOklab(color: Rgb): { L: number; a: number; b: number } {
  const r = toLinear(color.r);
  const g = toLinear(color.g);
  const b = toLinear(color.b);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);

  return {
    L: 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    a: 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    b: 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  };
}

export function fromOklab(lab: { L: number; a: number; b: number }): Rgb {
  const l = (lab.L + 0.3963377774 * lab.a + 0.2158037573 * lab.b) ** 3;
  const m = (lab.L - 0.1055613458 * lab.a - 0.0638541728 * lab.b) ** 3;
  const s = (lab.L - 0.0894841775 * lab.a - 1.291485548 * lab.b) ** 3;

  return {
    r: fromLinear(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
    g: fromLinear(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
    b: fromLinear(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s),
  };
}

export function toOklch(color: Rgb): Oklch {
  const lab = toOklab(color);
  const C = Math.hypot(lab.a, lab.b);
  const H = (((Math.atan2(lab.b, lab.a) * 180) / Math.PI) % 360 + 360) % 360;

  return { L: lab.L, C, H };
}

export function fromOklch({ L, C, H }: Oklch): Rgb {
  const radians = (H * Math.PI) / 180;

  return fromOklab({ L, a: C * Math.cos(radians), b: C * Math.sin(radians) });
}

/** `color-mix(in oklab, a weight, b)`: `weight` (0–1) of `a`. */
export function mixOklab(a: Rgb, b: Rgb, weight: number): Rgb {
  const p = toOklab(a);
  const q = toOklab(b);

  return fromOklab({ L: p.L * weight + q.L * (1 - weight), a: p.a * weight + q.a * (1 - weight), b: p.b * weight + q.b * (1 - weight) });
}

/** `color-mix(in srgb, a weight, b)`: `weight` (0–1) of `a`, in gamma-encoded sRGB. */
export function mixSrgb(a: Rgb, b: Rgb, weight: number): Rgb {
  return { r: a.r * weight + b.r * (1 - weight), g: a.g * weight + b.g * (1 - weight), b: a.b * weight + b.b * (1 - weight) };
}

/** `oklch(from c …)`: change a colour's lightness, chroma or hue. */
export function withOklch(color: Rgb, change: (value: Oklch) => Oklch): Rgb {
  return fromOklch(change(toOklch(color)));
}

/** Relative luminance (WCAG 2) of the colour as shown. */
export function luminance(color: Rgb): number {
  const shown = display(color);

  return 0.2126 * toLinear(shown.r) + 0.7152 * toLinear(shown.g) + 0.0722 * toLinear(shown.b);
}

/** WCAG 2 contrast ratio of two colours as shown, unrounded. */
export function contrast(a: Rgb, b: Rgb): number {
  const x = luminance(a);
  const y = luminance(b);

  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

/** Hue distance in degrees, 0–180. */
export function hueDistance(a: number, b: number): number {
  const difference = Math.abs(a - b) % 360;

  return difference > 180 ? 360 - difference : difference;
}

export const WHITE: Rgb = { r: 1, g: 1, b: 1 };
export const BLACK: Rgb = { r: 0, g: 0, b: 0 };
