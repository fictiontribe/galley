// Small helpers shared by layouts and sections. Site settings and navigation
// are read from src/data/*.json — components never hard-code copy.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Marked } from "marked";
import { scripts, utm } from "../galley/runtime/site-config.js";
import { planPage, resolveEntries } from "../galley/scripts/plan.js";
import siteData from "../data/site.json";
import navigationData from "../data/navigation.json";

export const site = siteData;
export const navigation = navigationData;
export const labels = siteData.labels;

export type Tone = "default" | "muted" | "inverse" | "accent";
export interface Link {
  label: string;
  href: string;
}

/**
 * Where a rendered section sits in its entry, for the visual page builder:
 * `key` is "<blocks field>.<index>" (e.g. "sections.3"), `type` its type.
 * Sections.astro makes one per section; Section.astro writes it onto the
 * section's root element as data-galley-block / data-galley-block-type.
 */
export interface BlockMarker {
  key: string;
  type: string;
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
  return template.replace(/\{(\w+)\}/g, (match, key: string) => (key in values ? String(values[key]) : match));
}

/**
 * The site's base path without a trailing slash: "" when the site is served
 * from the root of its domain, "/repo" for a GitHub Pages project site.
 * Set with `base` in astro.config.ts or `astro build --base /repo`.
 */
const basePath = import.meta.env.BASE_URL.replace(/\/+$/, "");

/**
 * Prefix a root-relative path ("/pricing/", "/images/x.svg") with the base
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

/** Markdown → HTML for longer text fields (rich-text, FAQ answers). */
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

const dateFormat = new Intl.DateTimeFormat(siteData.locale, { dateStyle: "long", timeZone: "UTC" });
const shortDateFormat = new Intl.DateTimeFormat(siteData.locale, { dateStyle: "medium", timeZone: "UTC" });

export function formatDate(date: Date): string {
  return dateFormat.format(date);
}

export function formatShortDate(date: Date): string {
  return shortDateFormat.format(date);
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
  if (href.includes("#")) return false;
  const normal = (value: string) => (value.endsWith("/") ? value : `${value}/`);
  const target = normal(withBase(href));
  if (href === "/") return normal(pathname) === target;
  return normal(pathname).startsWith(target);
}

/** Words-per-minute estimate for a markdown body. */
export function readingMinutes(body: string | undefined): number {
  const words = (body ?? "").split(/\s+/).filter(Boolean).length;
  return Math.max(1, Math.round(words / 220));
}

/** "Facilities teams" → "facilities-teams". */
export function slugify(text: string): string {
  return text
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * The markup of an SVG under public/, so it can be inlined and drawn in the
 * current look's colours (the files use the .s-* classes from global.css).
 * Returns undefined for anything else (rasters, remote files, missing
 * files), and the caller falls back to an <img>.
 */
const svgCache = new Map<string, string | undefined>();
export function inlineSvg(src: string): string | undefined {
  if (!src.startsWith("/") || src.startsWith("//") || !src.toLowerCase().endsWith(".svg")) return undefined;
  if (svgCache.has(src)) return svgCache.get(src);
  let markup: string | undefined;
  try {
    const text = readFileSync(join(process.cwd(), "public", decodeURIComponent(src)), "utf8");
    // Keep the <svg> element only: no XML prolog, comments or the file's own
    // <style> (its stand-alone colours; global.css supplies the look's).
    const start = text.indexOf("<svg");
    markup =
      start >= 0 && text.length < 80_000
        ? text
            .slice(start)
            .replace(/<!--[\s\S]*?-->/g, "")
            .replace(/<style[\s\S]*?<\/style>/g, "")
        : undefined;
  } catch {
    markup = undefined;
  }
  svgCache.set(src, markup);
  return markup;
}

/** Comparison cell values that render as a mark rather than as text. */
export type CellMark = "yes" | "no" | "partial";
export function cellMark(value: string): CellMark | undefined {
  const normal = value.trim().toLowerCase();
  return normal === "yes" || normal === "no" || normal === "partial" ? normal : undefined;
}

/**
 * A form's file with every link written from the site root given the base
 * path, like the rest of the site: Markdown links in its texts
 * ("[privacy policy](/privacy/)") and the addresses of redirect and download
 * actions. The site kit renders the form's texts itself, so they don't pass
 * through markdown() — this does it for them. At the domain root it changes
 * nothing.
 */
export function rebaseForm<T>(form: T): T {
  if (!basePath) return form;
  const walk = (value: unknown, key?: string): unknown => {
    if (typeof value === "string") {
      const linked = value.replace(/\]\((\/(?!\/)[^)\s]*)\)/g, (_, href: string) => `](${withBase(href)})`);
      return key === "url" ? withBase(linked) : linked;
    }
    if (Array.isArray(value)) return value.map((item) => walk(item));
    if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([name, item]) => [name, walk(item, name)]));
    return value;
  };
  return walk(form) as T;
}

/**
 * Whether the site kit shows its consent banner on this page — the same
 * decision <Scripts placement="body-end" /> makes from src/data/scripts.json
 * (the built-in banner, and an enabled script here that needs consent). The
 * footer's "Privacy choices" link, which reopens the banner, follows it.
 */
export function consentBannerShown(pathname: string, siteUrl?: URL): boolean {
  if (!scripts) return false;
  const path = basePath && pathname.startsWith(basePath) ? pathname.slice(basePath.length) || "/" : pathname;
  return planPage(scripts, { path, dev: import.meta.env.DEV, host: siteUrl?.hostname ?? "", utm, resolved: resolveEntries(scripts) }).banner;
}
