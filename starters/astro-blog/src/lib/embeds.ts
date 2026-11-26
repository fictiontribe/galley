// Turning a post's rendered Markdown into what the page shows.
//
// astro.config.ts turns each fenced embed block (```chart …```) into a
// placeholder carrying its YAML. Here the post's HTML is cut at those
// placeholders into a list of parts — HTML, then an embed, then HTML… — and
// each embed's YAML is read and checked against its schema in
// src/content.config.ts. A block that doesn't match fails the build with the
// post, the block and the field named; in `astro dev` it shows the problem in
// place instead, so a half-typed chart never takes the page down.
//
// The same pass gives the HTML a few finishing touches: GitHub-style alerts
// ("> [!NOTE]") become callouts, an image with a title becomes a figure with
// a caption, tables scroll sideways on a phone, and pictures under public/
// get their real size and a smaller file for small screens.

import { parse } from "yaml";
import { embedSchemas } from "../content.config";
import { EMBED_KINDS, type EmbedKind } from "./embed-kinds";
import { imageAttributes, labels } from "./site";

export type Part =
  | { kind: "html"; html: string }
  | { kind: "embed"; type: EmbedKind; data: Record<string, unknown> }
  | { kind: "invalid"; type: string; problem: string; source: string };

const PLACEHOLDER = /<div data-embed="([a-z-]+)" data-source="([^"]*)"><\/div>/g;
const kinds = new Set<string>(EMBED_KINDS);

/** Read one embed block's YAML against its schema; the problem in words if it doesn't fit. */
export function readEmbed(type: string, source: string): { data: Record<string, unknown> } | { problem: string } {
  if (!kinds.has(type)) return { problem: `There is no embed called “${type}”.` };
  let raw: unknown;
  try {
    raw = parse(source);
  } catch (error) {
    return { problem: `The YAML can't be read: ${(error as Error).message.split("\n")[0]}` };
  }
  const result = embedSchemas[type as EmbedKind].safeParse(raw ?? {});
  if (result.success) return { data: result.data as Record<string, unknown> };
  return {
    problem: result.error.issues.map((issue) => `${issue.path.join(".") || type}: ${issue.message}`).join("; "),
  };
}

/** Cut a post's HTML into parts at its embeds. `where` names the post in build errors. */
export function splitBody(html: string, where: string): Part[] {
  const parts: Part[] = [];
  let last = 0;

  for (const match of html.matchAll(PLACEHOLDER)) {
    const before = html.slice(last, match.index);
    if (before.trim()) parts.push({ kind: "html", html: finish(before) });
    const type = match[1]!;
    const source = decodeURIComponent(match[2]!);
    const read = readEmbed(type, source);

    if ("data" in read) parts.push({ kind: "embed", type: type as EmbedKind, data: read.data });
    else if (import.meta.env.DEV) parts.push({ kind: "invalid", type, problem: read.problem, source });
    else throw new Error(`${where}: the \`${type}\` block can't be shown — ${read.problem}`);
    last = match.index! + match[0].length;
  }
  const rest = html.slice(last);
  if (rest.trim()) parts.push({ kind: "html", html: finish(rest) });
  return parts;
}

const ALERTS = ["note", "tip", "important", "warning", "caution"];
const attr = (tag: string, name: string) => new RegExp(`\\s${name}="([^"]*)"`).exec(tag)?.[1];

/** The finishing touches described at the top. */
export function finish(html: string): string {
  return (
    html
      // > [!NOTE] … → a callout. The first line may carry a title: > [!TIP] Before you drill
      .replace(/<blockquote>\s*<p>\[!(\w+)\]([^\n<]*)(?:\n|<br\s*\/?>)?([\s\S]*?)<\/blockquote>/gi, (whole, type: string, title: string, rest: string) => {
        const kind = type.toLowerCase();
        if (!ALERTS.includes(kind)) return whole;
        const heading = title.trim() || labels.callouts[kind as keyof typeof labels.callouts];
        return `<aside class="callout callout--${kind}" data-callout="${kind}">${heading ? `<p class="callout__title">${heading}</p>` : ""}<div class="callout__body"><p>${rest.trim()}</div></aside>`;
      })
      .replace(/<div class="callout__body"><p><\/p>/g, '<div class="callout__body">')
      // A paragraph that is only an image with a title → a figure with a caption.
      .replace(/<p>\s*(<img [^>]*\btitle="[^"]+"[^>]*>)\s*<\/p>/g, (_, img: string) => {
        const caption = attr(img, "title")!;
        return `<figure class="prose-figure">${img.replace(/\stitle="[^"]*"/, "")}<figcaption>${caption}</figcaption></figure>`;
      })
      .replace(/<p>\s*(<img [^>]*>)\s*<\/p>/g, '<figure class="prose-figure">$1</figure>')
      // Pictures: lazy, sized, with a smaller file for phones when there is one.
      .replace(/<img ([^>]*?)\/?>/g, (whole, inner: string) => {
        const src = attr(` ${inner}`, "src");
        if (!src || /\swidth=/.test(` ${inner}`)) return whole;
        const info = imageAttributes(src, "(min-width: 64rem) 60rem, 100vw");
        const extra = [
          info.srcset ? `srcset="${info.srcset}" sizes="${info.sizes}"` : "",
          info.width ? `width="${info.width}" height="${info.height}"` : "",
          'loading="lazy" decoding="async"',
        ]
          .filter(Boolean)
          .join(" ");
        return `<img ${inner.replace(/\s*$/, "")} ${extra}>`;
      })
      // Tables scroll on their own on a narrow screen, never the page.
      .replace(/<table>/g, '<div class="table-scroll" tabindex="0"><table>')
      .replace(/<\/table>/g, "</table></div>")
  );
}
