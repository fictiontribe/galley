/**
 * WordPress export files (WXR — the XML from Tools › Export).
 *
 * Read with a streaming XML parser (saxes): the file goes through in chunks
 * and only one item is held while it is being read, so a 200 MB export never
 * becomes a 200 MB-times-ten document tree. Items that won't be imported are
 * dropped as soon as they close, and of each item's post meta only the keys
 * that matter are kept (featured image, SEO plugin fields, page-builder
 * markers and Elementor's layout).
 */
import { createReadStream, statSync } from "node:fs";
import { SaxesParser, type SaxesTagPlain } from "saxes";
import { ImportError } from "../errors";
import type { ReadOptions, WordPressAuthor, WordPressItem, WordPressMedia, WordPressPostType, WordPressSite, WordPressTerm } from "../types";
import { htmlToText } from "../convert/dom";
import { seoFromMeta } from "./seo";
import { decodeSlug, FEATURE_TYPES, INTERNAL_TYPES, isAfter, isoDate, normalizeStatus } from "./shared";

const KEPT_META = new Set([
  "_thumbnail_id",
  "_yoast_wpseo_title",
  "_yoast_wpseo_metadesc",
  "_yoast_wpseo_canonical",
  "_yoast_wpseo_meta-robots-noindex",
  "_yoast_wpseo_primary_category",
  "rank_math_title",
  "rank_math_description",
  "rank_math_robots",
  "rank_math_canonical_url",
  "_aioseo_title",
  "_aioseo_description",
  "_aioseo_canonical_url",
  "_aioseop_title",
  "_aioseop_description",
  "_aioseop_noindex",
  "_elementor_data",
  "_elementor_edit_mode",
  "_et_pb_use_builder",
  "_wpb_vc_js_status",
  "_fl_builder_enabled",
  "_wp_attachment_image_alt",
  "_wp_attached_file",
  "_wp_attachment_metadata",
  "_wp_page_template",
]);

/** Characters XML 1.0 forbids; old exports sometimes contain them and a strict parser would stop. */
const INVALID_XML = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]/g;

interface RawItem {
  fields: Record<string, string>;
  categories: Array<{ domain: string; nicename: string; name: string }>;
  meta: Record<string, string>;
  comments: number;
}

const MIME_BY_EXTENSION: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  gif: "image/gif",
  webp: "image/webp",
  avif: "image/avif",
  svg: "image/svg+xml",
  pdf: "application/pdf",
  mp4: "video/mp4",
  mp3: "audio/mpeg",
  m4a: "audio/mp4",
  mov: "video/quicktime",
  webm: "video/webm",
  zip: "application/zip",
};

function mimeOf(url: string): string {
  const ext = /\.([a-z0-9]+)(?:\?|#|$)/i.exec(url)?.[1]?.toLowerCase() ?? "";

  return MIME_BY_EXTENSION[ext] ?? "application/octet-stream";
}

/** Generated sizes listed in `_wp_attachment_metadata` (PHP-serialised; only the file names are read). */
function sizesFromMetadata(original: string, metadata: string | undefined): string[] {
  if (!metadata) return [];
  const dir = original.slice(0, original.lastIndexOf("/") + 1);
  const names = Array.from(metadata.matchAll(/s:\d+:"([^"\/]+-\d+x\d+\.[a-z0-9]+)"/gi), (match) => match[1]!);

  return [...new Set(names)].map((name) => `${dir}${name}`);
}

function keepNewest<T extends { date: string }>(list: T[], limit: number | undefined): void {
  if (!limit || list.length <= limit * 2) return;
  list.sort((a, b) => b.date.localeCompare(a.date));
  list.length = limit;
}

export async function readWxr(path: string, options: ReadOptions = {}): Promise<WordPressSite> {
  try {
    if (!statSync(path).isFile()) throw new Error("not a file");
  } catch {
    throw new ImportError("file", `There's no file at “${path}”. Check the path to the export file and try again.`, path);
  }
  const only = new Set(options.only ?? ["posts", "pages", "media"]);
  const wantedTypes = new Set(options.types ?? []);
  const parser = new SaxesParser<{ xmlns: false; position: false }>({ xmlns: false, position: false });
  const stack: string[] = [];
  let text = "";
  let capturing = false;
  const channel: Record<string, string> = {};
  const authors: WordPressAuthor[] = [];
  const terms: WordPressTerm[] = [];
  const termSlugs = new Map<string, number>();
  const parentSlugs: Array<{ term: WordPressTerm; parent: string }> = [];
  const posts: WordPressItem[] = [];
  const pages: WordPressItem[] = [];
  const others: WordPressItem[] = [];
  const media: WordPressMedia[] = [];
  const reusable: Record<number, string> = {};
  const typeCounts = new Map<string, number>();
  const features = new Set<string>();
  let commentCount = 0;
  let sawChannel = false;
  let errors = 0;
  let current: RawItem | null = null;
  let block: Record<string, string> | null = null;
  let category: { domain: string; nicename: string } | null = null;
  let metaKey = "";
  let metaValue = "";
  let inComment = false;
  let commentApproved = "";
  let syntheticTermId = -1;

  const inItem = () => stack.includes("item");

  parser.on("error", () => {
    errors += 1;
  });
  parser.on("opentag", (tag: SaxesTagPlain) => {
    stack.push(tag.name);
    text = "";
    switch (tag.name) {
      case "channel":
        sawChannel = true;
        break;
      case "item":
        current = { fields: {}, categories: [], meta: {}, comments: 0 };
        break;
      case "wp:author":
      case "wp:category":
      case "wp:tag":
      case "wp:term":
        if (!inItem()) block = {};
        break;
      case "category":
        if (current) category = { domain: String(tag.attributes.domain ?? ""), nicename: String(tag.attributes.nicename ?? "") };
        break;
      case "wp:comment":
        inComment = true;
        commentApproved = "";
        break;
      case "wp:postmeta":
        metaKey = "";
        metaValue = "";
        break;
      default:
        break;
    }
    // Only leaf text that is going to be kept is buffered.
    capturing = !(tag.name === "wp:meta_value" && !KEPT_META.has(metaKey)) && !(inComment && tag.name !== "wp:comment_approved");
  });
  const onText = (chunk: string) => {
    if (capturing) text += chunk;
  };

  parser.on("text", onText);
  parser.on("cdata", onText);
  parser.on("closetag", (tag: SaxesTagPlain) => {
    const name = tag.name;
    const value = text;

    stack.pop();
    text = "";
    const parent = stack[stack.length - 1] ?? "";

    if (inComment) {
      if (name === "wp:comment_approved") commentApproved = value.trim();
      if (name === "wp:comment") {
        inComment = false;
        if (commentApproved === "1" && current) current.comments += 1;
      }
      return;
    }
    if (current && name === "item") {
      finishItem(current);
      current = null;
      return;
    }
    if (current) {
      if (name === "category" && category) {
        current.categories.push({ ...category, name: value.trim() });
        category = null;
      } else if (name === "wp:meta_key") {
        metaKey = value.trim();
      } else if (name === "wp:meta_value") {
        metaValue = value;
      } else if (name === "wp:postmeta") {
        if (KEPT_META.has(metaKey)) current.meta[metaKey] = metaValue;
      } else if (parent === "item") {
        current.fields[name] = value;
      }
      return;
    }
    if (block && (name === "wp:author" || name === "wp:category" || name === "wp:tag" || name === "wp:term")) {
      finishBlock(name, block);
      block = null;
      return;
    }
    if (block) {
      block[name] = value.trim();
      return;
    }
    if (parent === "channel") channel[name] = value.trim();
  });

  function finishBlock(name: string, fields: Record<string, string>) {
    if (name === "wp:author") {
      authors.push({ id: Number(fields["wp:author_id"]) || authors.length + 1, slug: fields["wp:author_login"] ?? "", name: htmlToText(fields["wp:author_display_name"] || fields["wp:author_login"] || "") });
      return;
    }
    const taxonomy = name === "wp:category" ? "category" : name === "wp:tag" ? "post_tag" : (fields["wp:term_taxonomy"] ?? "");
    const slug = decodeSlug(fields["wp:category_nicename"] ?? fields["wp:tag_slug"] ?? fields["wp:term_slug"] ?? "");
    const term: WordPressTerm = {
      id: Number(fields["wp:term_id"]) || syntheticTermId--,
      taxonomy,
      slug,
      name: htmlToText(fields["wp:cat_name"] ?? fields["wp:tag_name"] ?? fields["wp:term_name"] ?? slug),
    };
    const key = `${taxonomy}:${slug}`;

    if (termSlugs.has(key) || taxonomy === "nav_menu") return;
    termSlugs.set(key, term.id);
    terms.push(term);
    const parentSlug = fields["wp:category_parent"] ?? fields["wp:term_parent"];

    if (parentSlug) parentSlugs.push({ term, parent: parentSlug });
  }

  function termIds(raw: RawItem, domain: string): number[] {
    return raw.categories
      .filter((entry) => entry.domain === domain)
      .map((entry) => {
        const slug = decodeSlug(entry.nicename);
        const key = `${domain}:${slug}`;
        let id = termSlugs.get(key);

        if (id === undefined) {
          // Some exports list a post's terms without declaring them up top.
          id = syntheticTermId--;
          termSlugs.set(key, id);
          terms.push({ id, taxonomy: domain, slug, name: htmlToText(entry.name) });
        }
        return id;
      });
  }

  function finishItem(raw: RawItem) {
    const f = raw.fields;
    const type = (f["wp:post_type"] ?? "post").trim();
    const id = Number(f["wp:post_id"]);

    typeCounts.set(type, (typeCounts.get(type) ?? 0) + 1);
    if (FEATURE_TYPES[type]) features.add(FEATURE_TYPES[type]!);
    if (type === "attachment") {
      const url = (f["wp:attachment_url"] ?? f.guid ?? "").trim();

      if (!url) return;
      media.push({
        id,
        url,
        sizes: sizesFromMetadata(url, raw.meta._wp_attachment_metadata),
        title: htmlToText(f.title ?? ""),
        alt: (raw.meta._wp_attachment_image_alt ?? "").trim(),
        caption: htmlToText(f["excerpt:encoded"] ?? ""),
        mime: mimeOf(url),
        date: isoDate(f["wp:post_date"], f["wp:post_date_gmt"]),
        ...(Number(f["wp:post_parent"]) ? { parentId: Number(f["wp:post_parent"]) } : {}),
      });
      return;
    }
    if (type === "wp_block") {
      reusable[id] = f["content:encoded"] ?? "";
      return;
    }
    const kind = type === "post" ? "posts" : type === "page" ? "pages" : null;

    if (kind ? !only.has(kind) : !wantedTypes.has(type)) return;
    const status = normalizeStatus(f["wp:status"]);

    if (status === "trash" || status === "auto-draft" || status === "inherit") return;
    const title = htmlToText(f.title ?? "");
    // dc:creator is the author's login; exports declare authors before items.
    const creator = (f["dc:creator"] ?? "").trim();
    let author = authors.find((entry) => entry.slug === creator);

    if (!author && creator) {
      author = { id: -(authors.length + 1), slug: creator, name: creator };
      authors.push(author);
    }
    const item: WordPressItem = {
      id,
      type,
      slug: decodeSlug((f["wp:post_name"] ?? "").trim()),
      title,
      status,
      date: isoDate(f["wp:post_date"], f["wp:post_date_gmt"]),
      dateLocal: (f["wp:post_date"] ?? "").trim().replace(" ", "T"),
      modified: isoDate(f["wp:post_modified"], f["wp:post_modified_gmt"]),
      link: (f.link ?? "").trim(),
      ...(Number(f["wp:post_parent"]) ? { parentId: Number(f["wp:post_parent"]) } : {}),
      ...(Number(f["wp:menu_order"]) ? { menuOrder: Number(f["wp:menu_order"]) } : {}),
      ...(author ? { authorId: author.id } : {}),
      excerpt: f["excerpt:encoded"] ?? "",
      content: f["content:encoded"] ?? "",
      contentForm: "raw",
      categoryIds: termIds(raw, "category"),
      tagIds: termIds(raw, "post_tag"),
      seo: {},
      ...(raw.meta._thumbnail_id ? { featuredMediaId: Number(raw.meta._thumbnail_id) } : {}),
      ...(raw.meta._wp_page_template && raw.meta._wp_page_template !== "default" ? { template: raw.meta._wp_page_template } : {}),
      ...(f["wp:is_sticky"] === "1" ? { sticky: true } : {}),
      ...((f["wp:post_password"] ?? "").trim() ? { passwordProtected: true } : {}),
      commentCount: raw.comments,
      ...(Number(raw.meta._yoast_wpseo_primary_category) ? { primaryCategoryId: Number(raw.meta._yoast_wpseo_primary_category) } : {}),
    };
    const other: Record<string, number[]> = {};

    for (const domain of new Set(raw.categories.map((entry) => entry.domain))) {
      if (domain !== "category" && domain !== "post_tag") other[domain] = termIds(raw, domain);
    }
    if (Object.keys(other).length) item.otherTerms = other;
    item.seo = seoFromMeta(raw.meta, { title, siteName: htmlToText(channel.title ?? ""), siteDescription: htmlToText(channel.description ?? ""), excerpt: htmlToText(item.excerpt) });
    if (raw.meta._elementor_edit_mode === "builder" || raw.meta._elementor_data) {
      item.builder = { name: "elementor", ...(raw.meta._elementor_data ? { data: raw.meta._elementor_data } : {}) };
    } else if (raw.meta._et_pb_use_builder === "on") {
      item.builder = { name: "divi" };
    } else if (raw.meta._wpb_vc_js_status === "true") {
      item.builder = { name: "wpbakery" };
    } else if (raw.meta._fl_builder_enabled === "1") {
      item.builder = { name: "beaver" };
    }
    commentCount += raw.comments;
    if (!isAfter(item, options.since)) return;
    const list = type === "post" ? posts : type === "page" ? pages : others;

    list.push(item);
    keepNewest(list, options.limit);
  }

  await new Promise<void>((resolve, reject) => {
    const stream = createReadStream(path, { encoding: "utf8", highWaterMark: 1 << 20 });
    let read = 0;
    const total = statSync(path).size;

    options.signal?.addEventListener("abort", () => stream.destroy(new ImportError("aborted", "The import was stopped.")), { once: true });
    stream.on("data", (chunk) => {
      const piece = String(chunk);

      read += Buffer.byteLength(piece);
      try {
        parser.write(piece.replace(INVALID_XML, ""));
      } catch (error) {
        stream.destroy(error as Error);
      }
      options.onProgress?.({ phase: "read", label: "Reading the export file", done: read, total });
    });
    stream.on("error", reject);
    stream.on("end", () => {
      try {
        parser.close();
      } catch {
        errors += 1;
      }
      resolve();
    });
  });

  if (!sawChannel || !(channel["wp:base_site_url"] || channel["wp:wxr_version"] || channel.link)) {
    throw new ImportError("file", "This file isn't a WordPress export. In WordPress, open Tools › Export, choose “All content” and download the file it makes.", path);
  }
  for (const { term, parent } of parentSlugs) {
    const id = termSlugs.get(`${term.taxonomy}:${decodeSlug(parent)}`);

    if (id !== undefined) term.parentId = id;
  }
  const siteUrl = (channel["wp:base_blog_url"] || channel.link || channel["wp:base_site_url"] || "").replace(/\/+$/, "");
  const notes: string[] = [];

  if (errors > 0) notes.push(`The export file has ${errors === 1 ? "a small formatting problem" : `${errors} small formatting problems`}; everything readable around them was read.`);
  const postTypes: WordPressPostType[] = [...typeCounts.entries()]
    .filter(([type]) => type !== "post" && type !== "page" && !INTERNAL_TYPES.has(type))
    .map(([slug, count]) => ({ slug, name: slug.replace(/[_-]+/g, " "), count }));
  const finalPosts = limitTo(posts, options.limit);
  const finalPages = limitTo(pages, options.limit);

  return {
    source: { kind: "file", input: path, authenticated: false },
    siteUrl,
    title: htmlToText(channel.title ?? ""),
    description: htmlToText(channel.description ?? ""),
    ...(channel.language ? { language: channel.language } : {}),
    items: [...finalPosts, ...finalPages, ...others],
    media,
    terms,
    authors,
    postTypes,
    reusableBlocks: reusable,
    features: [...features],
    commentCount,
    notes,
  };
}

function limitTo(list: WordPressItem[], limit: number | undefined): WordPressItem[] {
  const sorted = [...list].sort((a, b) => b.date.localeCompare(a.date));

  return limit ? sorted.slice(0, limit) : sorted;
}
