/**
 * One WordPress item → Markdown body (+ outline for page-builder pages).
 *
 * Ordinary posts and pages go straight through the HTML converter. A page a
 * builder made is first read into its outline (convert/builders), and its
 * body is rendered *from* the outline — the safe import and the rebuild brief
 * then describe the same content in the same order, with the builder's
 * wrapper markup gone.
 */
import type { BuilderName, OutlineItem, PageOutline, WordPressItem, WordPressMedia, WordPressSite } from "../types";
import { elementorOutlineFromData, elementorOutlineFromHtml } from "./builders/elementor";
import { builderOfHtml, builderOutlineFromHtml } from "./builders/generic";
import { absolutize, convertHtml, convertPrepared, emptyResult, finishMarkdown, isOwnUrl, mergeResult, prepareHtml, UPLOADS, type ConvertContext, type ConvertResult } from "./html";
import { sectionsToMarkdown } from "./outline";
import { Tokens } from "./tokens";

export interface ItemConversion extends ConvertResult {
  outline?: PageOutline;
}

export interface ItemContext {
  resolveLink?(url: string): string | null;
  mdx?: boolean;
}

export function mediaIndex(site: WordPressSite) {
  const byId = new Map<number, WordPressMedia>();
  const byParent = new Map<number, WordPressMedia[]>();

  for (const media of site.media) {
    byId.set(media.id, media);
    if (media.parentId && media.mime.startsWith("image/")) byParent.set(media.parentId, [...(byParent.get(media.parentId) ?? []), media]);
  }
  return { byId, byParent };
}

/** Image sources, button links and the like inside an outline: made absolute, links resolved, media collected. */
function finalizeOutline(outline: PageOutline, context: ConvertContext, result: ConvertResult): void {
  const media = (src: string, alt = "") => {
    const absolute = absolutize(src, context.siteUrl);

    if (isOwnUrl(absolute, context.siteUrl) || UPLOADS.test(absolute)) result.media.push({ url: absolute, alt });
    return absolute;
  };
  const link = (href: string) => {
    if (!href || href.startsWith("#") || /^(mailto|tel):/i.test(href)) return href;
    const absolute = absolutize(href, context.siteUrl);

    if (!isOwnUrl(absolute, context.siteUrl)) return absolute;
    if (UPLOADS.test(absolute)) {
      if (/\.(jpe?g|png|gif|webp|avif|svg)$/i.test(new URL(absolute).pathname)) result.media.push({ url: absolute, alt: "" });
      else result.files.push(absolute);
      return absolute;
    }
    const resolved = context.resolveLink?.(absolute);

    if (resolved) return resolved;
    if (context.resolveLink) result.unresolvedLinks.push(absolute);
    return absolute;
  };
  const visit = (items: OutlineItem[]) => {
    for (const item of items) {
      switch (item.kind) {
        case "image":
          item.src = media(item.src, item.alt);
          if (item.href) item.href = item.href === item.src ? item.src : link(item.href);
          break;
        case "button":
          item.href = link(item.href);
          break;
        case "card":
          if (item.image) item.image.src = media(item.image.src, item.image.alt);
          if (item.link) item.link.href = link(item.link.href);
          break;
        case "quote":
          if (item.image) item.image = media(item.image);
          break;
        case "price":
          if (item.button) item.button.href = link(item.button.href);
          break;
        case "gallery":
          for (const picture of item.images) picture.src = media(picture.src, picture.alt);
          break;
        case "embed":
          result.embeds += 1;
          result.embedProviders.push(item.provider ?? "an embed");
          break;
        case "form":
          result.forms += 1;
          break;
        case "row":
          for (const column of item.columns) visit(column.items);
          break;
        default:
          break;
      }
    }
  };

  for (const section of outline.sections) for (const column of section.columns) visit(column.items);
}

export function convertItem(item: WordPressItem, site: WordPressSite, options: ItemContext = {}): ItemConversion {
  const index = mediaIndex(site);
  const tokens = new Tokens();
  const context: ConvertContext = {
    siteUrl: site.siteUrl,
    form: item.contentForm,
    reusable: site.reusableBlocks,
    mediaById: (id) => index.byId.get(id),
    attachments: () => index.byParent.get(item.id) ?? [],
    tokens,
    ...(options.resolveLink ? { resolveLink: options.resolveLink } : {}),
    ...(options.mdx ? { mdx: true } : {}),
  };
  const prepared = prepareHtml(item.content, context);
  const builder: BuilderName | null = item.builder?.name ?? prepared.result.builder ?? builderOfHtml(prepared.html);

  if (!builder) return convertPrepared(prepared, context);

  // Text inside widgets goes through the same converter, its findings tallied into this item's.
  // With the builder's own data, the content field only holds a fallback copy of the page: don't count it twice.
  const fromData = builder === "elementor" && item.builder?.data !== undefined;
  const result: ItemConversion = fromData ? emptyResult() : prepared.result;
  const toMarkdown = (html: string) => {
    const part = convertHtml(html, { ...context, form: "rendered" });

    mergeResult(result, part);
    return part.markdown;
  };
  let outline: PageOutline | null = null;

  if (fromData) {
    outline = elementorOutlineFromData(item.builder!.data, { toMarkdown, mediaById: context.mediaById! });
  }
  if (!outline && builder === "elementor") outline = elementorOutlineFromHtml(prepared.html, { toMarkdown, mediaById: context.mediaById! });
  if (!outline) outline = builderOutlineFromHtml(prepared.html, builder, item.contentForm === "raw" && prepared.result.builder ? "shortcodes" : "html", toMarkdown);
  finalizeOutline(outline, context, result);
  result.builder = builder;
  result.outline = outline;
  result.markdown = finishMarkdown(sectionsToMarkdown(outline.sections, tokens), tokens, {});
  result.media = [...new Map(result.media.map((entry) => [entry.url, entry])).values()];
  result.files = [...new Set(result.files)];
  result.unresolvedLinks = [...new Set(result.unresolvedLinks)];
  // An empty outline means the layout wasn't readable; fall back to the plain conversion so nothing is lost.
  if (!result.markdown.trim()) {
    const plain = convertPrepared(prepareHtml(item.content, { ...context, tokens: new Tokens() }), context);

    return { ...plain, builder, outline };
  }
  return result;
}

export { convertHtml, emptyResult };
