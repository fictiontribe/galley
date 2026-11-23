/**
 * Redirects: every imported item whose address changes keeps its old address
 * working. Emitted as data and as two ready-to-paste snippets (an Astro
 * `redirects` object and a `_redirects` file, which Netlify and Cloudflare
 * Pages both read). The site's own config is never edited by the importer.
 */
import type { Redirect } from "./types";

/** The path of a permalink on the old site, or null when it has no path of its own (`?p=123`). */
export function oldPath(link: string, siteUrl: string): string | null {
  let url: URL;

  try {
    url = new URL(link, `${siteUrl}/`);
  } catch {
    return null;
  }
  if (url.pathname === "/" && /[?&](p|page_id|attachment_id)=/.test(url.search)) return null;
  let path = url.pathname;

  try {
    path = decodeURI(path);
  } catch {
    // keep it encoded
  }
  return path || "/";
}

export function pathKey(path: string): string {
  let key = path.split(/[?#]/)[0] ?? "";

  try {
    key = decodeURI(key);
  } catch {
    // compare as given
  }
  return key.replace(/\/+$/, "").replace(/\/index\.html?$/, "") || "/";
}

export function samePath(a: string, b: string): boolean {
  return pathKey(a) === pathKey(b);
}

export function astroSnippet(redirects: Redirect[]): string {
  if (redirects.length === 0) return "";
  const lines = redirects.map((redirect) => `    ${JSON.stringify(redirect.from)}: ${JSON.stringify(redirect.to)},`);

  return ["// Paste into astro.config.* — keeps the old WordPress addresses working.", "export default defineConfig({", "  redirects: {", ...lines, "  },", "});", ""].join("\n");
}

export function netlifySnippet(redirects: Redirect[]): string {
  if (redirects.length === 0) return "";
  const width = Math.max(...redirects.map((redirect) => encodeURI(redirect.from).length));

  return [
    "# Old WordPress addresses → their new home (Netlify and Cloudflare Pages read this file from the published folder).",
    ...redirects.map((redirect) => `${encodeURI(redirect.from).padEnd(width)}  ${encodeURI(redirect.to)}  301`),
    "",
  ].join("\n");
}
