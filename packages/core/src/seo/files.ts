/**
 * Small readers for the site-level files the audit looks at: sitemaps,
 * llms.txt (the proposal at llmstxt.org) and redirect lists (Netlify's
 * `_redirects` and `netlify.toml`, Vercel's `vercel.json`, Cloudflare's
 * `_redirects`), which tell the engine where a moved page went.
 */
import { parse as parseToml } from "smol-toml";
import { decodeEntities } from "./html";

export interface SitemapFile {
  urls: Array<{ loc: string; lastmod?: string }>;
  /** A sitemap index: further sitemaps to read. */
  sitemaps: string[];
}

export function parseSitemap(xml: string): SitemapFile {
  const urls: SitemapFile["urls"] = [];
  const sitemaps: string[] = [];

  for (const match of xml.matchAll(/<url>([\s\S]*?)<\/url>/gi)) {
    const loc = /<loc>\s*([\s\S]*?)\s*<\/loc>/i.exec(match[1]!)?.[1];
    const lastmod = /<lastmod>\s*([\s\S]*?)\s*<\/lastmod>/i.exec(match[1]!)?.[1];

    if (loc) urls.push({ loc: decodeEntities(loc), ...(lastmod ? { lastmod } : {}) });
  }
  for (const match of xml.matchAll(/<sitemap>([\s\S]*?)<\/sitemap>/gi)) {
    const loc = /<loc>\s*([\s\S]*?)\s*<\/loc>/i.exec(match[1]!)?.[1];

    if (loc) sitemaps.push(decodeEntities(loc));
  }
  return { urls, sitemaps };
}

export interface LlmsTxt {
  title: string | null;
  summary: string | null;
  links: Array<{ name: string; url: string; section: string }>;
  problems: string[];
}

/** llms.txt as the proposal describes it: an H1 (the only required part), a blockquote summary, H2 sections of `[name](url)` lists. */
export function parseLlmsTxt(text: string): LlmsTxt {
  const lines = text.replace(/^﻿/, "").split(/\r?\n/);
  const first = lines.find((line) => line.trim() !== "");
  const title = first && /^#\s+\S/.test(first) ? first.replace(/^#\s+/, "").trim() : null;
  const summary = lines.find((line) => /^>\s?/.test(line))?.replace(/^>\s?/, "").trim() ?? null;
  const links: LlmsTxt["links"] = [];
  const problems: string[] = [];
  let section = "";

  for (const line of lines) {
    const heading = /^##\s+(.+)$/.exec(line);

    if (heading) {
      section = heading[1]!.trim();
      continue;
    }
    const link = /^\s*[-*]\s*\[([^\]]+)\]\(([^)\s]+)\)/.exec(line);

    if (link && section) links.push({ name: link[1]!, url: link[2]!, section });
  }
  if (!title) problems.push("It doesn't start with a top-level heading naming the site, the one part the format requires.");
  if (/^\s*<(!doctype|html)/i.test(text)) problems.push("It's a web page, not a plain-text file (the address probably serves an error page).");
  return { title, summary, links, problems };
}

export interface Redirect {
  from: string;
  to: string;
  status: number;
}

/** Plain one-to-one redirects (no wildcards or placeholders: those can't name a single new address). */
export function parseRedirects(file: string, text: string): Redirect[] {
  const out: Redirect[] = [];
  const keep = (from: unknown, to: unknown, status: unknown) => {
    if (typeof from !== "string" || typeof to !== "string") return;
    if (/[*:]/.test(from) || /[*:]/.test(to.replace(/^https?:/, ""))) return;
    const code = typeof status === "number" ? status : typeof status === "string" ? Number(status.replace("!", "")) : 301;

    if (code >= 300 && code < 400) out.push({ from, to, status: code });
  };

  try {
    if (file.endsWith("_redirects")) {
      for (const line of text.split(/\r?\n/)) {
        const parts = line.replace(/#.*$/, "").trim().split(/\s+/);

        if (parts.length >= 2) keep(parts[0], parts[1], parts[2] ?? 301);
      }
    } else if (file.endsWith("netlify.toml")) {
      const parsed = parseToml(text) as { redirects?: Array<{ from?: unknown; to?: unknown; status?: unknown }> };

      for (const rule of parsed.redirects ?? []) keep(rule.from, rule.to, rule.status ?? 301);
    } else if (file.endsWith("vercel.json")) {
      const parsed = JSON.parse(text) as { redirects?: Array<{ source?: unknown; destination?: unknown; permanent?: unknown; statusCode?: unknown }> };

      for (const rule of parsed.redirects ?? []) keep(rule.source, rule.destination, rule.statusCode ?? (rule.permanent === false ? 307 : 308));
    }
  } catch {
    // A redirects file that can't be read gives no moves; the link stays reported as broken.
  }
  return out;
}

/** "/about" and "/about/" as one key. */
export function pathKey(path: string): string {
  const bare = (path.split(/[?#]/)[0] ?? "").replace(/\/index\.html?$/, "/");

  return bare === "/" ? "/" : bare.replace(/\/+$/, "");
}
