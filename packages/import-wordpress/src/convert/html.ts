/**
 * WordPress HTML → the Markdown a person would have written.
 *
 * Library choice: Turndown (≈190 kB, the most widely used HTML-to-Markdown
 * converter, rule-based and easy to extend) over domino, the WHATWG HTML
 * parser Turndown itself depends on in Node (no extra install). The content
 * is parsed into a real DOM, reshaped there (WordPress's figures, galleries,
 * embeds, buttons and lazy-loaded images become plain elements), and only
 * then handed to Turndown with a few rules of our own: two-space-free list
 * markers, GitHub tables, image captions, and raw HTML for what Markdown
 * can't say.
 *
 * Embeds are never dropped. Iframes, video and audio are cleaned (only the
 * attributes that make them work survive) and kept as raw HTML, which
 * Markdown allows; every one is counted for the report.
 */
import TurndownService from "turndown";
import type { BuilderName, WordPressMedia } from "../types";
import { collapse, COMMENT, elements, ELEMENT, hasClass, parseFragment, TEXT, textOf, unwrap, type DomElement, type DomNode } from "./dom";
import { escapeAttribute, escapeHtml, linkEmbed, videoEmbed } from "./embeds";
import { prepareRaw } from "./raw";
import { processShortcodes } from "./shortcodes";
import { Tokens } from "./tokens";

export interface ConvertContext {
  /** The old site's home URL, no trailing slash. */
  siteUrl: string;
  form: "rendered" | "raw";
  reusable?: Record<number, string>;
  mediaById?(id: number): WordPressMedia | undefined;
  attachments?(): WordPressMedia[];
  /**
   * The new address for a link into the old site: a path when the target was
   * imported, null when it wasn't. Absent: links are left as they are.
   */
  resolveLink?(url: string): string | null;
  /** The target collection is MDX: comments and braces need its syntax. */
  mdx?: boolean;
  /** Share one token table when several fragments end up in one document. */
  tokens?: Tokens;
}

export interface ConvertResult {
  markdown: string;
  /** The text before `<!--more-->`, as Markdown. */
  teaser?: string;
  embeds: number;
  embedProviders: string[];
  /** Media on the old site the content shows (images, video, posters), as written in the Markdown. */
  media: Array<{ url: string; alt: string }>;
  /** Files on the old site the content links to (PDFs and the like). */
  files: string[];
  /** Links into the old site whose target was not imported (left absolute). */
  unresolvedLinks: string[];
  /** Shortcodes left in place, one entry per use. */
  shortcodes: string[];
  builder?: BuilderName;
  builderModules: string[];
  dynamicBlocks: string[];
  missingReusable: number[];
  forms: number;
  scriptsRemoved: number;
}

/** Where WordPress keeps uploads: /wp-content/uploads/, or /files/YYYY/MM/ on older multisite installs. */
export const UPLOADS = /\/wp-content\/uploads\/|\/files\/\d{4}\/\d{2}\/|\/wp-content\/blogs\.dir\//;
const FILE_EXTENSIONS = /\.(pdf|docx?|xlsx?|pptx?|zip|mp3|m4a|wav|ogg|mp4|m4v|mov|webm|csv|txt|epub|key|odt|ods)$/i;
const IMAGE_EXTENSIONS = /\.(jpe?g|png|gif|webp|avif|svg|bmp|tiff?|heic)$/i;
const VIDEO_ATTRIBUTES = ["src", "poster", "width", "height", "controls", "preload", "loop", "muted", "playsinline", "autoplay"];
const IFRAME_ATTRIBUTES = ["src", "width", "height", "title", "allow", "allowfullscreen", "loading", "referrerpolicy", "frameborder", "sandbox"];

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return "";
  }
}

/** Absolute URL for an href/src written on a page of the old site. */
export function absolutize(value: string, siteUrl: string): string {
  try {
    return new URL(value.trim(), `${siteUrl}/`).toString();
  } catch {
    return value.trim();
  }
}

/** Whether a URL is the old site's own (its host, or a WordPress image CDN in front of it). */
export function isOwnUrl(url: string, siteUrl: string): boolean {
  const host = hostOf(url);
  const site = hostOf(siteUrl);

  if (!host) return false;
  if (host === site) return true;
  // Jetpack's image CDN serves https://i0.wp.com/<site>/wp-content/…
  if (/^i\d\.wp\.com$/.test(host)) {
    try {
      return new URL(url).pathname.replace(/^\//, "").toLowerCase().startsWith(site);
    } catch {
      return false;
    }
  }
  return false;
}

function cleanAttributes(element: DomElement, allowed: string[]): void {
  for (const { name } of Array.from(element.attributes)) {
    if (!allowed.includes(name.toLowerCase())) element.removeAttribute(name);
  }
}

/** The HTML of a media element with only the attributes that make it work. */
function cleanMedia(element: DomElement, siteUrl: string, onMedia: (url: string) => void): string {
  const clone = element.cloneNode(true) as DomElement;
  const allowed = clone.nodeName === "IFRAME" ? IFRAME_ATTRIBUTES : VIDEO_ATTRIBUTES;

  // Lazy-loading plugins park the real address in data-src.
  const lazy = clone.getAttribute("data-src") ?? clone.getAttribute("data-lazy-src");

  if (lazy && (!clone.getAttribute("src") || clone.getAttribute("src")!.startsWith("data:") || clone.getAttribute("src") === "about:blank")) clone.setAttribute("src", lazy);
  cleanAttributes(clone, allowed);
  for (const name of ["src", "poster"]) {
    const value = clone.getAttribute(name);

    if (!value) continue;
    const absolute = absolutize(value, siteUrl);

    clone.setAttribute(name, absolute);
    if (clone.nodeName !== "IFRAME" && isOwnUrl(absolute, siteUrl)) onMedia(absolute);
  }
  for (const child of elements(clone.querySelectorAll("*"))) {
    if (child.nodeName !== "SOURCE" && child.nodeName !== "TRACK") {
      child.remove();
      continue;
    }
    cleanAttributes(child, ["src", "type", "kind", "srclang", "label"]);
    const src = child.getAttribute("src");

    if (src) {
      const absolute = absolutize(src, siteUrl);

      child.setAttribute("src", absolute);
      if (isOwnUrl(absolute, siteUrl)) onMedia(absolute);
    }
  }
  // Fallback text inside <video> ("Your browser does not support…") is noise in Markdown.
  for (const node of Array.from(clone.childNodes)) if (node.nodeType === TEXT) clone.removeChild(node);
  return clone.outerHTML.replace(/=""/g, "");
}

function languageOf(pre: DomElement): string {
  const code = pre.querySelector("code");
  const classes = `${pre.getAttribute("class") ?? ""} ${code?.getAttribute("class") ?? ""} ${pre.getAttribute("data-language") ?? ""}`;
  const match =
    /(?:^|\s)(?:language|lang)-([\w+#-]+)/.exec(classes) ?? /brush:\s*([\w+#-]+)/.exec(classes) ?? /(?:^|\s)data-language-([\w+#-]+)/.exec(classes);

  if (match) return match[1]!.toLowerCase();
  const data = pre.getAttribute("data-language") ?? code?.getAttribute("data-lang") ?? "";

  return /^[\w+#-]+$/.test(data) ? data.toLowerCase() : "";
}

function paragraph(doc: DomElement["ownerDocument"], children: DomNode[]): DomElement {
  const p = doc.createElement("p");

  for (const child of children) p.appendChild(child);
  return p;
}

function captionParagraph(doc: DomElement["ownerDocument"], caption: string): DomElement | null {
  if (!caption) return null;
  const p = doc.createElement("p");
  const em = doc.createElement("em");

  em.appendChild(doc.createTextNode(caption));
  p.appendChild(em);
  return p;
}

export function emptyResult(): ConvertResult {
  return {
    markdown: "",
    embeds: 0,
    embedProviders: [],
    media: [],
    files: [],
    unresolvedLinks: [],
    shortcodes: [],
    builderModules: [],
    dynamicBlocks: [],
    missingReusable: [],
    forms: 0,
    scriptsRemoved: 0,
  };
}

/** Adds what one conversion found to another's tally (the Markdown itself is not merged). */
export function mergeResult(into: ConvertResult, from: ConvertResult): void {
  into.embeds += from.embeds;
  into.embedProviders.push(...from.embedProviders);
  into.media.push(...from.media);
  into.files.push(...from.files);
  into.unresolvedLinks.push(...from.unresolvedLinks);
  into.shortcodes.push(...from.shortcodes);
  into.builderModules.push(...from.builderModules);
  into.dynamicBlocks.push(...from.dynamicBlocks);
  into.missingReusable.push(...from.missingReusable);
  into.forms += from.forms;
  into.scriptsRemoved += from.scriptsRemoved;
  if (from.builder && !into.builder) into.builder = from.builder;
}

export interface Prepared {
  /** HTML as WordPress would show it, with shortcodes expanded or held as tokens. */
  html: string;
  result: ConvertResult;
  tokens: Tokens;
  /** Shortcodes are still to be found, in text only (see prepareHtml). */
  scanText: boolean;
}

/** The text-level steps: block comments, paragraphs and shortcodes. */
export function prepareHtml(input: string, context: ConvertContext): Prepared {
  const tokens = context.tokens ?? new Tokens();
  const result = emptyResult();
  let html = input ?? "";

  if (context.form === "raw") {
    const raw = prepareRaw(html, context.reusable ?? {});

    html = raw.html;
    result.dynamicBlocks = raw.dynamicBlocks;
    result.missingReusable = raw.missingReusable;
    if (raw.teaser) result.teaser = convertHtml(raw.teaser, { ...context, form: "rendered", tokens }).markdown;
  }
  // Raw content holds shortcodes that wrap HTML, so they are expanded on the text. Rendered content
  // has already been through WordPress: what's left is unknown, and only matters where a reader sees
  // it — in text, not inside attributes, styles or scripts (real pages carry "[data-col]" selectors) —
  // unless a page builder's layout was left unrendered (its plugin switched off).
  if (context.form === "rendered" && !/\[(et_pb_|vc_row|vc_section|fl_builder)/.test(html)) return { html, result, tokens, scanText: true };
  const shortcodes = processShortcodes(html, {
    tokens,
    mediaById: (id) => context.mediaById?.(id),
    attachments: () => context.attachments?.() ?? [],
  });

  result.shortcodes = shortcodes.unknown;
  result.embeds += shortcodes.embeds;
  result.builderModules = shortcodes.builderModules;
  if (shortcodes.builder) result.builder = shortcodes.builder;
  return { html: shortcodes.html, result, tokens, scanText: false };
}

/** The structural steps: parse, reshape, Turndown, tidy. */
export function convertPrepared(prepared: Prepared, context: ConvertContext): ConvertResult {
  const { tokens, result } = prepared;
  const root = parseFragment(prepared.html);

  reshape(root, context, tokens, result, prepared.scanText);
  const markdown = turndown().turndown(root as unknown as TurndownService.Node);

  result.markdown = finish(markdown, tokens, context);
  if (result.teaser) result.teaser = finish(result.teaser, tokens, context);
  result.media = dedupeBy(result.media, (item) => item.url);
  result.files = [...new Set(result.files)];
  result.unresolvedLinks = [...new Set(result.unresolvedLinks)];
  return result;
}

export function convertHtml(input: string, context: ConvertContext): ConvertResult {
  return convertPrepared(prepareHtml(input, context), context);
}

/** Final Markdown tidy, exported for bodies assembled from an outline. */
export function finishMarkdown(markdown: string, tokens: Tokens, context: Pick<ConvertContext, "mdx">): string {
  return finish(markdown, tokens, context as ConvertContext);
}

function dedupeBy<T>(items: T[], key: (item: T) => string): T[] {
  const seen = new Set<string>();

  return items.filter((item) => {
    const k = key(item);

    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

/** Rewrites the DOM in place so Turndown sees plain, meaningful elements. */
function reshape(root: DomElement, context: ConvertContext, tokens: Tokens, result: ConvertResult, scanText = false): void {
  const doc = root.ownerDocument;
  const { siteUrl } = context;
  const addMedia = (url: string, alt = "") => result.media.push({ url, alt });
  /** A paragraph holding a token for raw HTML, built in this document (nodes can't move between documents). */
  const tokenParagraph = (html: string) => paragraph(doc, [doc.createTextNode(tokens.inline(`\n\n${html.trim()}\n\n`))]);
  const keepBlock = (element: DomElement, html: string) => {
    element.replaceWith(tokenParagraph(html));
  };
  const countEmbed = (provider: string) => {
    result.embeds += 1;
    result.embedProviders.push(provider);
  };

  // Comments: our own markers become visible-in-Proof notes; WordPress's are dropped.
  const walker = (node: DomNode) => {
    for (const child of Array.from(node.childNodes)) {
      if (child.nodeType === COMMENT) {
        const text = (child.textContent ?? "").trim();
        const dynamic = /^gwp:dynamic (.+)$/.exec(text);
        const missing = /^gwp:missing-reusable (\d+)$/.exec(text);
        const note = dynamic
          ? `The old site generated a “${dynamic[1]}” block here when the page was shown. It has no content of its own to bring across.`
          : missing
            ? `A reusable block (number ${missing[1]}) was here, but it wasn't in the export.`
            : null;

        if (note) {
          (node as DomElement).replaceChild(tokenParagraph(`<!-- ${note} -->`), child);
        } else {
          (node as DomElement).removeChild(child);
        }
      } else if (child.nodeType === ELEMENT) {
        walker(child);
      }
    }
  };

  walker(root);

  for (const element of elements(root.querySelectorAll("script, style, noscript, link, meta, template"))) {
    if (element.nodeName === "SCRIPT") result.scriptsRemoved += 1;
    element.remove();
  }

  // Content that is never shown — glossary tooltips, hidden duplicates — would read as part of the text.
  for (const element of elements(root.querySelectorAll("[hidden], [style*='display:none'], [style*='display: none'], [class*='hidden-content'], [class*='tooltip-content'], .elementor-hidden, .screen-reader-response"))) element.remove();
  if (scanText) keepTextShortcodes(root, tokens, result);

  // Forms can't post anywhere on a static site; leave a note where each was.
  for (const form of elements(root.querySelectorAll("form"))) {
    if (form.closest("form") !== form) continue;
    result.forms += 1;
    const name = form.getAttribute("data-gwp-form") || form.getAttribute("aria-label") || form.getAttribute("name") || "";
    const note = `A form${name ? ` (“${name.replace(/--/g, "–")}”)` : ""} was here. A static site needs a form service to receive it — see the import report.`;
    const wrapper = form.closest(".wpcf7, .wpforms-container, .gform_wrapper, .nf-form-cont, .elementor-form") ?? form;

    keepBlock(wrapper, `<!-- ${note} -->`);
  }

  // Lazy-loaded images, srcset, linked full-size images.
  for (const img of elements(root.querySelectorAll("img"))) {
    const lazy = img.getAttribute("data-lazy-src") ?? img.getAttribute("data-src") ?? img.getAttribute("data-orig-file");
    const src = img.getAttribute("src") ?? "";

    if (lazy && (!src || src.startsWith("data:"))) img.setAttribute("src", lazy);
    const finalSrc = img.getAttribute("src");

    if (!finalSrc || finalSrc.startsWith("data:")) {
      img.remove();
      continue;
    }
    const absolute = absolutize(finalSrc, siteUrl);

    img.setAttribute("src", absolute);
    if (isOwnUrl(absolute, siteUrl) || UPLOADS.test(absolute)) addMedia(absolute, img.getAttribute("alt") ?? "");
    // Emoji images WordPress substitutes for characters go back to being characters.
    if (hasClass(img, /^(wp-smiley|emoji)$/)) img.replaceWith(doc.createTextNode(img.getAttribute("alt") ?? ""));
  }

  // Iframes, video and audio: kept as clean HTML.
  for (const element of elements(root.querySelectorAll("iframe, video, audio"))) {
    if (!element.parentNode) continue;
    const src = element.getAttribute("src") ?? element.getAttribute("data-src") ?? element.querySelector("source")?.getAttribute("src") ?? "";
    const provider = element.nodeName === "IFRAME" ? hostOf(absolutize(src, siteUrl)) || "an embedded frame" : element.nodeName === "VIDEO" ? "a video file" : "an audio file";

    countEmbed(provider);
    const clean = cleanMedia(element, siteUrl, (url) => addMedia(url));
    // WordPress wraps players in figures and divs; replace the outermost wrapper that holds nothing else.
    let target: DomElement = element;

    while (
      target.parentNode &&
      target.parentNode !== root &&
      /^(DIV|FIGURE|SPAN|P)$/.test(target.parentNode.nodeName) &&
      collapse(target.parentNode.textContent ?? "") === collapse(target.textContent ?? "") &&
      target.parentNode.querySelectorAll("iframe, video, audio, img").length === 1 &&
      !target.parentNode.querySelector("figcaption")
    ) {
      target = target.parentNode;
    }
    const caption = target.parentNode && target.parentNode.nodeName === "FIGURE" ? target.parentNode.querySelector("figcaption") : null;

    keepBlock(target, clean);
    if (caption) {
      const p = captionParagraph(doc, textOf(caption));

      caption.replaceWith(p ?? doc.createTextNode(""));
    }
  }

  // Embed blocks whose player wasn't rendered (an export file holds only the URL).
  for (const figure of elements(root.querySelectorAll("figure.wp-block-embed, .wp-block-embed"))) {
    if (!figure.parentNode) continue;
    const wrapper = figure.querySelector(".wp-block-embed__wrapper") ?? figure;
    const url = collapse(wrapper.textContent ?? "");

    if (!/^https?:\/\/\S+$/.test(url)) continue;
    const caption = textOf(figure.querySelector("figcaption"));
    const video = videoEmbed(url, caption || undefined);
    const embed = video ?? linkEmbed(url);

    countEmbed(embed.provider);
    let holder: DomElement;

    if (video) {
      holder = tokenParagraph(video.html);
    } else {
      // Not a player: keep it as a plain link.
      const link = doc.createElement("a");

      link.setAttribute("href", url);
      link.appendChild(doc.createTextNode(url));
      holder = paragraph(doc, [link]);
    }
    const captionP = captionParagraph(doc, caption);

    figure.replaceWith(holder);
    if (captionP) holder.parentNode?.insertBefore(captionP, holder.nextSibling);
  }

  // Twitter, Instagram, TikTok: the script that turned them into cards is gone; the quote and link stay.
  for (const quote of elements(root.querySelectorAll("blockquote.twitter-tweet, blockquote.instagram-media, blockquote.tiktok-embed, blockquote.wp-embedded-content"))) {
    countEmbed(quote.className.split(/\s+/)[0] ?? "an embedded post");
    const clone = quote.cloneNode(true) as DomElement;

    for (const element of [clone, ...elements(clone.querySelectorAll("*"))]) cleanAttributes(element, element.nodeName === "A" ? ["href"] : element === clone ? ["class", "cite"] : []);
    keepBlock(quote, clone.outerHTML);
  }

  // A video link on its own line is an embed in a classic post.
  if (context.form === "raw") {
    for (const p of elements(root.querySelectorAll("p"))) {
      const text = collapse(p.textContent ?? "");

      if (p.children.length > 1 || !/^https?:\/\/\S+$/.test(text)) continue;
      if (p.children.length === 1 && p.firstElementChild!.nodeName !== "A") continue;
      const embed = videoEmbed(text);

      if (!embed) continue;
      countEmbed(embed.provider);
      keepBlock(p, embed.html);
    }
  }

  // Galleries: block galleries, classic [gallery] output, Jetpack tiled galleries.
  for (const gallery of elements(root.querySelectorAll("figure.wp-block-gallery, .wp-block-gallery, div.gallery, .tiled-gallery"))) {
    if (!gallery.parentNode) continue;
    const parts: DomElement[] = [];

    for (const img of elements(gallery.querySelectorAll("img"))) {
      const item = img.closest("figure, .gallery-item, .tiled-gallery-item, li") ?? img;
      const caption = textOf(item.querySelector("figcaption, .wp-caption-text, .gallery-caption, .tiled-gallery-caption"));
      const clone = img.cloneNode(true) as DomElement;

      parts.push(paragraph(doc, [clone]));
      const captionP = captionParagraph(doc, caption);

      if (captionP) parts.push(captionP);
    }
    const galleryCaption = elements(gallery.children).find((child) => child.nodeName === "FIGCAPTION");
    const captionP = captionParagraph(doc, textOf(galleryCaption));

    if (captionP) parts.push(captionP);
    const fragment = doc.createElement("div");

    for (const part of parts) fragment.appendChild(part);
    gallery.replaceWith(fragment);
  }

  // Image figures and classic captions → image, then the caption in italics beneath.
  for (const figure of elements(root.querySelectorAll("figure, div.wp-caption"))) {
    if (!figure.parentNode) continue;
    if (figure.querySelector("table")) {
      const caption = figure.querySelector("figcaption");
      const captionP = caption ? captionParagraph(doc, textOf(caption)) : null;

      caption?.remove();
      if (captionP) figure.appendChild(captionP);
      unwrap(figure);
      continue;
    }
    if (figure.querySelector("blockquote")) {
      unwrap(figure);
      continue;
    }
    const img = figure.querySelector("img");

    if (!img) {
      unwrap(figure);
      continue;
    }
    const captionElement = figure.querySelector("figcaption, .wp-caption-text");
    let caption = textOf(captionElement);

    captionElement?.remove();
    const anchor = img.closest("a");
    const media = anchor && anchor.closest("figure, div.wp-caption") === figure ? anchor : img;

    if (!caption) {
      // [caption] shortcode content: the image, then the caption as plain text.
      const clone = figure.cloneNode(true) as DomElement;

      for (const element of elements(clone.querySelectorAll("img, a"))) element.remove();
      caption = textOf(clone);
    }
    const parts = [paragraph(doc, [media.cloneNode(true)])];
    const captionP = captionParagraph(doc, caption);

    if (captionP) parts.push(captionP);
    const fragment = doc.createElement("div");

    for (const part of parts) fragment.appendChild(part);
    figure.replaceWith(fragment);
  }

  // Cover blocks: the background image, then what sat on top of it.
  for (const cover of elements(root.querySelectorAll(".wp-block-cover"))) {
    const background = cover.querySelector("img.wp-block-cover__image-background");

    if (background) cover.parentNode?.insertBefore(paragraph(doc, [background]), cover);
    unwrap(cover);
  }

  // Buttons: one link per paragraph.
  for (const link of elements(root.querySelectorAll("a.wp-block-button__link, a.wp-element-button, a.button, a.btn, a.gwp-button, a.elementor-button"))) {
    const label = textOf(link);

    if (!label) continue;
    const clean = doc.createElement("a");

    clean.setAttribute("href", link.getAttribute("href") ?? "#");
    clean.appendChild(doc.createTextNode(label));
    const holder = link.closest(".wp-block-button") ?? link;

    holder.replaceWith(paragraph(doc, [clean]));
  }

  // <details> has no Markdown form: keep it as HTML, cleaned.
  for (const details of elements(root.querySelectorAll("details"))) {
    if (!details.parentNode || details.parentNode.closest?.("details")) continue;
    const clone = details.cloneNode(true) as DomElement;

    for (const element of [clone, ...elements(clone.querySelectorAll("*"))]) cleanAttributes(element, element.nodeName === "A" ? ["href"] : element.nodeName === "IMG" ? ["src", "alt"] : []);
    keepBlock(details, clone.outerHTML);
  }

  // Code: make sure every <pre> holds a <code> carrying its language.
  for (const pre of elements(root.querySelectorAll("pre"))) {
    const language = languageOf(pre);
    const text = pre.textContent ?? "";

    while (pre.childNodes.length > 0) pre.removeChild(pre.childNodes[0]!);
    const code = doc.createElement("code");

    if (language) code.setAttribute("class", `language-${language}`);
    code.appendChild(doc.createTextNode(text.replace(/^\n/, "").replace(/\s+$/, "")));
    pre.appendChild(code);
  }

  // Blockquote citations: "— Name" on its own line, as people write it.
  for (const cite of elements(root.querySelectorAll("blockquote cite, blockquote footer"))) {
    const text = textOf(cite);

    cite.replaceWith(text ? paragraph(doc, [doc.createTextNode(`— ${text.replace(/^[—–-]\s*/, "")}`)]) : doc.createTextNode(""));
  }

  // Links: into the old site → the new address when imported; files → downloaded.
  for (const link of elements(root.querySelectorAll("a[href]"))) {
    const href = link.getAttribute("href") ?? "";

    if (!href || href.startsWith("#") || /^(mailto|tel|sms|javascript):/i.test(href)) {
      if (/^javascript:/i.test(href)) link.removeAttribute("href");
      continue;
    }
    // A link with nothing to click on (an icon-only logo link) would become "[](…)": name it, or drop it.
    if (!collapse(link.textContent ?? "") && !link.querySelector("img")) {
      const name = link.getAttribute("aria-label") || link.getAttribute("title") || link.querySelector("title")?.textContent || "";

      if (name.trim()) {
        while (link.childNodes.length) link.removeChild(link.childNodes[0]!);
        link.appendChild(doc.createTextNode(name.trim()));
      } else {
        link.remove();
        continue;
      }
    }
    const absolute = absolutize(href, siteUrl);

    if (!isOwnUrl(absolute, siteUrl) && !(UPLOADS.test(absolute) && !/^https?:/i.test(href))) {
      if (!/^https?:/i.test(href)) link.setAttribute("href", absolute);
      continue;
    }
    const path = new URL(absolute).pathname;
    const onlyImage = link.children.length === 1 && link.firstElementChild!.nodeName === "IMG" && collapse(link.textContent ?? "") === "";

    if (UPLOADS.test(path) && IMAGE_EXTENSIONS.test(path)) {
      // A thumbnail linking to its own full-size file: the image is enough.
      if (onlyImage) {
        unwrap(link);
        continue;
      }
      addMedia(absolute);
      link.setAttribute("href", absolute);
      continue;
    }
    if (UPLOADS.test(path) && FILE_EXTENSIONS.test(path)) {
      result.files.push(absolute);
      link.setAttribute("href", absolute);
      continue;
    }
    // Attachment pages are WordPress's own wrapper around one image.
    if (onlyImage && (/[?&]attachment_id=/.test(absolute) || /\/attachment\//.test(path))) {
      unwrap(link);
      continue;
    }
    const resolved = context.resolveLink?.(absolute);

    if (resolved) {
      link.setAttribute("href", resolved);
    } else {
      link.setAttribute("href", absolute);
      if (context.resolveLink) result.unresolvedLinks.push(absolute);
    }
  }

  // Inline-only wrappers WordPress and editors leave behind.
  for (const span of elements(root.querySelectorAll("span, font"))) unwrap(span);
}

/** Shortcodes left in rendered text: kept exactly, counted for the report. */
function keepTextShortcodes(root: DomElement, tokens: Tokens, result: ConvertResult): void {
  const visit = (node: DomNode) => {
    for (const child of Array.from(node.childNodes)) {
      if (child.nodeType === ELEMENT) {
        if (!/^(PRE|CODE|TEXTAREA|KBD|SAMP)$/.test(child.nodeName)) visit(child);
      } else if (child.nodeType === TEXT && (child.textContent ?? "").includes("[")) {
        const found = processShortcodes(child.textContent ?? "", { tokens, keepAll: true, mediaById: () => undefined, attachments: () => [] });

        if (found.unknown.length) {
          result.shortcodes.push(...found.unknown);
          child.textContent = found.html;
        }
      }
    }
  };

  visit(root);
}

function turndown(): TurndownService {
  const service = new TurndownService({
    headingStyle: "atx",
    hr: "---",
    bulletListMarker: "-",
    codeBlockStyle: "fenced",
    emDelimiter: "*",
    strongDelimiter: "**",
    linkStyle: "inlined",
    br: "\\",
  });

  service.keep(["sup", "sub", "kbd", "mark", "abbr"] as unknown as TurndownService.Filter);

  // "- item", not Turndown's "-   item": the way people type lists.
  service.addRule("listItem", {
    filter: "li",
    replacement(content, node) {
      const element = node as unknown as DomElement;
      const parent = element.parentNode as DomElement | null;
      let prefix = "- ";

      if (parent?.nodeName === "OL") {
        const start = Number(parent.getAttribute("start") ?? "1") || 1;
        const index = elements(parent.children).indexOf(element);

        prefix = `${start + index}. `;
      }
      const indent = " ".repeat(prefix.length);
      const body = content
        .replace(/^\n+/, "")
        .replace(/\n+$/, "\n")
        .replace(/\n/gm, `\n${indent}`)
        .replace(new RegExp(`\\n${indent}$`), "\n");

      return prefix + body + (element.nextSibling && !/\n$/.test(body) ? "\n" : "");
    },
  });

  service.addRule("image", {
    filter: "img",
    replacement(_content, node) {
      const img = node as unknown as DomElement;
      const src = img.getAttribute("src") ?? "";

      if (!src) return "";
      const alt = (img.getAttribute("alt") ?? "").replace(/[\[\]\\]/g, "\\$&").replace(/\s+/g, " ").trim();
      const title = img.getAttribute("title");
      const target = /[\s()]/.test(src) ? `<${src}>` : src;

      return `![${alt}](${target}${title ? ` "${title.replace(/"/g, '\\"')}"` : ""})`;
    },
  });

  // A link whose text is its own address is written the short way: <https://…>.
  service.addRule("autolink", {
    filter: (node) => node.nodeName === "A" && Boolean(node.getAttribute("href")) && node.textContent === node.getAttribute("href") && /^https?:\/\//.test(node.getAttribute("href") ?? ""),
    replacement: (_content, node) => `<${(node as unknown as DomElement).getAttribute("href")}>`,
  });

  service.addRule("strikethrough", {
    filter: ["del", "s", "strike"] as unknown as TurndownService.Filter,
    replacement: (content) => (content.trim() ? `~~${content}~~` : ""),
  });

  // GitHub tables when the table is simple enough to be one; clean HTML otherwise.
  service.addRule("table", {
    filter: "table",
    replacement(_content, node) {
      const table = node as unknown as DomElement;
      const rows = elements(table.querySelectorAll("tr")).filter((row) => row.closest("table") === table);
      const complex =
        rows.length === 0 ||
        Boolean(table.querySelector("table, ul, ol, pre, blockquote, img, iframe")) ||
        elements(table.querySelectorAll("td, th")).some((cell) => (Number(cell.getAttribute("colspan") ?? 1) > 1 || Number(cell.getAttribute("rowspan") ?? 1) > 1));

      if (complex) {
        const clone = table.cloneNode(true) as DomElement;

        for (const element of [clone, ...elements(clone.querySelectorAll("*"))]) cleanAttributes(element, element.nodeName === "A" ? ["href"] : element.nodeName === "IMG" ? ["src", "alt"] : ["colspan", "rowspan"]);
        return `\n\n${clone.outerHTML}\n\n`;
      }
      const cellText = (cell: DomElement) =>
        service
          .turndown(cell.innerHTML || "")
          .replace(/\n+/g, " <br> ")
          .replace(/\|/g, "\\|")
          .trim();
      const matrix = rows.map((row) => elements(row.children).filter((cell) => cell.nodeName === "TD" || cell.nodeName === "TH").map(cellText));
      const width = Math.max(...matrix.map((row) => row.length));
      const line = (cells: string[]) => `| ${Array.from({ length: width }, (_, i) => cells[i] ?? "").join(" | ")} |`;
      const [header = [], ...body] = matrix;

      return `\n\n${[line(header), line(Array.from({ length: width }, () => "---")), ...body.map(line)].join("\n")}\n\n`;
    },
  });

  service.addRule("caption", { filter: "caption" as unknown as TurndownService.Filter, replacement: () => "" });

  // A <pre> whose language came from WordPress's own classes.
  service.addRule("fencedCode", {
    filter: (node) => node.nodeName === "PRE" && node.firstChild?.nodeName === "CODE",
    replacement(_content, node) {
      const code = (node as unknown as DomElement).firstElementChild!;
      const language = /language-([\w+#-]+)/.exec(code.getAttribute("class") ?? "")?.[1] ?? "";
      const text = code.textContent ?? "";
      const longest = Math.max(2, ...Array.from(text.matchAll(/`+/g), (match) => match[0].length));
      const fence = "`".repeat(longest + 1);

      return `\n\n${fence}${language}\n${text.replace(/\n$/, "")}\n${fence}\n\n`;
    },
  });

  return service;
}

function finish(markdown: string, tokens: Tokens, context: ConvertContext): string {
  let text = markdown;

  if (context.mdx) text = escapeForMdx(text);
  text = tokens.restore(text);
  if (context.mdx) text = text.replace(/<!--([\s\S]*?)-->/g, (_m, inner: string) => `{/*${inner.replace(/\*\//g, "* /")}*/}`).replace(/<(img|br|hr|source|track)\b([^>]*?)\s*\/?>/g, "<$1$2 />");
  return text
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/^\n+|\s+$/g, "");
}

/** MDX reads `{` and `<` in prose as code. Escape them outside fenced code. */
function escapeForMdx(text: string): string {
  let fenced = false;

  return text
    .split("\n")
    .map((line) => {
      if (/^\s*(```|~~~)/.test(line)) {
        fenced = !fenced;
        return line;
      }
      if (fenced) return line;
      return line.replace(/(?<!\\)([{}])/g, "\\$1").replace(/<(?=[A-Za-z/!])/g, "\\<");
    })
    .join("\n");
}

/** A short plain-text summary from Markdown: the opening sentences, never cut mid-word. */
export function summarize(markdown: string, max = 160): string {
  const paragraphs = markdown
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter((block) => block && !/^(#|!\[|<|```|>|\||-\s|\d+\.\s|\*[^*]+\*$|\{\/\*)/.test(block));
  const first = paragraphs[0];

  if (!first) return "";
  const plain = collapse(
    first
      .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
      .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
      .replace(/[*_`~]|\\(?=.)/g, "")
  );

  if (plain.length <= max) return plain;
  // Sentences end at . ! ? followed by a space and a capital — so "WordPress.com" or "3.5 kg" never split one.
  const sentences = plain.split(/(?<=[.!?…][”’"')]?)\s+(?=[\p{Lu}\p{N}“‘"'(])/u);
  let out = "";

  for (const sentence of sentences) {
    if (`${out} ${sentence}`.trim().length > max) break;
    out = `${out} ${sentence}`.trim();
  }
  if (out) return out;
  const cut = plain.slice(0, max - 1);

  return `${cut.slice(0, cut.lastIndexOf(" ") > 40 ? cut.lastIndexOf(" ") : cut.length).replace(/[\s,;:]+$/, "")}…`;
}

export { escapeAttribute, escapeHtml };
