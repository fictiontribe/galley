/**
 * Every colour a theme's five seeds turn into, exactly as brand/tokens.css
 * derives them (§2 the accent, §5 the pencil ramp, §6 the theme recipes).
 * The legibility check measures these, so they must be what the browser
 * paints: packages/web/test/themes/parity.browser.test.ts applies themes to
 * a page and compares every value here with the page's own.
 */
import { BLACK, WHITE, fromHex, fromLinear, luminance, mixOklab, mixSrgb, toLinear, withOklch, type Rgb } from "./colour";
import type { ThemeMode, ThemeSeeds } from "./contract";

/** The derived colours a check measures (and the parity test compares), by their tokens.css names. */
export interface DerivedColours {
  paper: Rgb;
  sheet: Rgb;
  overlay: Rgb;
  well: Rgb;
  table: Rgb;
  desk: Rgb;
  ink: Rgb;
  ink2: Rgb;
  ink3: Rgb;
  ink4: Rgb;
  subtle: Rgb;
  edge: Rgb;
  seam: Rgb;
  worn: Rgb;
  strong: Rgb;
  plate: Rgb;
  onPlate: Rgb;
  onPlate2: Rgb;
  onPlate3: Rgb;
  pencilOnPlate: Rgb;
  plateCurrent: Rgb;
  accent: Rgb;
  accentFill: Rgb;
  accentOn: Rgb;
  accentHover: Rgb;
  accentPressed: Rgb;
  accentText: Rgb;
  pencil50: Rgb;
  pencil100: Rgb;
  pencil200: Rgb;
  pencil300: Rgb;
  pencil400: Rgb;
  pencil800: Rgb;
}

/** The custom property each derived colour is read from in the browser (the parity test's map). */
export const DERIVED_PROPERTY: Record<keyof DerivedColours, string> = {
  paper: "--surface-paper",
  sheet: "--surface-raised",
  overlay: "--surface-overlay",
  well: "--surface-sunken",
  table: "--surface-table",
  desk: "--desk-toned",
  ink: "--ink-primary",
  ink2: "--ink-secondary",
  ink3: "--ink-tertiary",
  ink4: "--ink-disabled",
  subtle: "--border-subtle",
  edge: "--border-default",
  seam: "--border-seam",
  worn: "--border-worn",
  strong: "--border-strong",
  plate: "--plate",
  onPlate: "--on-plate",
  onPlate2: "--on-plate-2",
  onPlate3: "--on-plate-3",
  pencilOnPlate: "--pencil-on-plate",
  plateCurrent: "--plate-current",
  accent: "--accent",
  accentFill: "--accent-fill",
  accentOn: "--accent-on",
  accentHover: "--accent-hover",
  accentPressed: "--accent-pressed",
  accentText: "--accent-text",
  pencil50: "--pencil-50",
  pencil100: "--pencil-100",
  pencil200: "--pencil-200",
  pencil300: "--pencil-300",
  pencil400: "--pencil-400",
  pencil800: "--pencil-800",
};

/**
 * "Warmed": keep a printing ink's warmth in a mixed step — OKLCH chroma × k,
 * never above 0.04, the hue kept. tokens.css writes it without a hue, as
 * `oklab(from <mix> l calc(a * S) calc(b * S))` with
 * `S = min(k, 0.04 / max(hypot(a, b), 0.000001))`: the same thing.
 */
function warm(color: Rgb, k: number): Rgb {
  return withOklch(color, ({ L, C, H }) => ({ L, C: Math.min(C * k, 0.04), H }));
}

function lum(color: Rgb): number {
  return 0.2126 * toLinear(color.r) + 0.7152 * toLinear(color.g) + 0.0722 * toLinear(color.b);
}

/** A colour from linear-light channels. */
function fromLinearRgb(r: number, g: number, b: number): Rgb {
  return { r: fromLinear(r), g: fromLinear(g), b: fromLinear(b) };
}

/**
 * tokens.css §2: on-accent text by luminance (Y < 0.199 → near-white, else
 * near-black), the fill nudged out of the dead band 0.175–0.2274 (darkened
 * or lightened in linear light, hue kept), and what hover and pressed move
 * away from.
 */
export function accentRoles(accent: Rgb): { fill: Rgb; on: Rgb; away: Rgb } {
  const Y = lum(accent);
  const t = Math.min(1, Math.max(0, (0.199 - Y) * 100000));
  const r = toLinear(accent.r);
  const g = toLinear(accent.g);
  const b = toLinear(accent.b);
  const on = 0.0103 + 0.9797 * t;
  const away = 1 - t;
  const darken = Y > 0 ? Math.min(1, 0.175 / Y) : 1;
  const lift = Math.max(0, (0.2274 - Y) / (1 - Y));
  const channel = (value: number) => t * value * darken + (1 - t) * (value + lift * (1 - value));

  return { fill: fromLinearRgb(channel(r), channel(g), channel(b)), on: fromLinearRgb(on, on, on), away: fromLinearRgb(away, away, away) };
}

/** Everything five seeds turn into in one mode. */
export function deriveColours(seeds: ThemeSeeds, mode: ThemeMode): DerivedColours {
  const paper = fromHex(seeds.paper);
  const ink = fromHex(seeds.ink);
  const pencil = fromHex(seeds.pencil);
  const plate = fromHex(seeds.plate);
  const table = fromHex(seeds.table);
  const light = mode === "light";
  const k = light ? 2.5 : 1.7;
  const step = (weight: number) => warm(mixOklab(ink, paper, weight), k);
  const steps = light ? { ink2: 0.73, ink3: 0.62, ink4: 0.38, subtle: 0.07, edge: 0.14, seam: 0.2, worn: 0.29, strong: 0.51, desk: 0.08 } : { ink2: 0.77, ink3: 0.6, ink4: 0.36, subtle: 0.13, edge: 0.18, seam: 0.24, worn: 0.34, strong: 0.48, desk: 0.07 };

  const sheet = light ? mixOklab(paper, WHITE, 0.3) : mixOklab(ink, paper, 0.05);
  const overlay = light ? mixOklab(paper, WHITE, 0.12) : mixOklab(ink, paper, 0.09);
  const well = light ? warm(mixOklab(ink, paper, 0.04), 1.5) : mixOklab(BLACK, paper, 0.18);

  const onPlate = light ? warm(mixOklab(paper, plate, 0.94), 2.5) : ink;
  const { fill, on, away } = accentRoles(pencil);
  // §2 light: oklab(from accent min(l, 0.45) a b); §3 dark: oklab(from color-mix(in srgb, accent, ink 45%) max(l, 0.76) a b): lightness moved, chroma and hue kept.
  const accentText = light ? withOklch(pencil, ({ L, C, H }) => ({ L: Math.min(L, 0.45), C, H })) : withOklch(mixSrgb(pencil, ink, 0.55), ({ L, C, H }) => ({ L: Math.max(L, 0.76), C, H }));
  const tints = light ? [0.05, 0.1, 0.18, 0.34, 0.68] : [0.06, 0.1, 0.18, 0.3, 0.6];
  const tint = (index: number) => mixSrgb(accentText, sheet, tints[index]!);

  return {
    paper,
    sheet,
    overlay,
    well,
    table,
    desk: step(steps.desk),
    ink,
    ink2: step(steps.ink2),
    ink3: step(steps.ink3),
    ink4: step(steps.ink4),
    subtle: step(steps.subtle),
    edge: step(steps.edge),
    seam: step(steps.seam),
    worn: step(steps.worn),
    strong: step(steps.strong),
    plate,
    onPlate,
    onPlate2: warm(mixOklab(onPlate, plate, 0.78), 2.2),
    onPlate3: warm(mixOklab(onPlate, plate, 0.62), 2.2),
    pencilOnPlate: withOklch(mixSrgb(pencil, WHITE, 0.5), ({ L, C, H }) => ({ L: Math.max(L, 0.78), C, H })),
    plateCurrent: mixSrgb(fill, plate, 0.38),
    accent: pencil,
    accentFill: fill,
    accentOn: on,
    accentHover: mixOklab(fill, away, 0.86),
    accentPressed: mixOklab(fill, away, 0.72),
    accentText,
    pencil50: tint(0),
    pencil100: tint(1),
    pencil200: tint(2),
    pencil300: tint(3),
    pencil400: tint(4),
    pencil800: mixSrgb(accentText, ink, 0.45),
  };
}

/** Whether near-white text sits on this pencil (the button's words). */
export function lightTextOn(pencil: Rgb): boolean {
  return luminance(pencil) < 0.199;
}
