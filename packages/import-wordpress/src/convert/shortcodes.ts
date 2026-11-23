/**
 * Shortcodes: WordPress's `[name attr="…"]content[/name]` macros.
 *
 * An export file carries them unexpanded; the REST API expands the ones a
 * live plugin still handles and leaves the rest as text. The standard ones
 * WordPress ships (caption, gallery, embed, video, audio) are turned into the
 * HTML WordPress itself would have produced, so the HTML converter sees one
 * shape whichever way the content arrived. Page-builder layout shortcodes
 * (Divi, WPBakery) become plain structural markup the outline reader
 * understands. Anything else stays visibly in place — the page still shows
 * "[contact-form-7 id=…]" where the form was — and is listed in the report,
 * because silently dropping it would lose something the person needs to see.
 *
 * Parsing follows WordPress's own rules (shortcode_parse_atts, enclosing vs
 * self-closing decided by whether a matching closing tag follows, `[[x]]`
 * escapes) on the shortcode syntax itself; the HTML around it is left alone.
 */
import type { BuilderName, WordPressMedia } from "../types";
import { escapeAttribute, escapeHtml, linkEmbed, videoEmbed } from "./embeds";
import type { Tokens } from "./tokens";

export interface ShortcodeContext {
  tokens: Tokens;
  /** Keep every shortcode as written (for text WordPress already rendered: anything left is unknown). */
  keepAll?: boolean;
  mediaById(id: number): WordPressMedia | undefined;
  /** Images attached to the post being converted (a bare [gallery] shows these). */
  attachments(): WordPressMedia[];
}

export interface ShortcodeResult {
  html: string;
  /** Names of shortcodes left in place, one entry per use. */
  unknown: string[];
  embeds: number;
  builder?: BuilderName;
  /** Builder modules that had no specific conversion (their text was kept). */
  builderModules: string[];
}

interface Tag {
  name: string;
  attrs: Record<string, string>;
  /** Positional attributes (`[embed https://…]`). */
  positional: string[];
  raw: string;
  start: number;
  end: number;
  closing: boolean;
  selfClosed: boolean;
  escaped: boolean;
}

interface Node {
  tag: Tag;
  /** Enclosing shortcodes: the children between the opening and closing tag. */
  children: Array<Node | string> | null;
  closeRaw?: string;
}

const STANDARD = new Set(["caption", "wp_caption", "gallery", "embed", "video", "audio", "code", "sourcecode"]);
const TAG = /\[(\[?)(\/?)([A-Za-z][\w-]*)((?:\s[^\]]*?)?)(\/?)\](\]?)/g;

export function parseAttributes(text: string): { attrs: Record<string, string>; positional: string[] } {
  const attrs: Record<string, string> = {};
  const positional: string[] = [];
  // Old content often has texturized quotes inside attributes; WordPress normalises them the same way.
  const normalized = text.replace(/[ ​]/g, " ").replace(/&#8221;|&#8243;|[“”″]/g, '"').replace(/&#8217;|&#8242;|[‘’′]/g, "'");
  const pattern = /([\w-]+)\s*=\s*"([^"]*)"(?:\s|$)|([\w-]+)\s*=\s*'([^']*)'(?:\s|$)|([\w-]+)\s*=\s*([^\s'"]+)(?:\s|$)|"([^"]*)"(?:\s|$)|'([^']*)'(?:\s|$)|(\S+)(?:\s|$)/g;

  for (const match of normalized.matchAll(pattern)) {
    if (match[1] !== undefined) attrs[match[1].toLowerCase()] = match[2] ?? "";
    else if (match[3] !== undefined) attrs[match[3].toLowerCase()] = match[4] ?? "";
    else if (match[5] !== undefined) attrs[match[5].toLowerCase()] = match[6] ?? "";
    else positional.push(match[7] ?? match[8] ?? match[9] ?? "");
  }
  return { attrs, positional: positional.filter(Boolean) };
}

/** Bracketed words that are almost certainly prose, not a shortcode: "[sic]", "[1]". */
function plausible(tag: Tag, hasClose: boolean): boolean {
  if (STANDARD.has(tag.name) || builderOf(tag.name)) return true;
  return hasClose || tag.selfClosed || Object.keys(tag.attrs).length > 0 || /[_-]/.test(tag.name);
}

function builderOf(name: string): BuilderName | null {
  if (name.startsWith("et_pb_")) return "divi";
  if (name.startsWith("vc_")) return "wpbakery";
  if (name.startsWith("fl_builder")) return "beaver";
  return null;
}

function tokenize(text: string): Tag[] {
  const tags: Tag[] = [];

  for (const match of text.matchAll(TAG)) {
    const [raw, open = "", slash = "", name = "", attrText = "", self = "", close = ""] = match;
    const { attrs, positional } = parseAttributes(attrText);

    tags.push({
      name: name.toLowerCase(),
      attrs,
      positional,
      raw,
      start: match.index ?? 0,
      end: (match.index ?? 0) + raw.length,
      closing: slash === "/",
      selfClosed: self === "/",
      escaped: open === "[" && close === "]",
    });
  }
  return tags;
}

/** Builds the shortcode tree: an opening tag encloses content only when its closing tag follows. */
function parse(text: string): Array<Node | string> {
  const tags = tokenize(text);
  const closers = new Map<string, number>();

  for (const tag of tags) if (tag.closing) closers.set(tag.name, (closers.get(tag.name) ?? 0) + 1);
  type Frame = { node: Node; children: Array<Node | string>; cursor: number };
  const root: Array<Node | string> = [];
  const stack: Frame[] = [];
  let cursor = 0;
  const current = () => (stack.length ? stack[stack.length - 1]!.children : root);
  const pushText = (until: number) => {
    if (until > cursor) current().push(text.slice(cursor, until));
    cursor = Math.max(cursor, until);
  };

  for (const tag of tags) {
    if (tag.start < cursor) continue;
    if (tag.escaped) {
      pushText(tag.start);
      current().push(tag.raw.slice(1, -1));
      cursor = tag.end;
      continue;
    }
    if (tag.closing) {
      const at = stack.map((frame) => frame.node.tag.name).lastIndexOf(tag.name);

      if (at < 0) continue; // A stray closing tag is just text.
      pushText(tag.start);
      // Anything opened inside and never closed was self-closing after all.
      while (stack.length - 1 > at) {
        const frame = stack.pop()!;

        frame.node.children = null;
        current().push(frame.node, ...frame.children);
      }
      const frame = stack.pop()!;

      frame.node.children = frame.children;
      frame.node.closeRaw = tag.raw;
      current().push(frame.node);
      cursor = tag.end;
      closers.set(tag.name, (closers.get(tag.name) ?? 1) - 1);
      continue;
    }
    const remainingClose = (closers.get(tag.name) ?? 0) > 0;

    if (!plausible(tag, remainingClose)) continue;
    pushText(tag.start);
    cursor = tag.end;
    const node: Node = { tag, children: null };

    if (!tag.selfClosed && remainingClose) {
      stack.push({ node, children: [], cursor });
    } else {
      current().push(node);
    }
  }
  pushText(text.length);
  while (stack.length > 0) {
    const frame = stack.pop()!;

    current().push(frame.node, ...frame.children);
  }
  return root;
}

function ids(value: string | undefined): number[] {
  return (value ?? "")
    .split(/[\s,]+/)
    .map(Number)
    .filter((id) => Number.isInteger(id) && id > 0);
}

function imageFigure(src: string, alt: string, caption: string): string {
  return `<figure><img src="${escapeAttribute(src)}" alt="${escapeAttribute(alt)}">${caption ? `<figcaption>${escapeHtml(caption)}</figcaption>` : ""}</figure>`;
}

/** WPBakery's `link` attribute: "url:https%3A%2F%2F…|title:Read%20more|target:_blank". */
function vcLink(value: string | undefined): { url: string; title: string } {
  const out = { url: "", title: "" };

  for (const part of (value ?? "").split("|")) {
    const [key, ...rest] = part.split(":");
    const decoded = safeDecode(rest.join(":"));

    if (key === "url") out.url = decoded;
    if (key === "title") out.title = decoded;
  }
  return out;
}

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

/** Divi stores quotes and brackets inside attributes percent-style. */
function diviText(value: string | undefined): string {
  return (value ?? "").replace(/%22/g, '"').replace(/%91/g, "[").replace(/%93/g, "]").replace(/%5c/gi, "\\");
}

function columnWidth(value: string | undefined): string {
  const match = /^(\d+)[_/](\d+)$/.exec(value ?? "");

  return match ? ` data-gwp-width="${Math.round((Number(match[1]) / Number(match[2])) * 100)}"` : "";
}

export function processShortcodes(html: string, context: ShortcodeContext): ShortcodeResult {
  if (!html.includes("[")) return { html, unknown: [], embeds: 0, builderModules: [] };
  const unknown: string[] = [];
  const builderModules: string[] = [];
  // Players from [embed], [video] and [audio] come out as plain HTML; the HTML pass counts them once, with every other embed.
  const embeds = 0;
  let builder: BuilderName | undefined;
  const { tokens } = context;

  const render = (nodes: Array<Node | string>): string => nodes.map((node) => (typeof node === "string" ? node : renderNode(node))).join("");
  const inner = (node: Node) => (node.children ? render(node.children) : "");
  // Kept shortcodes travel as tokens, so they reach the Markdown exactly as written — with the
  // character references in rendered content (&#8221;) turned back into the characters they stand for.
  const keep = (node: Node): string => {
    unknown.push(node.tag.name);
    const open = tokens.inline(decodeTextEntities(node.tag.raw));

    return node.children ? `${open}${render(node.children)}${tokens.inline(node.closeRaw ?? `[/${node.tag.name}]`)}` : open;
  };

  function renderNode(node: Node): string {
    const { name, attrs, positional } = node.tag;
    const owner = builderOf(name);

    if (context.keepAll) return keep(node);
    if (owner) {
      builder ??= owner;
      return renderBuilder(node, owner);
    }
    switch (name) {
      case "caption":
      case "wp_caption": {
        // [caption]<a><img></a> The caption[/caption], or the older caption="…" attribute.
        // The HTML converter reads the image and the text around it from the figure.
        const caption = attrs.caption ? `<figcaption>${escapeHtml(attrs.caption)}</figcaption>` : "";

        return `<figure class="wp-caption">${inner(node)}${caption}</figure>`;
      }
      case "gallery": {
        const wanted = ids(attrs.ids ?? attrs.include);
        const images = wanted.length > 0 ? wanted.map((id) => context.mediaById(id)).filter((m): m is WordPressMedia => Boolean(m)) : context.attachments();

        if (images.length === 0) return keep(node);
        return `<figure class="wp-block-gallery">${images.map((image) => imageFigure(image.url, image.alt, image.caption)).join("")}</figure>`;
      }
      case "embed": {
        const url = (inner(node) || positional[0] || attrs.src || "").trim();

        if (!url) return keep(node);
        // Players and links become plain HTML; the HTML converter cleans, keeps and counts them like any other.
        return (videoEmbed(url) ?? linkEmbed(url)).html;
      }
      case "video": {
        const src = attrs.src ?? attrs.mp4 ?? attrs.m4v ?? attrs.webm ?? attrs.ogv ?? attrs.flv ?? "";

        if (!src) return keep(node);
        const hosted = videoEmbed(src);

        if (hosted) return hosted.html;
        const size = `${attrs.width ? ` width="${escapeAttribute(attrs.width)}"` : ""}${attrs.height ? ` height="${escapeAttribute(attrs.height)}"` : ""}`;
        const poster = attrs.poster ? ` poster="${escapeAttribute(attrs.poster)}"` : "";

        return `<video controls src="${escapeAttribute(src)}"${poster}${size}></video>`;
      }
      case "audio": {
        const src = attrs.src ?? attrs.mp3 ?? attrs.m4a ?? attrs.ogg ?? attrs.wav ?? "";

        if (!src) return keep(node);
        return `<audio controls src="${escapeAttribute(src)}"></audio>`;
      }
      case "code":
      case "sourcecode": {
        const language = (attrs.lang ?? attrs.language ?? positional[0] ?? "").replace(/[^\w+#-]/g, "");
        const code = (node.children ? node.children.map((child) => (typeof child === "string" ? child : child.tag.raw)).join("") : "").replace(/^\n+|\s+$/g, "");

        return `<pre><code${language ? ` class="language-${language}"` : ""}>${escapeHtml(decodeBasicEntities(code))}</code></pre>`;
      }
      default:
        return keep(node);
    }
  }

  function renderBuilder(node: Node, owner: BuilderName): string {
    const { name, attrs } = node.tag;
    const content = inner(node);
    const wrap = (role: string, body: string, extra = "") => `<div data-gwp-builder="${owner}" data-gwp-role="${role}" data-gwp-module="${name}"${extra}>${body}</div>`;
    const heading = (text: string | undefined, level = 2) => (text ? `<h${level}>${escapeHtml(diviText(text))}</h${level}>` : "");
    const button = (label: string | undefined, href: string | undefined) => (label ? `<a class="gwp-button" href="${escapeAttribute(href || "#")}">${escapeHtml(diviText(label))}</a>` : "");
    const image = (src: string | undefined, alt = "") => (src ? `<img src="${escapeAttribute(src)}" alt="${escapeAttribute(diviText(alt))}">` : "");
    const mediaImage = (id: string | undefined) => {
      const media = context.mediaById(Number(id));

      return media ? image(media.url, media.alt) : "";
    };

    switch (name) {
      // ── Divi
      case "et_pb_section":
      case "et_pb_fullwidth_section":
        return wrap("section", content);
      case "et_pb_row":
      case "et_pb_row_inner":
        return wrap("row", content);
      case "et_pb_column":
      case "et_pb_column_inner":
        return wrap("column", content, columnWidth(attrs.type));
      case "et_pb_text":
      case "et_pb_code":
        return wrap("module", content);
      case "et_pb_fullwidth_header":
        return wrap("module", `${heading(attrs.title, 1)}${attrs.subhead ? `<p>${escapeHtml(diviText(attrs.subhead))}</p>` : ""}${content}${button(attrs.button_one_text, attrs.button_one_url)}${button(attrs.button_two_text, attrs.button_two_url)}`);
      case "et_pb_blurb":
        return wrap("module", `<div class="gwp-card">${image(attrs.image, attrs.alt)}${attrs.font_icon ? `<i class="gwp-icon"></i>` : ""}${heading(attrs.title, 3)}${content}${attrs.url ? button("Learn more", attrs.url) : ""}</div>`);
      case "et_pb_button":
        return wrap("module", button(attrs.button_text, attrs.button_url));
      case "et_pb_image":
        return wrap("module", image(attrs.src, attrs.alt ?? attrs.title_text));
      case "et_pb_cta":
        return wrap("module", `${heading(attrs.title)}${content}${button(attrs.button_text, attrs.button_url)}`);
      case "et_pb_testimonial":
        return wrap("module", `<blockquote class="gwp-quote">${content}<cite>${escapeHtml(diviText(attrs.author))}${attrs.job_title ? `, ${escapeHtml(diviText(attrs.job_title))}` : ""}</cite></blockquote>`);
      case "et_pb_accordion":
      case "et_pb_tabs":
        return wrap("module", `<div class="gwp-faq">${content}</div>`);
      case "et_pb_accordion_item":
      case "et_pb_toggle":
      case "et_pb_tab":
        return `<details><summary>${escapeHtml(diviText(attrs.title))}</summary>${content}</details>`;
      case "et_pb_pricing_tables":
        return wrap("module", content);
      case "et_pb_pricing_table":
        // Divi lists features one per line, "+" for included and "-" for not; the outline reader splits them.
        return `<div class="gwp-price"${attrs.featured === "on" ? ' data-featured="1"' : ""}>${heading(attrs.title, 3)}<p class="gwp-amount">${escapeHtml(`${diviText(attrs.currency)}${diviText(attrs.sum)}`)}${attrs.per ? `<span class="gwp-period">${escapeHtml(diviText(attrs.per))}</span>` : ""}</p><div class="gwp-features">${content}</div>${button(attrs.button_text, attrs.button_url)}</div>`;
      case "et_pb_number_counter":
        return wrap("module", `<div class="gwp-counter"><span class="gwp-value">${escapeHtml(`${attrs.number ?? ""}${attrs.percent_sign === "on" ? "%" : ""}`)}</span><span class="gwp-label">${escapeHtml(diviText(attrs.title))}</span></div>`);
      case "et_pb_contact_form":
        return wrap("module", `<form data-gwp-form="${escapeAttribute(diviText(attrs.title))}">${content}</form>`);
      case "et_pb_contact_field":
        return `<label>${escapeHtml(diviText(attrs.field_title ?? attrs.field_id))}</label>`;
      case "et_pb_video":
        return wrap("module", (videoEmbed(attrs.src ?? "") ?? linkEmbed(attrs.src ?? "")).html);
      case "et_pb_gallery":
        return wrap("module", `<figure class="wp-block-gallery">${ids(attrs.gallery_ids).map((id) => context.mediaById(id)).filter((m): m is WordPressMedia => Boolean(m)).map((m) => imageFigure(m.url, m.alt, m.caption)).join("")}</figure>`);
      case "et_pb_divider":
        return "";
      // ── WPBakery
      case "vc_row":
      case "vc_section":
        return wrap("section", content);
      case "vc_row_inner":
        return wrap("row", content);
      case "vc_column":
      case "vc_column_inner":
        return wrap("column", content, columnWidth(attrs.width));
      case "vc_column_text":
      case "vc_message":
        return wrap("module", content);
      case "vc_custom_heading": {
        const level = Number(/tag:h(\d)/.exec(safeDecode(attrs.font_container ?? ""))?.[1] ?? 2);

        return wrap("module", heading(attrs.text, level));
      }
      case "vc_single_image":
        return wrap("module", mediaImage(attrs.image));
      case "vc_btn":
      case "vc_button":
      case "vc_button2": {
        const link = vcLink(attrs.link ?? attrs.href);

        return wrap("module", button(attrs.title ?? link.title, link.url || attrs.href));
      }
      case "vc_cta": {
        const link = vcLink(attrs.btn_link);

        return wrap("module", `${heading(attrs.h2)}${heading(attrs.h4, 4)}${content}${button(attrs.btn_title, link.url)}`);
      }
      case "vc_toggle":
      case "vc_tta_section":
        return `<details><summary>${escapeHtml(attrs.title ?? "")}</summary>${content}</details>`;
      case "vc_tta_accordion":
      case "vc_tta_tabs":
      case "vc_tta_tour":
        return wrap("module", `<div class="gwp-faq">${content}</div>`);
      case "vc_gallery":
      case "vc_images_carousel":
        return wrap("module", `<figure class="wp-block-gallery">${ids(attrs.images).map((id) => context.mediaById(id)).filter((m): m is WordPressMedia => Boolean(m)).map((m) => imageFigure(m.url, m.alt, m.caption)).join("")}</figure>`);
      case "vc_video":
        return wrap("module", (videoEmbed(attrs.link ?? "") ?? linkEmbed(attrs.link ?? "")).html);
      case "vc_raw_html": {
        // WPBakery stores raw HTML base64-encoded and URL-encoded.
        let decoded = content;

        try {
          decoded = safeDecode(Buffer.from(content.trim(), "base64").toString("utf8"));
        } catch {
          decoded = content;
        }
        return wrap("module", decoded);
      }
      case "vc_separator":
      case "vc_empty_space":
      case "vc_icon":
        return "";
      default:
        builderModules.push(name);
        return content ? wrap("module", content) : "";
    }
  }

  const out = render(parse(html));

  return { html: out, unknown, embeds, builderModules, ...(builder ? { builder } : {}) };
}

/** Character references, except the ones that would turn text into markup (&lt; &gt;). */
function decodeTextEntities(text: string): string {
  return text
    .replace(/&#(\d+);/g, (match, code: string) => (code === "60" || code === "62" ? match : String.fromCodePoint(Number(code))))
    .replace(/&#x([0-9a-f]+);/gi, (match, code: string) => (/^(3c|3e)$/i.test(code) ? match : String.fromCodePoint(parseInt(code, 16))))
    .replace(/&quot;/g, '"')
    .replace(/&(amp|#038);/g, "&")
    .replace(/&nbsp;/g, "\u00a0");
}

function decodeBasicEntities(text: string): string {
  return text.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").replace(/&amp;/g, "&");
}

/** Every distinct shortcode name in a piece of content (for the "uses a builder" check before conversion). */
export function shortcodeNames(html: string): string[] {
  return [...new Set(tokenize(html).filter((tag) => !tag.closing && !tag.escaped).map((tag) => tag.name))];
}
