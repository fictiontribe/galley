/**
 * planImport: what would be created where, and what can't be mapped. Pure —
 * no files, no network — so the same plan backs a dry run, the app's
 * preview screen and the real import.
 *
 * It never guesses a destination. Posts go to the collection that is
 * post-like (entries with a date and a body); when two qualify, or none
 * does, the plan asks. Fields are matched by meaning (fields.ts) and only
 * fields the collection actually has are set. Content the target can't hold
 * safely — a draft into a collection that can't mark drafts, a page behind a
 * password — is skipped with the reason, not imported "close enough".
 */
import { createHash } from "node:crypto";
import type { BlockType, Collection, Field, JsonValue, SiteModel } from "@galley/core/types";
import { htmlToText } from "./convert/dom";
import { convertItem } from "./convert/index";
import { summarize } from "./convert/html";
import { mapRoles, ROLE_WORDS, setPath, uncoveredRequired, type Role, type RoleMap } from "./fields";
import { usesDatedFolders } from "./media";
import { buildRebuildBrief } from "./rebuild";
import { oldPath, pathKey, samePath } from "./redirects";
import type {
  CollectionTarget,
  FeatureNote,
  FieldMapping,
  ImportPlan,
  MediaRef,
  PlanOptions,
  PlanQuestion,
  PlannedItem,
  RebuildBrief,
  Redirect,
  SkippedItem,
  WordPressItem,
  WordPressSite,
} from "./types";

// ─────────────────────────────────────────────────────────── choosing collections

function hasDate(collection: Collection): boolean {
  return Boolean(collection.dateField) || collection.fields.some((field) => field.type === "date" || field.type === "datetime");
}

function blocksField(collection: Collection): Field | undefined {
  return collection.fields.find((field) => field.type === "blocks");
}

/** A section type that holds plain prose: a "rich text" block with one markdown/text field. */
export function proseBlock(field: Field | undefined): { block: BlockType; textField: string } | null {
  if (!field?.blocks) return null;
  const named = (block: BlockType) => /rich.?text|prose|^text$|^content$|markdown|^body$|^copy$|article/i.test(block.type);
  const textField = (block: BlockType) =>
    block.fields.find((f) => f.type === "markdown" && /^(text|body|content|markdown|copy)$/i.test(f.key)) ??
    block.fields.find((f) => (f.type === "text" || f.type === "string" || f.type === "markdown") && /^(text|body|content|markdown|copy)$/i.test(f.key));

  for (const block of field.blocks.filter(named)) {
    const text = textField(block);
    const otherRequired = block.fields.filter((f) => f.required && f !== text && f.default === undefined && f.key !== field.discriminator);

    if (text && otherRequired.length === 0) return { block, textField: text.key };
  }
  return null;
}

function postCandidates(model: SiteModel): Collection[] {
  return model.collections.filter((collection) => collection.kind === "entries" && collection.create && collection.body && hasDate(collection));
}

function pageCandidates(model: SiteModel, exclude: string | undefined): Collection[] {
  return model.collections.filter(
    (collection) =>
      collection.kind === "entries" &&
      collection.create &&
      collection.url !== null &&
      collection.id !== exclude &&
      !hasDate(collection) &&
      (collection.body || proseBlock(blocksField(collection)) !== null)
  );
}

function optionsFor(collections: Collection[]): PlanQuestion["options"] {
  return collections.map((collection) => ({ value: collection.id, label: `${collection.label} (${collection.path})` }));
}

/** The answer a person would most likely give: the collection named like the thing, else the first. */
function likelyCollection(collections: Collection[], pattern: RegExp): string | undefined {
  return (collections.find((collection) => pattern.test(collection.id) || pattern.test(collection.label)) ?? collections[0])?.id;
}

const POSTS_NAMES = /^(blog|posts?|news|journal|articles?|stories|insights|updates)$/i;
const PAGES_NAMES = /^(pages?|site|main)$/i;

function question(id: PlanQuestion["id"], text: string, options: PlanQuestion["options"], fallback: string | undefined): PlanQuestion {
  return { id, question: text, options, ...(fallback && options.some((option) => option.value === fallback) ? { default: fallback } : {}) };
}

function joinWords(words: string[]): string {
  return words.length <= 1 ? (words[0] ?? "") : `${words.slice(0, -1).join(", ")} and ${words[words.length - 1]}`;
}

// ─────────────────────────────────────────────────────────── targets

function describeContent(collection: Collection): CollectionTarget["content"] {
  if (collection.body) return { kind: "body" };
  const field = blocksField(collection);
  const prose = proseBlock(field);

  if (field && prose) return { kind: "section", field: field.key, blockType: prose.block.type, textField: prose.textField, discriminator: field.discriminator ?? "type" };
  return { kind: "none" };
}

function targetFor(collection: Collection, wp: WordPressSite): { target: CollectionTarget; roles: RoleMap } {
  const roles = mapRoles(collection);
  const fields: FieldMapping[] = Object.entries(roles).map(([role, ref]) => ({
    field: ref!.path.join("."),
    label: ref!.field.label,
    from: role === "description" && !roles.seoDescription ? ROLE_WORDS.description : role === "description" ? "the excerpt, else the opening paragraph" : ROLE_WORDS[role as Role],
  }));
  const content = describeContent(collection);
  const unmapped: string[] = [];
  const items = wp.items;

  if (!roles.seoTitle && items.some((item) => item.seo.title)) unmapped.push("SEO titles (the page title is used instead)");
  if (!roles.tags && !roles.categories && items.some((item) => item.tagIds.length || item.categoryIds.length)) unmapped.push("categories and tags");
  if (!roles.image && items.some((item) => item.featuredMediaId)) unmapped.push("featured images");
  if (!roles.author && items.some((item) => item.authorId)) unmapped.push("authors");
  if (!roles.updated && items.some((item) => item.modified)) unmapped.push("last-changed dates");
  if (!roles.canonical && items.some((item) => item.seo.canonical)) unmapped.push("canonical addresses set in the SEO plugin");
  if (!roles.noindex && items.some((item) => item.seo.noindex)) unmapped.push("“hide from search engines” settings");
  return {
    target: {
      collection: collection.id,
      label: collection.label,
      fields: [...fields, ...(content.kind === "body" ? [{ field: "(body)", label: "Body", from: "the content, converted to Markdown" }] : content.kind === "section" ? [{ field: content.field, label: "Sections", from: `the content, as one “${content.blockType}” section` }] : [])],
      content,
      unmapped,
    },
    roles,
  };
}

// ─────────────────────────────────────────────────────────── slugs & urls

export function toSlug(input: string): string {
  return input
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9/]+/g, "-")
    .split("/")
    .map((segment) => segment.replace(/^-+|-+$/g, ""))
    .filter(Boolean)
    .join("/");
}

function extensionFor(collection: Collection): string {
  const fromPattern = /\.\{?([a-z0-9]+)/i.exec(collection.pattern ?? "")?.[1];

  if (fromPattern) return fromPattern;
  return collection.format === "mdx" ? "mdx" : collection.format === "markdown" ? "md" : collection.format;
}

function nests(collection: Collection): boolean {
  return (collection.pattern ?? "**/*").includes("**");
}

function pathFor(collection: Collection, slug: string): string {
  const base = collection.path.replace(/\/+$/, "");

  return `${base && base !== "." ? `${base}/` : ""}${slug}.${extensionFor(collection)}`;
}

function urlFor(collection: Collection, slug: string): string | null {
  if (!collection.url) return null;
  const url = collection.url.replace(/\{slug\}/g, slug === "index" ? "" : slug).replace(/\/{2,}/g, "/");

  return url.startsWith("/") ? url : `/${url}`;
}

// ─────────────────────────────────────────────────────────── values

function dateValue(field: Field, item: WordPressItem, which: "date" | "modified"): string | undefined {
  const iso = which === "date" ? item.date : item.modified;
  const local = which === "date" ? item.dateLocal : undefined;

  if (!iso) return undefined;
  if (field.type === "date") return (local || iso).slice(0, 10);
  if (field.type === "datetime") return iso.endsWith("Z") || /[+-]\d\d:\d\d$/.test(iso) ? iso : `${iso}`;
  return (local || iso).slice(0, 10);
}

/** REST excerpts are generated when the author didn't write one; those end in "[…]" and make a poor description. */
function manualExcerpt(item: WordPressItem): string {
  const text = htmlToText(item.excerpt);

  if (!text) return "";
  if (item.contentForm === "rendered" && (/\[(…|&hellip;|\.\.\.)\]\s*$/.test(text) || /(…|\.\.\.)\s*(continue reading|read more).*$/i.test(text))) return "";
  return text;
}

function getPath(data: Record<string, unknown>, path: string[]): unknown {
  return path.reduce<unknown>((value, key) => (value && typeof value === "object" ? (value as Record<string, unknown>)[key] : undefined), data);
}

function hashOf(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex").slice(0, 32);
}

function names(ids: number[], wp: WordPressSite): string[] {
  return ids
    .map((id) => wp.terms.find((term) => term.id === id))
    .filter((term) => term && term.slug !== "uncategorized" && term.slug !== "uncategorised")
    .map((term) => term!.name)
    .filter(Boolean);
}

function uniqueCaseless(values: string[]): string[] {
  const seen = new Set<string>();

  return values.filter((value) => {
    const key = value.toLowerCase();

    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

const FORM_SHORTCODES = /^(contact-form-7|contact-form|wpforms|gravityform|gravityforms|ninja_form|ninja_forms|formidable|caldera_form|forminator_form|fluentform|wpcf7|mc4wp_form)$/;
const MEMBER_SHORTCODES = /^(restrict|members_only|mepr-|pmpro_|members_access|swpm_|rcp_|um_loggedin|wlm_)/;
const SHOP_SHORTCODES = /^(products?|product_page|add_to_cart|woocommerce_|shop_messages|recent_products|featured_products|sale_products|edd_|purchase_link|download_checkout)/;
const SEARCH_SHORTCODES = /^(search|searchform|wpdreams_ajaxsearchlite|ivory-search)$/;

// ─────────────────────────────────────────────────────────── the plan

export function planImport(wp: WordPressSite, model: SiteModel, options: PlanOptions = {}): ImportPlan {
  const only = new Set(options.only ?? ["posts", "pages", "media"]);
  const questions: PlanQuestion[] = [];
  const skipped: SkippedItem[] = [];
  const byId = (id: string | undefined) => model.collections.find((collection) => collection.id === id);
  const wanted = (item: WordPressItem) => (item.type === "post" ? only.has("posts") : item.type === "page" ? only.has("pages") : Boolean(options.types?.[item.type]));
  const sinceOk = (item: WordPressItem) => {
    if (!options.since) return true;
    const threshold = Date.parse(options.since);

    return Number.isNaN(threshold) || Math.max(Date.parse(item.date) || 0, Date.parse(item.modified ?? "") || 0) >= threshold;
  };
  let candidates = wp.items.filter((item) => wanted(item) && sinceOk(item));

  if (options.limit) {
    const kept: WordPressItem[] = [];

    for (const type of new Set(candidates.map((item) => item.type))) {
      kept.push(...candidates.filter((item) => item.type === type).sort((a, b) => b.date.localeCompare(a.date)).slice(0, options.limit));
    }
    candidates = kept;
  }

  // Where posts and pages go.
  let postsCollection: Collection | undefined;
  let pagesCollection: Collection | undefined;
  const hasPosts = candidates.some((item) => item.type === "post");
  const hasPages = candidates.some((item) => item.type === "page");

  if (options.postsCollection) {
    postsCollection = byId(options.postsCollection);
    if (!postsCollection || postsCollection.kind !== "entries" || !postsCollection.create) {
      const offered = postCandidates(model).length ? postCandidates(model) : model.collections.filter((c) => c.kind === "entries" && c.create);

      questions.push(question("posts-collection", `There's no collection called “${options.postsCollection}” that can take new posts. Which collection should posts go into?`, optionsFor(offered), likelyCollection(offered, POSTS_NAMES)));
      postsCollection = undefined;
    }
  } else if (hasPosts) {
    const found = postCandidates(model);

    if (found.length === 1) postsCollection = found[0];
    else {
      const all = model.collections.filter((collection) => collection.kind === "entries" && collection.create && collection.body);

      const offered = found.length > 1 ? found : all;

      questions.push(
        question(
          "posts-collection",
          found.length > 1 ? `Posts could go into ${found.map((c) => c.label).join(" or ")}. Which one should they go into?` : "No collection on this site looks like a blog (one with a date and a body). Which collection should posts go into?",
          optionsFor(offered),
          likelyCollection(offered, POSTS_NAMES)
        )
      );
    }
  }
  if (options.pagesCollection) {
    pagesCollection = byId(options.pagesCollection);
    if (!pagesCollection || pagesCollection.kind !== "entries" || !pagesCollection.create) {
      const offered = pageCandidates(model, postsCollection?.id);

      questions.push(question("pages-collection", `There's no collection called “${options.pagesCollection}” that can take new pages. Which collection should pages go into?`, optionsFor(offered), likelyCollection(offered, PAGES_NAMES)));
      pagesCollection = undefined;
    }
  } else if (hasPages) {
    const found = pageCandidates(model, postsCollection?.id);
    const rooted = found.filter((collection) => collection.url === "/{slug}/" || collection.url === "/{slug}");

    if (rooted.length === 1) pagesCollection = rooted[0];
    else if (found.length === 1) pagesCollection = found[0];
    else {
      const offered = found.length > 1 ? found : model.collections.filter((collection) => collection.kind === "entries" && collection.create);

      questions.push(
        question(
          "pages-collection",
          found.length > 1 ? `Pages could go into ${found.map((c) => c.label).join(" or ")}. Which one should they go into?` : "No collection on this site looks like a place for pages. Which collection should pages go into?",
          optionsFor(offered),
          likelyCollection(offered, PAGES_NAMES)
        )
      );
    }
  }

  const targets = new Map<string, { collection: Collection; target: CollectionTarget; roles: RoleMap }>();
  const targetOf = (collection: Collection | undefined) => {
    if (!collection) return null;
    if (!targets.has(collection.id)) targets.set(collection.id, { collection, ...targetFor(collection, wp) });
    return targets.get(collection.id)!;
  };
  const posts = targetOf(postsCollection);
  const pages = targetOf(pagesCollection);
  const typeTargets: Record<string, CollectionTarget> = {};

  for (const [type, collectionId] of Object.entries(options.types ?? {})) {
    const collection = byId(collectionId);

    if (!collection || collection.kind !== "entries" || !collection.create) {
      const offered = model.collections.filter((c) => c.kind === "entries" && c.create);

      questions.push(question(`type:${type}`, `Which collection should “${type}” items go into? There's no collection called “${collectionId}” that can take them.`, optionsFor(offered), offered[0]?.id));
      continue;
    }
    typeTargets[type] = targetOf(collection)!.target;
  }
  const destination = (item: WordPressItem) => {
    if (item.type === "post") return posts;
    if (item.type === "page") return pages;
    const id = options.types?.[item.type];

    return id && typeTargets[item.type] ? targets.get(id) ?? null : null;
  };

  // Slugs and new addresses first, so links between imported items can be rewritten.
  const pageById = new Map(wp.items.filter((item) => item.type === "page").map((item) => [item.id, item]));
  const taken = new Map<string, number>();
  const slugs = new Map<WordPressItem, string>();
  const linkMap = new Map<string, string>();
  const idMap = new Map<number, string>();

  for (const item of candidates) {
    const target = destination(item);

    if (!target) continue;
    let slug = toSlug(item.slug) || toSlug(item.title) || `${item.type}-${item.id}`;

    if (item.type === "page") {
      // The front page lives at the site's own address (which may be a sub-folder, /news/).
      const front = pathKey(oldPath(item.link, wp.siteUrl) ?? "") === pathKey(oldPath(`${wp.siteUrl}/`, wp.siteUrl) ?? "/");

      if (front && (target.collection.url === "/{slug}/" || target.collection.url === "/{slug}")) slug = "index";
      else if (nests(target.collection)) {
        const chain: string[] = [slug];
        let parent = item.parentId ? pageById.get(item.parentId) : undefined;

        for (let guard = 0; parent && guard < 8; guard += 1) {
          chain.unshift(toSlug(parent.slug) || `page-${parent.id}`);
          parent = parent.parentId ? pageById.get(parent.parentId) : undefined;
        }
        slug = chain.join("/");
      }
    }
    slug = slug.replace(/\/+/g, "/");
    const key = `${target.collection.id}:${slug}`;
    const count = taken.get(key) ?? 0;

    taken.set(key, count + 1);
    if (count > 0) slug = `${slug}-${count + 1}`;
    slugs.set(item, slug);
    const url = urlFor(target.collection, slug);

    if (url) {
      const path = oldPath(item.link, wp.siteUrl);

      if (path) linkMap.set(pathKey(path), url);
      idMap.set(item.id, url);
    }
  }
  /** A link into the old site → the new address of what it points at, when that was imported. */
  const resolveLink = (url: string): string | null => {
    try {
      const parsed = new URL(url);
      const id = Number(parsed.searchParams.get("p") ?? parsed.searchParams.get("page_id") ?? Number.NaN);

      if (Number.isInteger(id) && idMap.has(id)) return `${idMap.get(id)!}${parsed.hash}`;
      const found = linkMap.get(pathKey(parsed.pathname));

      return found ? `${found}${parsed.hash}` : null;
    } catch {
      return null;
    }
  };

  const items: PlannedItem[] = [];
  const rebuilds: RebuildBrief[] = [];
  const features = new Map<FeatureNote["feature"], FeatureNote>();
  const feature = (key: FeatureNote["feature"], title: string, where: string, advice: string) => {
    const note = features.get(key) ?? { feature: key, title, where: [], advice };

    if (where && !note.where.includes(where)) note.where.push(where);
    features.set(key, note);
  };
  const mediaById = new Map(wp.media.map((media) => [media.id, media]));
  /** Required author fields pointing at people this site doesn't have yet: one question per field, naming everyone unmatched. */
  const authorQuestions = new Map<string, { collection: Collection; field: Field; options: PlanQuestion["options"]; names: Set<string> }>();

  for (const item of candidates) {
    const target = destination(item);
    const kind: "post" | "page" = item.type === "page" ? "page" : "post";

    // No destination yet: the plan's question covers it.
    if (!target) continue;
    const { collection, roles } = target;
    const skip = (reason: string) => skipped.push({ sourceId: item.id, title: item.title || "(untitled)", kind, oldUrl: item.link, reason });

    if (item.passwordProtected) {
      skip("It's password-protected on WordPress, and a static site can't put a page behind a password, so it wasn't imported.");
      continue;
    }
    const published = item.status === "publish";

    if (!published && !roles.draft) {
      skip(`It isn't published on WordPress (${item.status === "future" ? "it's scheduled" : `it's ${item.status === "private" ? "private" : "a draft"}`}), and ${collection.label} has no draft setting, so importing it would publish it.`);
      continue;
    }
    if (target.target.content.kind === "none") {
      skip(`${collection.label} has no place for the text of a ${kind} (no body and no plain-text section).`);
      continue;
    }
    const slug = slugs.get(item)!;
    const conversion = convertItem(item, wp, { resolveLink, mdx: collection.format === "mdx" });
    const notes: string[] = [];
    const derived: string[] = [];
    const data: Record<string, unknown> = {};
    const set = (role: Role, value: unknown) => {
      const ref = roles[role];

      if (!ref || value === undefined || value === null || value === "" || (Array.isArray(value) && value.length === 0)) return false;
      setPath(data, ref.path, value);
      return true;
    };
    const title = item.title || (item.slug ? item.slug.replace(/-/g, " ") : "Untitled");

    if (!item.title) notes.push("It had no title on WordPress; one was made from its address.");
    set("title", title);
    if (item.seo.title && item.seo.title !== title) set("seoTitle", item.seo.title);
    const excerpt = manualExcerpt(item);
    const teaser = conversion.teaser ? summarize(conversion.teaser, 300) : "";
    const summary = summarize(conversion.markdown);

    if (roles.seoDescription) {
      set("seoDescription", item.seo.description);
      if (roles.description) {
        const value = excerpt || teaser || summary;

        if (set("description", value) && !excerpt) derived.push(`${roles.description.field.label} was written from the ${teaser && value === teaser ? "text before the “more” break" : "opening paragraph"}`);
      }
    } else if (roles.description) {
      const value = item.seo.description || excerpt || teaser || summary;

      if (set("description", value) && !item.seo.description && !excerpt) derived.push(`${roles.description.field.label} was written from the ${teaser && value === teaser ? "text before the “more” break" : "opening paragraph"} — check it reads well in search results`);
    }
    if (roles.excerpt) set("excerpt", excerpt || teaser);
    if (roles.date) set("date", dateValue(roles.date.field, item, "date"));
    if (roles.updated && item.modified && item.modified.slice(0, 10) !== item.date.slice(0, 10)) set("updated", dateValue(roles.updated.field, item, "modified"));
    const author = wp.authors.find((entry) => entry.id === item.authorId) ?? (item.authorName ? { id: 0, slug: toSlug(item.authorName), name: item.authorName } : undefined);

    if (author && roles.author) {
      const field = roles.author.field;
      const refCollection = field.type === "reference" ? field.collection : field.of?.type === "reference" ? field.of.collection : undefined;

      if (refCollection) {
        const entries = options.context?.entries[refCollection] ?? [];
        const normalize = (text: string) => text.toLowerCase().replace(/\s+/g, " ").trim();
        const match = entries.find((entry) => normalize(entry.title) === normalize(author.name) || entry.slug === toSlug(author.name) || (author.slug && entry.slug === author.slug));

        const people = model.collections.find((c) => c.id === refCollection)?.label ?? refCollection;
        const given = options.defaults?.[collection.id]?.[roles.author.path[0]!];

        if (match) set("author", field.type === "list" ? [match.slug] : match.slug);
        else if (given === undefined && field.required && entries.length) {
          // Nobody here by that name, and every entry needs an author: ask, and plan with the likely answer meanwhile.
          const id = `default:${collection.id}.${roles.author.path.join(".")}`;
          const open = authorQuestions.get(id) ?? { collection, field, options: entries.map((entry) => ({ value: entry.slug, label: entry.title })), names: new Set<string>() };

          open.names.add(author.name);
          authorQuestions.set(id, open);
          set("author", field.type === "list" ? [entries[0]!.slug] : entries[0]!.slug);
          notes.push(`On WordPress it was written by “${author.name}”, who isn't in ${people}; it's credited to the person chosen for the import.`);
        } else if (given === undefined) notes.push(`The author “${author.name}” isn't in ${people}, so the author was left empty.`);
        else notes.push(`On WordPress it was written by “${author.name}”, who isn't in ${people}; it's credited to the person chosen for the import.`);
      } else {
        set("author", field.type === "tags" || field.type === "list" ? [author.name] : author.name);
      }
    }
    const categories = names([...(item.primaryCategoryId ? [item.primaryCategoryId] : []), ...item.categoryIds], wp);
    const tags = names(item.tagIds, wp);
    const listy = (field: Field) => field.type === "tags" || field.type === "list";
    const allowed = (field: Field, values: string[]) => (field.type === "select" && field.options ? values.filter((value) => field.options!.includes(value)) : values);

    if (roles.tags && roles.categories) {
      set("tags", uniqueCaseless(tags));
      const field = roles.categories.field;
      const values = allowed(field, uniqueCaseless(categories));

      set("categories", listy(field) ? values : values[0]);
      if (field.type === "select" && categories.length && !values.length) notes.push(`Its categories (${categories.join(", ")}) aren't among the choices for ${field.label}.`);
    } else if (roles.tags) {
      set("tags", uniqueCaseless([...categories, ...tags]));
    } else if (roles.categories) {
      const field = roles.categories.field;
      const values = allowed(field, uniqueCaseless([...categories, ...tags]));

      set("categories", listy(field) ? values : values[0]);
    }
    // Featured image: the post's own, else the first image in its text.
    const featured = item.featuredMediaId ? mediaById.get(item.featuredMediaId) : undefined;
    const firstBody = conversion.media.find((entry) => /\.(jpe?g|png|gif|webp|avif|svg)(\?|$)/i.test(entry.url));
    const imageFields: PlannedItem["imageFields"] = [];
    const media: MediaRef[] = [];

    if (roles.image) {
      const field = roles.image.field;
      // The first image in the text stands in only where an image is required; an optional one stays empty rather than guessed.
      const candidatesList = [featured?.url, field.required ? firstBody?.url : undefined].filter((url): url is string => Boolean(url));

      if (candidatesList.length) {
        const objectField = field.type === "object" ? field.fields?.find((f) => /^(src|url|image|path)$/i.test(f.key)) : undefined;
        const altInObject = field.type === "object" ? field.fields?.find((f) => /^alt$/i.test(f.key)) : undefined;
        const alt = featured?.alt || (featured ? "" : firstBody?.alt) || "";

        if (objectField) set("image", { [objectField.key]: candidatesList[0], ...(altInObject && alt ? { [altInObject.key]: alt } : {}) });
        else set("image", candidatesList[0]);
        imageFields.push({ field: [...roles.image.path, ...(objectField ? [objectField.key] : [])].join("."), candidates: candidatesList, required: field.required, ...(roles.imageAlt ? { altField: roles.imageAlt.path.join(".") } : {}) });
        if (!featured) derived.push("The featured image is the first image in the text (WordPress had none set)");
        if (roles.imageAlt && alt) set("imageAlt", alt);
        for (const url of candidatesList) media.push({ url, role: "featured", ...(alt ? { alt } : {}) });
      } else if (field.required) {
        const fallback = options.defaults?.[collection.id]?.[roles.image.path[0]!];

        if (fallback === undefined) {
          skip(`Every ${collection.singular} in ${collection.label} needs an image, and this one has none on WordPress (no featured image, no image in the text). Give one for every import (--default ${roles.image.path.join(".")}=/images/…) or add it by hand afterwards.`);
          continue;
        }
        setPath(data, roles.image.path, fallback);
        notes.push("It had no image on WordPress, so it uses the default image given for the import.");
      }
    }
    if (roles.draft) {
      const field = roles.draft.field;

      if (field.type === "boolean") set("draft", roles.draft.inverse ? published : !published);
      else if (field.options) {
        const value = published ? field.options.find((option) => /publish|live|public/i.test(option)) : field.options.find((option) => /draft/i.test(option));

        if (value) set("draft", value);
      }
      if (!published) notes.push(`It's ${item.status === "future" ? "scheduled" : item.status === "private" ? "private" : "a draft"} on WordPress, so it's marked as a draft here.`);
    }
    if (item.seo.canonical && !samePath(oldPath(item.seo.canonical, wp.siteUrl) ?? "", oldPath(item.link, wp.siteUrl) ?? "") && set("canonical", item.seo.canonical)) {
      notes.push("Its SEO plugin pointed search engines at another address; that canonical address was kept.");
    }
    if (item.seo.noindex) {
      if (!set("noindex", true)) notes.push("WordPress hid it from search engines, and this site has no field for that — it will be visible to search engines here.");
    }
    if (roles.slug) set("slug", slug.split("/").pop());
    // Values the site requires that WordPress has nothing for.
    const content = target.target.content;
    const missing = uncoveredRequired(collection, roles, content.kind === "section" ? content.field : null).filter((field) => !(field.key in data));
    const defaults = options.defaults?.[collection.id] ?? {};
    const stillMissing: string[] = [];

    for (const field of missing) {
      if (field.key in defaults) data[field.key] = defaults[field.key]!;
      else stillMissing.push(field.label || field.key);
    }
    for (const [key, value] of Object.entries(defaults)) if (!(key in data) && collection.fields.some((field) => field.key === key)) data[key] = value;
    if (stillMissing.length) {
      skip(`Every ${collection.singular} in ${collection.label} needs ${stillMissing.map((name) => `“${name}”`).join(" and ")}, and WordPress has nothing to fill ${stillMissing.length === 1 ? "it" : "them"} with. Give a value for every import (--default ${missing[0]!.key}=…) or add it by hand afterwards.`);
      continue;
    }
    // A page whose WordPress content is empty is drawn by the theme (a blog index, a query loop): nothing to bring.
    if (!conversion.markdown.trim() && !conversion.outline?.sections.length) {
      skip("It has no content of its own on WordPress — the theme fills that page in (a list of posts, for example) — so there's nothing to import. This site's own pages do that job.");
      continue;
    }
    // Every value the site requires must be there, or its build would fail.
    const empty = collection.fields.filter((field) => field.required && field.type !== "blocks" && field.default === undefined && !field.hidden && (data[field.key] === undefined || data[field.key] === "") && !(content.kind === "section" && field.key === content.field));

    if (empty.length) {
      skip(`Every ${collection.singular} in ${collection.label} needs ${empty.map((field) => `“${field.label || field.key}”`).join(" and ")}, and this one has nothing to fill ${empty.length === 1 ? "it" : "them"} with on WordPress. Give a value for every import (--default ${empty[0]!.key}=…) or add it by hand afterwards.`);
      continue;
    }
    // Content: the body, or one prose section.
    let body = "";

    if (content.kind === "body") body = conversion.markdown;
    else if (content.kind === "section") data[content.field] = [{ [content.discriminator]: content.blockType, [content.textField]: conversion.markdown }];
    for (const entry of conversion.media) if (!media.some((ref) => ref.url === entry.url)) media.push({ url: entry.url, role: "body", ...(entry.alt ? { alt: entry.alt } : {}) });
    for (const url of conversion.files) media.push({ url, role: "link" });
    // What needs a person.
    const shortcodes = [...new Set(conversion.shortcodes)];
    const where = `${title}${urlFor(collection, slug) ? ` (${urlFor(collection, slug)})` : ""}`;

    if (conversion.forms || shortcodes.some((name) => FORM_SHORTCODES.test(name))) {
      feature("forms", "Forms", where, "A static site can't receive form entries by itself. Connect a form service (many hosts include one) or use an email link; the form's place is marked in the page.");
    }
    if (shortcodes.some((name) => MEMBER_SHORTCODES.test(name))) feature("membership", "Members-only content", where, "A static site can't hide pages behind a login. Keep that content on a membership service, or publish it openly if it no longer needs protecting.");
    if (shortcodes.some((name) => SHOP_SHORTCODES.test(name))) feature("e-commerce", "Shop features", where, "Products, carts and checkout need a shop service; this import doesn't bring them across. Link to the shop, or embed a shop provider's buy buttons.");
    if (shortcodes.some((name) => SEARCH_SHORTCODES.test(name)) || /wp-block-search/.test(item.content)) feature("search", "Site search", where, "Search needs a static search index or a search service; the search box was left out.");
    if (conversion.scriptsRemoved) feature("scripts", "Scripts in content", where, "Scripts pasted into content (tracking codes, widgets) were removed; add the ones still needed to the site's layout instead.");
    if (conversion.dynamicBlocks.length) notes.push(`WordPress generated ${conversion.dynamicBlocks.map((name) => `a “${name}” block`).join(", ")} here when the page was shown; it has no content of its own, so its place is marked in the page.`);
    if (conversion.missingReusable.length) notes.push("It used a reusable block that wasn't in the export; its place is marked in the page.");
    if (conversion.builderModules.length) notes.push(`Page-builder modules without a direct equivalent (${[...new Set(conversion.builderModules)].join(", ")}) were imported as their text.`);
    if (item.commentCount) notes.push(`It had ${item.commentCount} ${item.commentCount === 1 ? "comment" : "comments"}, which weren't imported.`);
    const newUrl = urlFor(collection, slug);
    const path = pathFor(collection, slug);
    const planned: PlannedItem = {
      sourceId: item.id,
      sourceType: item.type,
      kind,
      title,
      status: item.status,
      oldUrl: item.link,
      collection: collection.id,
      slug,
      path,
      newUrl,
      data: data as { [key: string]: JsonValue },
      body,
      imageFields,
      media,
      derived,
      hash: hashOf({ collection: collection.id, slug, data, body }),
      embeds: conversion.embeds,
      shortcodes,
      ...(conversion.builder ? { builder: conversion.builder } : {}),
      ...(conversion.outline ? { outline: conversion.outline } : {}),
      notes,
      externalLinks: conversion.unresolvedLinks,
      seo: {
        title: item.seo.title && item.seo.title !== title ? (roles.seoTitle ? "kept" : "not-kept") : null,
        description: !(roles.description || roles.seoDescription) ? null : item.seo.description ? "seo" : excerpt ? "excerpt" : "written",
        canonical: Boolean(roles.canonical && getPath(data, roles.canonical.path)),
      },
    };

    items.push(planned);
    if (conversion.outline && conversion.builder && conversion.outline.sections.length) {
      const sections = blocksField(collection);

      if (sections?.blocks?.length) {
        rebuilds.push(buildRebuildBrief({ title, path, url: newUrl, builder: conversion.builder, outline: conversion.outline, blocks: sections.blocks, blocksLabel: `${sections.label.toLowerCase()}`, discriminator: sections.discriminator ?? "type" }));
      } else {
        notes.push("It was made with a page builder; this site's pages aren't built from sections, so it was imported as text.");
      }
    }
  }

  for (const [id, open] of authorQuestions) {
    const names = [...open.names];

    questions.push(
      question(
        id as PlanQuestion["id"],
        `WordPress names ${names.length === 1 ? `${names[0]} as the author` : `${joinWords(names)} as authors`}, but ${open.field.label || "Author"} in ${open.collection.label} has to be someone already on this site. Who should ${open.collection.label} entries be credited to?`,
        open.options,
        open.options[0]?.value
      )
    );
  }

  // Site-wide features.
  if (wp.commentCount > 0) feature("comments", "Comments", "", `The site has ${wp.commentCount} ${wp.commentCount === 1 ? "comment" : "comments"}. A static site has no comment system of its own: people add a hosted comment service, or close comments and keep the old ones in the WordPress export.`);
  if (wp.features.includes("woocommerce") || wp.features.includes("e-commerce")) feature("e-commerce", "Shop features", "", "Products, carts and checkout need a shop service; this import doesn't bring products across.");
  if (wp.features.some((f) => f === "contact-form-7" || f === "wpforms" || f === "gravity-forms")) feature("forms", "Forms", "", "A static site can't receive form entries by itself. Connect a form service (many hosts include one) or use an email link.");
  if (wp.features.includes("membership")) feature("membership", "Members-only content", "", "A static site can't hide pages behind a login.");
  if (wp.features.includes("events")) feature("events", "Events calendar", "", "Events are a content type of their own on WordPress; import them as a custom type (they're listed below) or link to an events service.");
  if (wp.features.includes("wpml") || wp.features.includes("polylang")) feature("multilingual", "Translations", "", "The site uses a translation plugin. This import reads the site's main language only; each other language needs its own import (or the site's own i18n setup).");

  // Redirects for everything whose address changes.
  const redirects: Redirect[] = [];

  for (const planned of items) {
    const from = oldPath(planned.oldUrl, wp.siteUrl);

    if (!from || !planned.newUrl || samePath(from, planned.newUrl)) continue;
    if (planned.status !== "publish") continue;
    redirects.push({ from, to: planned.newUrl, title: planned.title });
  }

  const library: MediaRef[] = options.only?.includes("media") ? wp.media.map((media) => ({ url: media.url, role: "library" as const, ...(media.alt ? { alt: media.alt } : {}) })) : [];
  const mediaDirectory = options.mediaDirectory ?? model.media.dir;
  const notImported: ImportPlan["notImported"] = [
    { what: "Comments", why: "A static site has no comment system; the comments stay in WordPress and its export." },
    { what: "User accounts and passwords", why: "Only authors' names come across. Logins don't exist on a static site." },
    { what: "The theme, menus and widgets", why: "The new site has its own design and navigation; set up the menu in the site's navigation settings." },
    { what: "Plugin settings and data", why: "Plugins don't run on a static site. What they showed on pages is listed above where it needs a person." },
    { what: "Revisions and trashed items", why: "Only the current version of each item is imported." },
  ];
  const offeredTypes = wp.postTypes.filter((type) => !options.types?.[type.slug]).map((type) => ({ slug: type.slug, name: type.name, ...(type.count !== undefined ? { count: type.count } : {}) }));

  if (offeredTypes.length) notImported.push({ what: `Other content types (${offeredTypes.map((type) => type.name).join(", ")})`, why: "They're specific to plugins or the theme. Choose them by name to import them into a collection." });
  if (!only.has("posts") && wp.items.some((item) => item.type === "post")) notImported.push({ what: "Posts", why: "Not asked for this time." });
  if (!only.has("pages") && wp.items.some((item) => item.type === "page")) notImported.push({ what: "Pages", why: "Not asked for this time." });

  return {
    source: { siteUrl: wp.siteUrl, title: wp.title, kind: wp.source.kind },
    siteName: model.name,
    posts: posts?.target ?? null,
    pages: pages?.target ?? null,
    types: typeTargets,
    questions,
    items,
    skipped,
    library,
    mediaDirectory,
    datedMediaFolders: usesDatedFolders(options.context?.mediaPaths ?? [], model.media.dir),
    redirects,
    rebuilds,
    offeredTypes,
    notImported,
    features: [...features.values()],
  };
}
