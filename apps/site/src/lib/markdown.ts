/**
 * Markdown for this site, rendered with `marked` so the output is exactly what
 * the stylesheet expects: headings carry ids and an anchor link, code blocks
 * carry a copy button, external links are marked as such. Used for docs
 * bodies, page bodies, front-matter strings and the changelog.
 */
import { Marked, type Tokens } from "marked";
import { fill } from "./site";
import docsData from "../data/docs.json";

const docsUi = { output: (docsData.ui as Record<string, string>).output ?? "", copy: (docsData.ui as Record<string, string>).copy ?? "" };

export interface Heading {
  depth: number;
  slug: string;
  text: string;
}

export function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/<[^>]+>/g, "")
    .replace(/&[a-z]+;/g, "")
    .replace(/[`*_~“”‘’"'.,:;!?()[\]{}/\\|<>@#$%^&+=]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-");
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function plain(text: string): string {
  return text.replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'");
}

function createMarked(headings: Heading[], anchors: boolean): Marked {
  const used = new Map<string, number>();
  const marked = new Marked({ gfm: true });

  marked.use({
    renderer: {
      heading(this: { parser: { parseInline(tokens: Tokens.Generic[]): string } }, token: Tokens.Heading) {
        const html = this.parser.parseInline(token.tokens);
        const text = plain(html);
        let slug = slugify(text) || "section";
        const seen = used.get(slug) ?? 0;
        used.set(slug, seen + 1);
        if (seen > 0) slug = `${slug}-${seen}`;
        headings.push({ depth: token.depth, slug, text });
        if (!anchors || token.depth === 1) return `<h${token.depth} id="${slug}">${html}</h${token.depth}>\n`;
        // The anchor is for people on the page; the markdown copy of the page (the site kit) leaves it out, or every heading there would begin "Link to this section:".
        return `<h${token.depth} id="${slug}"><a class="anchor" href="#${slug}" data-galley-agent="skip"><span class="sr">${escapeHtml((docsData.ui as Record<string, string>).anchor ?? "")} </span><span aria-hidden="true">#</span></a>${html}</h${token.depth}>\n`;
      },
      code(token: Tokens.Code) {
        const lang = (token.lang ?? "").split(/\s+/)[0] ?? "";
        // What a person then sees: a quiet, labelled block with no Copy.
        if (lang === "output") return `<figure class="out"><figcaption class="out__label">${escapeHtml(docsUi.output)}</figcaption><pre tabindex="0"><code>${escapeHtml(token.text)}</code></pre></figure>\n`;
        // What a person types (sh) and any other code: the block with Copy. A
        // shell prompt left in an older page is shown but never copied.
        const shell = lang === "sh" || lang === "shell" || lang === "bash";
        const copyText = shell ? token.text.replace(/^\$ /gm, "") : token.text;
        return `<div class="code${shell ? " code--cmd" : ""}"><pre tabindex="0"${lang ? ` data-lang="${escapeHtml(lang)}"` : ""}><code>${escapeHtml(token.text)}</code></pre><button type="button" class="copy code__copy" data-copy-text="${escapeHtml(copyText)}" hidden>${escapeHtml(docsUi.copy)}</button></div>\n`;
      },
      link(this: { parser: { parseInline(tokens: Tokens.Generic[]): string } }, token: Tokens.Link) {
        const text = this.parser.parseInline(token.tokens);
        const href = fill(token.href);
        const title = token.title ? ` title="${escapeHtml(token.title)}"` : "";
        const external = /^https?:\/\//.test(href);
        return `<a href="${escapeHtml(href)}"${title}${external ? ' rel="external"' : ""}>${text}</a>`;
      },
      table(this: { parser: { parseInline(tokens: Tokens.Generic[]): string } }, token: Tokens.Table) {
        const cell = (c: Tokens.TableCell, tag: "th" | "td") => `<${tag}${c.align ? ` style="text-align:${c.align}"` : ""}${tag === "th" ? ' scope="col"' : ""}>${this.parser.parseInline(c.tokens)}</${tag}>`;
        const head = `<tr>${token.header.map((c) => cell(c, "th")).join("")}</tr>`;
        const body = token.rows.map((row) => `<tr>${row.map((c) => cell(c, "td")).join("")}</tr>`).join("");
        return `<div class="table-wrap" tabindex="0"><table><thead>${head}</thead><tbody>${body}</tbody></table></div>\n`;
      },
    },
  });
  return marked;
}

/** Block markdown → HTML, plus the headings it contains. */
export function renderMarkdown(source: string, options: { anchors?: boolean } = {}): { html: string; headings: Heading[] } {
  const headings: Heading[] = [];
  const html = createMarked(headings, options.anchors ?? true).parse(fill(source), { async: false }) as string;
  return { html, headings };
}

/** One line of markdown (front-matter strings) → inline HTML, no wrapping <p>. */
export function inline(source: string | undefined | null): string {
  if (!source) return "";
  const html = createMarked([], false).parseInline(fill(source), { async: false }) as string;
  // Keep short hyphenated compounds ("AI-first", "e-commerce") on one line.
  return html.replace(/(^|[\s(>])([A-Za-z]{1,3}-[A-Za-z]{2,})(?=[\s.,;:)<]|$)/g, '$1<span class="nobr">$2</span>');
}

/** Markdown → plain text, for meta descriptions and llms files. */
export function toPlain(source: string): string {
  return plain(inline(source));
}
