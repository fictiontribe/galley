/**
 * SVG read as data, never rendered: its viewBox, its size, and the colours
 * its shapes are painted with, weighted by roughly how much of the picture
 * each shape covers. Scripts, event handlers and external references are
 * noted and left out of anything passed on.
 */
import { normalizeColor } from "./color";

export interface SvgSummary {
  viewBox?: string;
  width?: number;
  height?: number;
  /** "#RRGGBB" by share of the painted area (0–1). */
  colors: Array<{ color: string; share: number }>;
  /** Text inside the drawing (a wordmark's letters, when they are text). */
  text: string[];
  /** It carried things that could run or fetch (scripts, on* handlers, external links). */
  active: boolean;
}

const MAX_SVG_CHARS = 2_000_000;

function attr(tag: string, name: string): string | undefined {
  const match = new RegExp(`\\s${name}\\s*=\\s*("([^"]*)"|'([^']*)')`, "i").exec(tag);

  return match ? (match[2] ?? match[3]) : undefined;
}

function styleProp(style: string | undefined, name: string): string | undefined {
  if (!style) return undefined;
  const match = new RegExp(`(?:^|;)\\s*${name}\\s*:\\s*([^;]+)`, "i").exec(style);

  return match?.[1]?.trim();
}

const num = (value: string | undefined): number | null => {
  if (value === undefined) return null;
  const n = parseFloat(value);

  return Number.isFinite(n) ? n : null;
};

/** The area a shape covers, roughly: exact for rects and circles, the bounding box of the coordinates for paths and polygons. */
function areaOf(name: string, tag: string, fallback: number): number {
  if (name === "rect") return Math.max(0, (num(attr(tag, "width")) ?? 0) * (num(attr(tag, "height")) ?? 0));
  if (name === "circle") return Math.PI * (num(attr(tag, "r")) ?? 0) ** 2;
  if (name === "ellipse") return Math.PI * (num(attr(tag, "rx")) ?? 0) * (num(attr(tag, "ry")) ?? 0);
  const points = name === "path" ? attr(tag, "d") : name === "polygon" || name === "polyline" ? attr(tag, "points") : undefined;

  if (points) {
    // Absolute coordinates only matter here; relative path commands make this an over-estimate, which is fine for weights.
    const values = (points.match(/-?\d*\.?\d+(?:e-?\d+)?/gi) ?? []).map(Number);
    const xs = values.filter((_, i) => i % 2 === 0);
    const ys = values.filter((_, i) => i % 2 === 1);

    if (xs.length && ys.length) return Math.max(1, (Math.max(...xs) - Math.min(...xs)) * (Math.max(...ys) - Math.min(...ys)) * 0.6);
  }
  if (name === "text" || name === "tspan") return fallback * 0.02;
  return fallback * 0.01;
}

export function readSvg(source: string): SvgSummary {
  const text = source.slice(0, MAX_SVG_CHARS);
  const root = /<svg\b[^>]*>/i.exec(text)?.[0] ?? "";
  const viewBox = attr(root, "viewBox");
  const box = viewBox?.split(/[\s,]+/).map(Number);
  const width = num(attr(root, "width")) ?? (box && box.length === 4 ? box[2] : undefined) ?? undefined;
  const height = num(attr(root, "height")) ?? (box && box.length === 4 ? box[3] : undefined) ?? undefined;
  const whole = (width ?? 100) * (height ?? 100);
  const weights = new Map<string, number>();
  const add = (value: string | undefined, weight: number) => {
    if (!value || value === "none" || value.startsWith("url(")) return;
    const hex = normalizeColor(value);

    if (hex && !(hex.length === 9 && hex.endsWith("00"))) weights.set(hex.slice(0, 7), (weights.get(hex.slice(0, 7)) ?? 0) + weight);
  };
  // Class rules in <style>: .cls-1{fill:#…}
  const classFill = new Map<string, string>();

  for (const block of text.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi)) {
    for (const rule of block[1]!.matchAll(/\.([\w-]+)\s*\{([^}]*)\}/g)) {
      const fill = styleProp(rule[2], "fill");

      if (fill) classFill.set(rule[1]!, fill);
    }
  }
  for (const match of text.matchAll(/<(rect|circle|ellipse|path|polygon|polyline|line|text|tspan|stop|g|use)\b[^>]*>/gi)) {
    const tag = match[0];
    const name = match[1]!.toLowerCase();
    const style = attr(tag, "style");
    const area = areaOf(name, tag, whole);

    if (name === "stop") {
      add(attr(tag, "stop-color") ?? styleProp(style, "stop-color"), whole * 0.05);
      continue;
    }
    const classes = (attr(tag, "class") ?? "").split(/\s+/).filter(Boolean);
    const fill = attr(tag, "fill") ?? styleProp(style, "fill") ?? classes.map((c) => classFill.get(c)).find(Boolean);

    // An unpainted shape is drawn black — but a group's fill only passes down, so it adds nothing itself.
    if (name !== "g" && name !== "use") add(fill ?? (name === "line" ? undefined : "#000000"), area);
    else if (fill) add(fill, 0);
    add(attr(tag, "stroke") ?? styleProp(style, "stroke"), area * 0.1);
  }
  const total = [...weights.values()].reduce((sum, w) => sum + w, 0);
  const colors = [...weights.entries()]
    .map(([color, weight]) => ({ color, share: total > 0 ? weight / total : 0 }))
    .sort((a, b) => b.share - a.share)
    .slice(0, 12);
  const words = [...text.matchAll(/<(?:text|tspan)\b[^>]*>([^<]{1,200})</gi)].map((m) => m[1]!.trim()).filter(Boolean).slice(0, 20);
  const active = /<script\b|\son\w+\s*=|<foreignObject\b|(?:xlink:)?href\s*=\s*["']\s*(?:https?:|javascript:|data:text)/i.test(text);

  return { ...(viewBox ? { viewBox } : {}), ...(width ? { width } : {}), ...(height ? { height } : {}), colors, text: words, active };
}

/** The markup with anything that could run or fetch removed, for reading as text. Never for rendering. */
export function inertSvg(source: string, maxChars = 40_000): string {
  return source
    .slice(0, MAX_SVG_CHARS)
    .replace(/<script\b[\s\S]*?<\/script>/gi, "")
    .replace(/<foreignObject\b[\s\S]*?<\/foreignObject>/gi, "")
    .replace(/\son\w+\s*=\s*("[^"]*"|'[^']*')/gi, "")
    .replace(/((?:xlink:)?href\s*=\s*)("|')\s*(?:https?:|javascript:|data:)[^"']*\2/gi, "$1$2#$2")
    .slice(0, maxChars);
}
