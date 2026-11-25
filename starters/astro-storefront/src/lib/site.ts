// Small helpers shared by layouts and sections. Site settings, navigation and
// stockists are read from src/data/*.json — components never hard-code copy.

import { Marked } from "marked";
import siteData from "../data/site.json";
import navigationData from "../data/navigation.json";
import stockistsData from "../data/stockists.json";
import focusPoints from "./focus.json";

export const site = siteData;
export const navigation = navigationData;
export const labels = siteData.labels;

/** Stockists, grouped by town (src/data/stockists.json). */
export interface StockistGroup {
  id: string;
  label: string;
  note?: string;
  items: Array<{ name: string; address?: string; note?: string; href?: string }>;
}
export const stockists: StockistGroup[] = stockistsData.groups;

export type Tone = "default" | "muted" | "inverse" | "accent";
export interface Link {
  label: string;
  href: string;
}

/** An image a section shows: a path from the site root and its alt text. */
export interface Picture {
  image: string;
  imageAlt: string;
}

/** Width / height of the named crops content can choose ("portrait" → 4/5). */
export const ratios = {
  portrait: "4/5",
  tall: "2/3",
  square: "1/1",
  landscape: "3/2",
  wide: "16/9",
  panorama: "21/9",
} as const;
export type RatioName = keyof typeof ratios;

/** Where the subject of a photograph sits, for crops that cut into it. */
export const focusPositions = { left: "28% 50%", center: "50% 50%", right: "72% 50%" } as const;
export type Focus = keyof typeof focusPositions;

/**
 * Each photograph's focus point, by its path under public/images, longest
 * first. From src/lib/focus.json, which `npm run focus` writes from the shot
 * list (galley/photography/shots.json): the site reads the copy here, so the
 * shot list stays a record beside the site.
 */
const shotFocus = Object.entries(focusPoints.points).sort(([a], [b]) => b.length - a.length);

/**
 * Where a crop is anchored: the side an editor chose (left, right), or else
 * the photograph's own focus point from the shot list, so heads and garments
 * stay in frame at every ratio; the middle for a picture not in the list.
 *
 * A photograph is found by its path inside the address, not by the whole
 * address: /images/pieces/coat.webp and
 * https://media.example.com/pieces/coat.webp are the same picture, so it
 * keeps its focus point when the pictures move to a bucket. (Cloudflare
 * Images puts the path, encoded, before the variant's name; hence the
 * decoding, and looking inside the address rather than at its end.)
 */
export function focusFor(src: string, focus: Focus = "center"): string {
  if (focus !== "center") return focusPositions[focus];
  let address = src.replace(/[?#].*$/, "");

  try {
    address = decodeURIComponent(address);
  } catch {
    // Not an encoded address: use it as it is.
  }
  return shotFocus.find(([path]) => `${address}/`.includes(`/${path}/`))?.[1] ?? focusPositions.center;
}

/** Whether a link leaves the site (opens elsewhere). */
export function isExternal(href: string): boolean {
  return /^https?:\/\//.test(href);
}

/** A slim, dismissible bar above the header. */
export interface StarterNotice {
  /** Names the bar for screen readers. */
  label: string;
  text: string;
  link?: Link;
  /** Label of the button that hides it. */
  dismiss: string;
}

/**
 * The notice the template's demo shows (`starterNotice` in site.json). Delete
 * that entry and the bar, and its few lines of script, are gone.
 */
export const starterNotice = (siteData as { starterNotice?: StarterNotice }).starterNotice;

/** Replace `{name}` placeholders in a label, e.g. "Page {current} of {total}". */
export function fill(template: string, values: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (match, key: string) =>
    key in values ? String(values[key]) : match,
  );
}

/**
 * The site's base path without a trailing slash: "" when the site is served
 * from the root of its domain, "/repo" for a GitHub Pages project site.
 * Set with `base` in astro.config.ts or `astro build --base /repo`.
 */
const basePath = import.meta.env.BASE_URL.replace(/\/+$/, "");

/**
 * Prefix a root-relative path ("/about/", "/images/x.svg") with the base
 * path. Content always writes links and images from the site root; every
 * component passes them through here, so the same content works at a
 * domain's root and under a sub-path. Other values (https:, mailto:, tel:,
 * #anchors, "//host") are returned unchanged. Pass content paths only:
 * Astro.url and paginate() URLs already include the base.
 */
export function withBase(path: string): string;
export function withBase(path: string | undefined): string | undefined;
export function withBase(path: string | undefined): string | undefined {
  if (!path || !basePath || !path.startsWith("/") || path.startsWith("//")) return path;
  return `${basePath}${path}`;
}

// Links and images written in markdown fields go through withBase() too.
const markdownParser = new Marked({
  walkTokens(token) {
    if (token.type === "link" || token.type === "image") token.href = withBase(token.href);
  },
});

/** Markdown → HTML for longer text fields (story sections). */
export function markdown(text: string): string {
  return markdownParser.parse(text, { async: false });
}

/** Inline markdown → HTML for one-line fields, so `*word*` becomes emphasis. */
export function inline(text: string): string {
  return markdownParser.parseInline(text, { async: false });
}

/** Strip inline markdown for places that need plain text (alt, aria, meta). */
export function plain(text: string): string {
  return text.replace(/[*_`]/g, "");
}

/** Split plain text into paragraphs on blank lines. */
export function paragraphs(text: string | undefined): string[] {
  if (!text) return [];
  return text
    .split(/\n\s*\n/)
    .map((part) => part.trim())
    .filter(Boolean);
}

const dateFormat = new Intl.DateTimeFormat(siteData.locale, { dateStyle: "long" });

export function formatDate(date: Date): string {
  return dateFormat.format(date);
}

/**
 * Absolute URL on the public site, for canonical and Open Graph tags. The
 * origin is `site` (from site.json, or `astro build --site …`); `path` must
 * already include the base path (Astro.url.pathname does; use withBase()
 * for content paths).
 */
export function absolute(path: string): string {
  return new URL(path, import.meta.env.SITE ?? siteData.url).href;
}

/** Whether a nav link points at the current page or one of its children. */
export function isCurrent(href: string, pathname: string): boolean {
  const normal = (value: string) => (value.endsWith("/") ? value : `${value}/`);
  const target = normal(withBase(href));
  if (href === "/") return normal(pathname) === target;
  return normal(pathname).startsWith(target);
}

/** "/lookbook/x/" — the address of a lookbook, including the base path. */
export function lookbookUrl(id: string): string {
  return withBase(`/lookbook/${id}/`);
}

/** Two-digit look numbers: 1 → "01". */
export function lookNumber(index: number): string {
  return String(index + 1).padStart(2, "0");
}

/** Words-per-minute estimate for a markdown body. */
export function readingMinutes(body: string | undefined): number {
  const words = (body ?? "").split(/\s+/).filter(Boolean).length;
  return Math.max(1, Math.round(words / 220));
}
