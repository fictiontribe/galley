/**
 * A small, tolerant reader for rendered pages: the facts the rendered checks
 * need (head tags, headings, images, links, structured data, ids, visible
 * text) from a static site's HTML. Not a full HTML parser — built output is
 * regular enough, and the checks only ever report what they found.
 */
import { collapse } from "./text";

export interface HtmlImage {
  src: string;
  alt: string | null;
  width: string | null;
  height: string | null;
  /** Inline style mentions aspect-ratio (space reserved without width/height). */
  ratioStyle: boolean;
  srcset: boolean;
}

export interface HtmlLink {
  href: string;
  text: string;
  label: string | null;
  /** Alt text of images inside the link. */
  imageAlt: string;
}

export interface JsonLdBlock {
  raw: string;
  value: unknown;
  error?: string;
}

export interface PageFacts {
  title: string | null;
  titles: number;
  metas: Map<string, string>;
  /** rel → hrefs, with type when given ("alternate text/markdown"). */
  links: Array<{ rel: string; href: string; type: string | null }>;
  headings: Array<{ level: number; text: string }>;
  images: HtmlImage[];
  anchors: HtmlLink[];
  jsonld: JsonLdBlock[];
  ids: Set<string>;
  /** Visible text with scripts and styles removed: what a crawler that runs no scripts reads. */
  text: string;
  lang: string | null;
  /** The page redirects with <meta http-equiv="refresh"> (how static hosts write redirects). */
  refresh: boolean;
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", rsquo: "’", lsquo: "‘", rdquo: "”", ldquo: "“", mdash: "—", ndash: "–", hellip: "…", middot: "·", copy: "©" };

export function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, name: string) => {
    if (name.startsWith("#x") || name.startsWith("#X")) return String.fromCodePoint(parseInt(name.slice(2), 16));
    if (name.startsWith("#")) return String.fromCodePoint(Number(name.slice(1)));
    return ENTITIES[name.toLowerCase()] ?? match;
  });
}

export function attributes(source: string): Map<string, string> {
  const out = new Map<string, string>();

  for (const match of source.matchAll(/([^\s=/"'>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g)) {
    const name = match[1]!.toLowerCase();

    if (!out.has(name)) out.set(name, decodeEntities(match[2] ?? match[3] ?? match[4] ?? ""));
  }
  return out;
}

const VOID = new Set(["area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "source", "track", "wbr"]);
const BLOCK = new Set(["p", "div", "section", "article", "header", "footer", "main", "nav", "li", "ul", "ol", "h1", "h2", "h3", "h4", "h5", "h6", "br", "tr", "td", "th", "table", "blockquote", "figure", "figcaption", "dt", "dd", "aside", "form", "pre"]);

export function parsePage(html: string): PageFacts {
  const facts: PageFacts = { title: null, titles: 0, metas: new Map(), links: [], headings: [], images: [], anchors: [], jsonld: [], ids: new Set(), text: "", lang: null, refresh: false };
  const text: string[] = [];
  const open: { heading: { level: number; parts: string[] } | null; anchor: { href: string; label: string | null; parts: string[]; alts: string[] } | null; title: string[] | null } = { heading: null, anchor: null, title: null };
  const tag = /<!--[\s\S]*?-->|<(\/?)([a-zA-Z][\w:-]*)((?:[^>"']|"[^"]*"|'[^']*')*)>/g;
  let last = 0;
  let inBody = false;
  let match: RegExpExecArray | null;

  const addText = (raw: string) => {
    const chunk = decodeEntities(raw);

    if (!chunk.trim()) {
      if (chunk) text.push(" ");
      return;
    }
    if (open.title) {
      open.title.push(chunk);
      return;
    }
    text.push(chunk);
    open.heading?.parts.push(chunk);
    open.anchor?.parts.push(chunk);
  };

  while ((match = tag.exec(html))) {
    if (inBody || open.title) addText(html.slice(last, match.index));
    last = tag.lastIndex;
    if (match[0].startsWith("<!--")) continue;
    const closing = match[1] === "/";
    const name = match[2]!.toLowerCase();
    const attrs = closing ? new Map<string, string>() : attributes(match[3] ?? "");

    if (!closing) {
      const id = attrs.get("id");

      if (id) facts.ids.add(id);
      const nameAttr = attrs.get("name");

      if (name === "a" && nameAttr) facts.ids.add(nameAttr);
      // An element inside a link that names itself (role="img" aria-label="…") names the link.
      if (open.anchor && name !== "a" && attrs.get("aria-label") && attrs.get("aria-hidden") !== "true") open.anchor.alts.push(attrs.get("aria-label")!);
    }
    if (name === "script" || name === "style" || name === "noscript" || name === "template") {
      if (closing) continue;
      const end = html.toLowerCase().indexOf(`</${name}`, last);
      const body = end === -1 ? html.slice(last) : html.slice(last, end);

      if (name === "script" && (attrs.get("type") ?? "").toLowerCase() === "application/ld+json") {
        try {
          facts.jsonld.push({ raw: body.trim(), value: JSON.parse(body) });
        } catch (error) {
          facts.jsonld.push({ raw: body.trim(), value: null, error: error instanceof Error ? error.message : String(error) });
        }
      }
      // noscript content is what a script-less reader sees, so it counts as text.
      if (name === "noscript" && inBody) addText(body.replace(/<[^>]+>/g, " "));
      tag.lastIndex = end === -1 ? html.length : end;
      last = tag.lastIndex;
      continue;
    }
    switch (name) {
      case "html":
        if (!closing) facts.lang = attrs.get("lang") ?? null;
        break;
      case "body":
        inBody = !closing;
        break;
      case "title":
        if (!closing && !inBody) {
          open.title = [];
          facts.titles += 1;
        } else if (closing && open.title) {
          if (facts.title === null) facts.title = collapse(open.title.join(""));
          open.title = null;
        }
        break;
      case "meta": {
        const key = (attrs.get("name") ?? attrs.get("property") ?? "").toLowerCase();

        if (key && !facts.metas.has(key)) facts.metas.set(key, attrs.get("content") ?? "");
        if ((attrs.get("http-equiv") ?? "").toLowerCase() === "refresh") facts.refresh = true;
        break;
      }
      case "link":
        if (attrs.get("rel")) for (const rel of (attrs.get("rel") ?? "").toLowerCase().split(/\s+/)) facts.links.push({ rel, href: attrs.get("href") ?? "", type: attrs.get("type")?.toLowerCase() ?? null });
        break;
      case "img":
        if (inBody && !closing) {
          facts.images.push({
            src: attrs.get("src") ?? "",
            alt: attrs.has("alt") ? (attrs.get("alt") ?? "") : null,
            width: attrs.get("width") ?? null,
            height: attrs.get("height") ?? null,
            ratioStyle: /aspect-ratio|--ratio/i.test(attrs.get("style") ?? ""),
            srcset: attrs.has("srcset"),
          });
          open.anchor?.alts.push(attrs.get("alt") ?? "");
        }
        break;
      case "a":
        if (!closing && inBody) open.anchor = { href: attrs.get("href") ?? "", label: attrs.get("aria-label") ?? attrs.get("title") ?? null, parts: [], alts: [] };
        else if (closing && open.anchor) {
          facts.anchors.push({ href: open.anchor.href, text: collapse(open.anchor.parts.join("")), label: open.anchor.label, imageAlt: collapse(open.anchor.alts.join(" ")) });
          open.anchor = null;
        }
        break;
      case "svg":
        // An inline drawing's text isn't page text; its <title> names a link it sits in.
        if (!closing) {
          const end = html.toLowerCase().indexOf("</svg", last);
          const inner = end === -1 ? "" : html.slice(last, end);
          const label = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(inner)?.[1] ?? attrs.get("aria-label");

          if (label && open.anchor && attrs.get("aria-hidden") !== "true") open.anchor.alts.push(decodeEntities(label));
          if (end !== -1) {
            tag.lastIndex = end;
            last = end;
          }
        }
        break;
      default:
        if (/^h[1-6]$/.test(name) && inBody) {
          if (!closing) open.heading = { level: Number(name[1]), parts: [] };
          else if (open.heading) {
            facts.headings.push({ level: open.heading.level, text: collapse(open.heading.parts.join("")) });
            open.heading = null;
          }
        }
    }
    if (inBody && BLOCK.has(name)) text.push(" ");
    if (!closing && VOID.has(name)) continue;
  }
  if (inBody) addText(html.slice(last));
  facts.text = collapse(text.join(""));
  return facts;
}

/** Every `@type` in a JSON-LD value, walking @graph and nested objects. */
export function jsonLdNodes(value: unknown, out: Array<Record<string, unknown>> = []): Array<Record<string, unknown>> {
  if (Array.isArray(value)) {
    for (const item of value) jsonLdNodes(item, out);
    return out;
  }
  if (!value || typeof value !== "object") return out;
  const record = value as Record<string, unknown>;

  if (record["@type"] !== undefined) out.push(record);
  for (const [key, child] of Object.entries(record)) if (key === "@graph" || (child && typeof child === "object")) jsonLdNodes(child, out);
  return out;
}

export function typesOf(node: Record<string, unknown>): string[] {
  const type = node["@type"];

  return (Array.isArray(type) ? type : [type]).filter((t): t is string => typeof t === "string").map((t) => t.replace(/^https?:\/\/schema\.org\//, ""));
}

/** "/docs/about/" → "/about/" under the base "/docs"; anything else unchanged. */
export function stripBase(path: string, base: string): string {
  if (!base) return path;
  if (path === base) return "/";
  return path.startsWith(`${base}/`) ? path.slice(base.length) : path;
}

function localHref(href: string, base: string): string {
  if (!base) return href;
  if (/^\/(?!\/)/.test(href)) return stripBase(href, base);
  if (!/^https?:\/\//i.test(href)) return href;
  try {
    const url = new URL(href);
    const path = stripBase(url.pathname, base);

    return path === url.pathname ? href : `${url.origin}${path}${url.search}${url.hash}`;
  } catch {
    return href;
  }
}

/**
 * The page's addresses with the site's base path taken off, so a sub-path
 * build ("/docs/about/") is compared with the content's own addresses
 * ("/about/") the same way a root build is.
 */
export function localizeFacts(facts: PageFacts, base: string): PageFacts {
  if (!base) return facts;
  return {
    ...facts,
    links: facts.links.map((link) => ({ ...link, href: localHref(link.href, base) })),
    anchors: facts.anchors.map((anchor) => ({ ...anchor, href: localHref(anchor.href, base) })),
    images: facts.images.map((image) => ({ ...image, src: localHref(image.src, base) })),
    metas: new Map([...facts.metas].map(([key, value]) => [key, key === "og:image" || key === "og:url" ? localHref(value, base) : value])),
  };
}
