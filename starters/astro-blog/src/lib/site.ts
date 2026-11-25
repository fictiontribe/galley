// Small helpers shared by layouts and components. Site settings and
// navigation are read from src/data/*.json — components never hard-code copy.

import { Marked } from "marked";
import siteData from "../data/site.json";
import navigationData from "../data/navigation.json";
import imageData from "./images.json";
import { EMBED_KINDS } from "./embed-kinds";

const EMBEDS = new Set<string>(EMBED_KINDS);

export const site = siteData;
export const navigation = navigationData;
export const labels = siteData.labels;

export type Tone = "default" | "muted" | "inverse" | "accent";
export interface Link {
  label: string;
  href: string;
}

/** A slim, dismissible bar above the header (`starterNotice` in site.json). */
export interface StarterNotice {
  label: string;
  text: string;
  link?: Link;
  dismiss: string;
}

/** The notice the template's demo shows. Delete it from site.json and the bar, and its few lines of script, are gone. */
export const starterNotice = (siteData as { starterNotice?: StarterNotice }).starterNotice;

/** Replace `{name}` placeholders in a label, e.g. "Page {current} of {total}". */
export function fill(template: string, values: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (match, key: string) => (key in values ? String(values[key]) : match));
}

/**
 * The site's base path without a trailing slash: "" at the root of a domain,
 * "/repo" for a GitHub Pages project site (`astro build --base /repo`).
 */
const basePath = import.meta.env.BASE_URL.replace(/\/+$/, "");

/**
 * Prefix a root-relative path ("/about/", "/images/x.webp") with the base
 * path. Content always writes links and images from the site root; every
 * component passes them through here. Other values (https:, mailto:,
 * #anchors, "//host") are returned unchanged. Astro.url and paginate() URLs
 * already include the base: don't pass them.
 */
export function withBase(path: string): string;
export function withBase(path: string | undefined): string | undefined;
export function withBase(path: string | undefined): string | undefined {
  if (!path || !basePath || !path.startsWith("/") || path.startsWith("//")) return path;
  return `${basePath}${path}`;
}

/** The base path taken off an address, for comparing with content paths. */
export function withoutBase(pathname: string): string {
  return basePath && pathname.startsWith(basePath) ? pathname.slice(basePath.length) || "/" : pathname;
}

// Links and images in Markdown fields go through withBase() too.
const markdownParser = new Marked({
  walkTokens(token) {
    if (token.type === "link" || token.type === "image") token.href = withBase(token.href);
  },
});

/** Markdown → HTML, for longer text fields. */
export function markdown(text: string): string {
  return markdownParser.parse(text, { async: false });
}

/** Inline Markdown → HTML for one-line fields, so `*word*` becomes emphasis. */
export function inline(text: string): string {
  return markdownParser.parseInline(text, { async: false });
}

/** Strip inline Markdown for places that need plain text (alt, aria, meta). */
export function plain(text: string): string {
  return text.replace(/[*_`]/g, "");
}

const dateFormat = new Intl.DateTimeFormat(siteData.locale, { dateStyle: "long", timeZone: "UTC" });
const shortDateFormat = new Intl.DateTimeFormat(siteData.locale, { day: "numeric", month: "short", timeZone: "UTC" });

export function formatDate(date: Date): string {
  return dateFormat.format(date);
}

/** "12 Mar" — for lists grouped by year. */
export function formatShortDate(date: Date): string {
  return shortDateFormat.format(date);
}

/** "2026-03-12" — for datetime attributes. */
export function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/**
 * Absolute URL on the public site, for canonical links, share images and
 * feeds. The origin is `site` (from site.json, or `astro build --site …`);
 * `path` must already include the base path.
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

/** Whether a link leaves the site. */
export function isExternal(href: string): boolean {
  return /^https?:\/\//.test(href);
}

/**
 * Words-per-minute estimate for a Markdown body. Code is left out; an embed
 * (a chart, a table) counts as the words in it, since it is read too.
 */
export function readingMinutes(body: string | undefined): number {
  const prose = (body ?? "").replace(/```([a-z]*)[^\n]*\n([\s\S]*?)```/g, (_, lang: string, inner: string) => (EMBEDS.has(lang) ? inner.replace(/[\w-]+:|[-\[\]{}"]/g, " ") : " "));
  const words = prose.split(/\s+/).filter(Boolean).length;
  return Math.max(1, Math.round(words / 230));
}

/** "Hanna's loft" → "hannas-loft". */
export function slugify(text: string): string {
  return text
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** What src/lib/images.json knows about a picture: its real size and the widths it comes in. */
export interface ImageInfo {
  width: number;
  height: number;
  widths: number[];
}

const images = imageData as Record<string, ImageInfo>;

/**
 * The attributes of an <img> for a picture under public/: its src, and — when
 * `npm run photos` made it — the smaller file for small screens (srcset) and
 * its real size, so the box is reserved before it loads.
 */
export function imageAttributes(src: string, sizes: string): { src: string; srcset?: string; sizes?: string; width?: number; height?: number } {
  const info = images[src];
  if (!info) return { src: withBase(src) };
  const variant = (width: number) => (width === info.width ? src : src.replace(/\.(\w+)$/, `-${width}.$1`));
  return {
    src: withBase(src),
    srcset: info.widths.map((width) => `${withBase(variant(width))} ${width}w`).join(", "),
    sizes,
    width: info.width,
    height: info.height,
  };
}
