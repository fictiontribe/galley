/**
 * Measurements from the rendered pages, merged: what colours the site really
 * paints and where, which type styles it really sets, which radii, shadows
 * and gaps recur. The summaries come from the overlay running in the site's
 * own page, so they are checked like any other input before use.
 */
import { z } from "zod";
import { contrastRatio, deltaE, normalizeColor } from "./color";
import type { MeasureSummary } from "./types";

const color = z.string().regex(/^#[0-9A-F]{6}([0-9A-F]{2})?$/i);
const short = (max: number) => z.string().max(max);
const count = z.number().int().min(0).max(1_000_000);
const size = z.number().min(0).max(100_000);

export const measureSummarySchema = z
  .object({
    path: short(500).regex(/^\//),
    title: short(300),
    viewport: z.object({ width: size, height: size }).strict(),
    pairs: z.array(z.object({ text: color, background: color, area: z.number().min(0).max(1e9), count, roles: z.array(short(20)).max(5), ratio: z.number().min(0).max(21) }).strict()).max(80),
    grounds: z.array(z.object({ color, area: z.number().min(0).max(1e10) }).strict()).max(40),
    type: z
      .array(
        z
          .object({
            role: z.enum(["heading", "body", "button", "link", "label"]),
            tag: short(12),
            family: short(160),
            size,
            weight: z.number().min(1).max(1000),
            lineHeight: size,
            letterSpacing: z.number().min(-100).max(100),
            count,
          })
          .strict()
      )
      .max(60),
    radii: z.array(z.object({ value: short(80), count }).strict()).max(30),
    shadows: z.array(z.object({ value: short(300), count }).strict()).max(20),
    spacing: z.array(z.object({ value: size, count }).strict()).max(40),
    buttons: z
      .array(
        z
          .object({ background: color, color, border: short(120), radius: short(80), paddingX: size, paddingY: size, family: short(160), weight: z.number().min(1).max(1000), size, count, sample: short(80) })
          .strict()
      )
      .max(12),
    links: z.array(z.object({ color, decoration: short(40), count }).strict()).max(12),
    logos: z
      .array(z.object({ kind: z.enum(["img", "svg"]), src: short(1000).optional(), alt: short(200).optional(), width: size, height: size, colors: z.array(color).max(8), viewBox: short(80).optional() }).strict())
      .max(6),
    fonts: z.array(z.object({ family: short(160), status: z.enum(["loaded", "unloaded", "error"]) }).strict()).max(30),
    variables: z.array(z.object({ name: short(120), value: short(300) }).strict()).max(400),
    internalLinks: z.array(z.object({ path: short(500), count }).strict()).max(40),
    copy: z.array(z.object({ role: z.enum(["heading", "body", "button"]), text: short(400) }).strict()).max(80),
    truncated: z.boolean(),
  })
  .strict();

/** At most this many pages are measured in one go. */
export const MAX_MEASURED_PAGES = 8;

export function parseMeasurements(value: unknown): MeasureSummary[] {
  const list = z.array(measureSummarySchema).max(MAX_MEASURED_PAGES).parse(value);

  return list.map((page) => ({
    ...page,
    pairs: page.pairs.map((pair) => ({ ...pair, text: pair.text.toUpperCase(), background: pair.background.toUpperCase() })),
  })) as MeasureSummary[];
}

export interface ColorUse {
  hex: string;
  /** Text area painted in it (px²), across pages. */
  textArea: number;
  /** Ground area. */
  groundArea: number;
  roles: Set<string>;
  pages: Set<string>;
  /** As a button fill / button text / link. */
  button: number;
  buttonText: number;
  link: number;
}

export interface MergedMeasurements {
  pages: string[];
  colors: ColorUse[];
  pairs: Array<{ text: string; background: string; area: number; ratio: number; roles: string[]; pages: string[] }>;
  type: Array<{ role: string; tag: string; family: string; size: number; weight: number; lineHeight: number; letterSpacing: number; count: number; pages: string[] }>;
  radii: Array<{ value: string; count: number }>;
  shadows: Array<{ value: string; count: number }>;
  spacing: Array<{ value: number; count: number }>;
  buttons: MeasureSummary["buttons"];
  logos: Array<MeasureSummary["logos"][number] & { pages: string[] }>;
  fonts: Array<{ family: string; status: "loaded" | "unloaded" | "error"; pages: string[] }>;
  copy: Array<{ role: string; text: string; page: string }>;
  variables: Map<string, string>;
}

/** Same colour within ΔE 1: an antialiased edge or a rounding difference, not a second colour. */
const SAME = 1;

export function mergeMeasurements(pages: MeasureSummary[]): MergedMeasurements {
  const colors: ColorUse[] = [];
  const use = (hex: string, page: string): ColorUse => {
    const solid = hex.slice(0, 7);
    let found = colors.find((c) => c.hex === solid) ?? colors.find((c) => deltaE(c.hex, solid) < SAME);

    if (!found) {
      found = { hex: solid, textArea: 0, groundArea: 0, roles: new Set(), pages: new Set(), button: 0, buttonText: 0, link: 0 };
      colors.push(found);
    }
    found.pages.add(page);
    return found;
  };
  const pairs = new Map<string, MergedMeasurements["pairs"][number]>();
  const type = new Map<string, MergedMeasurements["type"][number]>();
  const tally = <T extends string | number>(into: Map<T, number>, value: T, n: number) => into.set(value, (into.get(value) ?? 0) + n);
  const radii = new Map<string, number>();
  const shadows = new Map<string, number>();
  const spacing = new Map<number, number>();
  const buttons: MeasureSummary["buttons"] = [];
  const logos: MergedMeasurements["logos"] = [];
  const fonts = new Map<string, MergedMeasurements["fonts"][number]>();
  const copy: MergedMeasurements["copy"] = [];
  const seenCopy = new Set<string>();
  const variables = new Map<string, string>();

  for (const page of pages) {
    for (const pair of page.pairs) {
      const text = use(pair.text, page.path);

      text.textArea += pair.area;
      for (const role of pair.roles) text.roles.add(role);
      if (pair.roles.includes("link")) text.link += pair.count;
      const key = `${pair.text.slice(0, 7)}|${pair.background}`;
      const merged = pairs.get(key) ?? { text: pair.text.slice(0, 7), background: pair.background, area: 0, ratio: pair.ratio || contrastRatio(pair.text, pair.background), roles: [], pages: [] };

      merged.area += pair.area;
      for (const role of pair.roles) if (!merged.roles.includes(role)) merged.roles.push(role);
      if (!merged.pages.includes(page.path)) merged.pages.push(page.path);
      pairs.set(key, merged);
      use(pair.background, page.path).groundArea += pair.area * 0.01;
    }
    for (const ground of page.grounds) use(ground.color, page.path).groundArea += ground.area;
    for (const style of page.type) {
      const key = `${style.role}|${style.tag}|${style.family}|${Math.round(style.size)}|${style.weight}`;
      const merged = type.get(key) ?? { ...style, count: 0, pages: [] };

      merged.count += style.count;
      if (!merged.pages.includes(page.path)) merged.pages.push(page.path);
      type.set(key, merged);
    }
    for (const radius of page.radii) tally(radii, radius.value, radius.count);
    for (const shadow of page.shadows) tally(shadows, shadow.value, shadow.count);
    for (const step of page.spacing) tally(spacing, Math.round(step.value), step.count);
    for (const button of page.buttons) {
      use(button.background, page.path).button += button.count;
      use(button.color, page.path).buttonText += button.count;
      const same = buttons.find((b) => b.background === button.background && b.color === button.color && b.radius === button.radius);

      if (same) same.count += button.count;
      else buttons.push({ ...button });
    }
    for (const link of page.links) use(link.color, page.path).link += link.count;
    for (const logo of page.logos) {
      const same = logos.find((l) => (l.src ?? "") === (logo.src ?? "") && l.kind === logo.kind && (l.viewBox ?? "") === (logo.viewBox ?? ""));

      if (same) same.pages.push(page.path);
      else logos.push({ ...logo, pages: [page.path] });
    }
    for (const font of page.fonts) {
      const merged = fonts.get(font.family) ?? { family: font.family, status: font.status, pages: [] };

      if (font.status === "loaded") merged.status = "loaded";
      merged.pages.push(page.path);
      fonts.set(font.family, merged);
    }
    for (const line of page.copy) {
      const key = line.text.toLowerCase();

      if (seenCopy.has(key)) continue;
      seenCopy.add(key);
      copy.push({ ...line, page: page.path });
    }
    for (const variable of page.variables) if (!variables.has(variable.name)) variables.set(variable.name, variable.value);
  }
  const top = <T>(map: Map<T, number>, n: number) =>
    [...map.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, n)
      .map(([value, c]) => ({ value, count: c }));

  return {
    pages: pages.map((page) => page.path),
    colors: colors.sort((a, b) => b.textArea + b.groundArea - (a.textArea + a.groundArea)),
    pairs: [...pairs.values()].sort((a, b) => b.area - a.area),
    type: [...type.values()].sort((a, b) => b.count - a.count),
    radii: top(radii, 12),
    shadows: top(shadows, 8),
    spacing: top(spacing, 16),
    buttons: buttons.sort((a, b) => b.count - a.count).slice(0, 6),
    logos,
    fonts: [...fonts.values()],
    copy: copy.slice(0, 120),
    variables,
  };
}

/** Normalises a colour the browser reported, or null. */
export function hexOf(value: string): string | null {
  return normalizeColor(value);
}
