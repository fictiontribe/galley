/**
 * A live site through the WordPress REST API.
 *
 * Discovery follows WordPress's own contract: the API root is advertised in
 * a `Link: <…>; rel="https://api.w.org/"` header (and the same <link> in the
 * page head); sites without pretty permalinks answer at `?rest_route=/`.
 * Only what the public endpoints expose is read — or, with an application
 * password, what that account may see (drafts, private pages). Lists are
 * paged with `X-WP-TotalPages`; featured images, authors and terms come
 * embedded (`_embed`) so a post costs no extra requests.
 */
import { createHash } from "node:crypto";
import { join } from "node:path";
import { EXPORT_FILE_ROUTE, ImportError } from "../errors";
import { htmlToText, parseFragment } from "../convert/dom";
import { isElementorHtml } from "../convert/builders/elementor";
import { builderOfHtml } from "../convert/builders/generic";
import type { ReadOptions, WordPressAuthor, WordPressItem, WordPressMedia, WordPressPostType, WordPressSite, WordPressTerm } from "../types";
import { createFetcher, defaultCacheDir, type Fetcher, type HttpResponse } from "./http";
import { seoFromRest } from "./seo";
import { decodeSlug, FEATURE_NAMESPACES, INTERNAL_TYPES, isAfter, normalizeStatus } from "./shared";

type Json = Record<string, unknown>;

export interface RestReadOptions extends ReadOptions {
  auth?: { user: string; password: string };
}

export interface ApiInfo {
  apiRoot: string;
  siteUrl: string;
  index: Json;
}

const API_REL = "https://api.w.org/";
const BLOCKED_CODES = /^rest_(disabled|cannot_access|login_required|forbidden|not_logged_in|authentication_required|no_route)$|^(disabled|unauthorized)$/;

export function normalizeSiteInput(input: string): string {
  const trimmed = input.trim();

  return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
}

function parseJson(response: HttpResponse): unknown {
  try {
    return JSON.parse(response.text.replace(/^﻿/, ""));
  } catch {
    return undefined;
  }
}

/** `<https://example.com/wp-json/>; rel="https://api.w.org/"` → the URL. */
export function apiFromLinkHeader(header: string | undefined): string | null {
  if (!header) return null;
  for (const part of header.split(/,(?=\s*<)/)) {
    const match = /<([^>]+)>\s*;\s*rel="?([^";]+)"?/.exec(part.trim());

    if (match && match[2] === API_REL) return match[1]!;
  }
  return null;
}

function apiFromHead(html: string, base: string): string | null {
  const head = html.slice(0, Math.max(html.indexOf("</head>"), 0) || 200_000);
  const link = parseFragment(head).querySelector(`link[rel="${API_REL}"]`);
  const href = link?.getAttribute("href");

  if (!href) return null;
  try {
    return new URL(href, base).toString();
  } catch {
    return null;
  }
}

function looksLikeWordPress(html: string): boolean {
  return /wp-content\/|wp-includes\/|<meta[^>]+generator[^>]+WordPress/i.test(html);
}

export function endpoint(apiRoot: string, route: string, params: Record<string, string | number> = {}): string {
  if (apiRoot.includes("rest_route=")) {
    const url = new URL(apiRoot);

    url.searchParams.set("rest_route", `/${route.replace(/^\//, "")}`);
    for (const [key, value] of Object.entries(params)) url.searchParams.set(key, String(value));
    return url.toString();
  }
  const query = new URLSearchParams(Object.entries(params).map(([key, value]): [string, string] => [key, String(value)])).toString();

  return `${apiRoot.replace(/\/?$/, "/")}${route.replace(/^\//, "")}${query ? `?${query}` : ""}`;
}

function blocked(siteUrl: string, detail: string): ImportError {
  return new ImportError(
    "blocked",
    `${siteUrl} is a WordPress site, but it doesn't let its content be read over the web (its REST API is switched off or blocked, often by a security plugin). ${EXPORT_FILE_ROUTE}`,
    detail
  );
}

/**
 * Finds the site's API. An address typed without a scheme is tried over
 * https first, as WordPress recommends; when nothing answers there (a site,
 * often one on this computer, that only speaks plain http), over http.
 */
export async function discoverApi(input: string, fetcher: Fetcher): Promise<ApiInfo> {
  try {
    return await discoverAt(normalizeSiteInput(input), fetcher);
  } catch (error) {
    if (/^https?:\/\//i.test(input.trim()) || !(error instanceof ImportError) || error.reason !== "unreachable") throw error;
    return discoverAt(`http://${input.trim()}`, fetcher);
  }
}

async function discoverAt(start: string, fetcher: Fetcher): Promise<ApiInfo> {
  const candidates: string[] = [];
  let home: HttpResponse | null = null;

  if (/\/wp-json(\/|$)/.test(start)) candidates.push(start.replace(/(\/wp-json)(\/.*)?$/, "$1/"));
  if (/[?&]rest_route=/.test(start)) candidates.push(`${start.split("?")[0]}?rest_route=/`);
  const siteBase = start.replace(/\/wp-json(\/.*)?$/, "").replace(/\?.*$/, "").replace(/\/+$/, "");

  if (candidates.length === 0) {
    home = await fetcher.get(siteBase || start, { cache: false, auth: false });
    if (home.status >= 400 && home.status !== 401 && home.status !== 403) {
      throw new ImportError("unreachable", `${siteBase} answered with an error (${home.status}). Check the address — it should be the site's home page.`, `${home.url} ${home.status}`);
    }
    const advertised = apiFromLinkHeader(home.headers.link) ?? apiFromHead(home.text, home.url);

    if (advertised) candidates.push(advertised);
    const base = home.url.replace(/[?#].*$/, "").replace(/\/+$/, "");

    candidates.push(`${base}/wp-json/`, `${base}/?rest_route=/`);
  }
  const problems: string[] = [];

  for (const candidate of [...new Set(candidates)]) {
    const response = await fetcher.get(candidate, { auth: false });
    const body = parseJson(response) as Json | undefined;

    if (response.status === 200 && body && Array.isArray(body.namespaces)) {
      if (!(body.namespaces as unknown[]).includes("wp/v2")) {
        problems.push(`${candidate}: no wp/v2`);
        continue;
      }
      const siteUrl = String(body.home ?? body.url ?? siteBase).replace(/\/+$/, "");

      return { apiRoot: candidate, siteUrl, index: body };
    }
    problems.push(`${candidate}: ${response.status}${body && typeof body.code === "string" ? ` ${body.code}` : ""}`);
    if (body && typeof body.code === "string" && BLOCKED_CODES.test(body.code)) throw blocked(siteBase, problems.join("; "));
  }
  if (home && looksLikeWordPress(home.text)) throw blocked(siteBase, problems.join("; "));
  if (home && (home.status === 401 || home.status === 403)) throw blocked(siteBase, problems.join("; "));
  throw new ImportError(
    "not-wordpress",
    `${siteBase} doesn't look like a WordPress site — it doesn't answer where WordPress sites do. Check the address. If it is WordPress behind a login or a firewall, ${EXPORT_FILE_ROUTE.charAt(0).toLowerCase()}${EXPORT_FILE_ROUTE.slice(1)}`,
    problems.join("; ")
  );
}

function rendered(value: unknown): string {
  if (value && typeof value === "object" && "rendered" in value) return String((value as { rendered: unknown }).rendered ?? "");
  return typeof value === "string" ? value : "";
}

function isError(value: unknown): boolean {
  return Boolean(value && typeof value === "object" && "code" in (value as Json) && !("id" in (value as Json)));
}

function mediaFromRest(raw: Json): WordPressMedia | null {
  if (isError(raw) || typeof raw.source_url !== "string") return null;
  const details = (raw.media_details ?? {}) as Json;
  const sizes = Object.values((details.sizes ?? {}) as Record<string, Json>)
    .map((size) => String(size.source_url ?? ""))
    .filter((url) => url && url !== raw.source_url);
  const original = typeof details.original_image === "string" ? details.original_image : null;

  return {
    id: Number(raw.id),
    url: raw.source_url,
    sizes: original ? [...sizes, (raw.source_url as string).replace(/[^/]+$/, original)].filter((url) => url !== raw.source_url) : sizes,
    title: htmlToText(rendered(raw.title)),
    alt: String(raw.alt_text ?? "").trim(),
    caption: htmlToText(rendered(raw.caption)),
    mime: String(raw.mime_type ?? "application/octet-stream"),
    ...(typeof details.width === "number" ? { width: details.width } : {}),
    ...(typeof details.height === "number" ? { height: details.height } : {}),
    ...(raw.date_gmt ? { date: `${String(raw.date_gmt)}Z` } : {}),
    ...(Number(raw.post) ? { parentId: Number(raw.post) } : {}),
  };
}

export async function readRest(input: string, options: RestReadOptions = {}): Promise<WordPressSite> {
  const cacheDir = options.cacheDir ?? restCacheDir(input);
  const fetcher = createFetcher({
    cacheDir,
    ...(options.fresh ? { fresh: true } : {}),
    ...(options.auth ? { auth: options.auth } : {}),
    ...(options.signal ? { signal: options.signal } : {}),
    ...(options.fetch ? { fetch: options.fetch } : {}),
    ...(options.concurrency ? { concurrency: options.concurrency } : {}),
    ...(options.timeoutMs ? { timeoutMs: options.timeoutMs } : {}),
  });
  const progress = (label: string) => options.onProgress?.({ phase: "read", label });

  progress("Finding the site's content");
  const api = await discoverApi(input, fetcher);
  const { apiRoot, siteUrl } = api;
  const siteName = htmlToText(String(api.index.name ?? ""));
  const namespaces = (api.index.namespaces as string[]) ?? [];
  const features = new Set<string>();

  for (const ns of namespaces) for (const [pattern, feature] of FEATURE_NAMESPACES) if (pattern.test(ns)) features.add(feature);
  const only = new Set(options.only ?? ["posts", "pages", "media"]);
  const notes: string[] = [];
  const authors = new Map<number, WordPressAuthor>();
  const terms = new Map<number, WordPressTerm>();
  const media = new Map<number, WordPressMedia>();
  const authenticated = Boolean(options.auth);

  async function getJson(url: string): Promise<{ response: HttpResponse; body: unknown }> {
    const response = await fetcher.get(url);

    return { response, body: parseJson(response) };
  }

  /** Every page of a list endpoint, newest first, up to `limit`. */
  async function list(route: string, params: Record<string, string | number>, limit?: number): Promise<Json[]> {
    const perPage = Math.min(100, limit ?? 100);
    const first = await getJson(endpoint(apiRoot, route, { ...params, per_page: perPage, page: 1 }));

    if (first.response.status === 401 || first.response.status === 403) {
      if (authenticated) {
        throw new ImportError("auth", "WordPress didn't accept the user name and application password. Check both (the password is the one made under Users › Profile › Application passwords) and try again.", `${route}: ${first.response.status}`);
      }
      throw blocked(siteUrl, `${route}: ${first.response.status}`);
    }
    if (first.response.status === 400 && authenticated && "status" in params) {
      // Some sites refuse the status filter even for signed-in users; fall back to what's published.
      const { status: _ignored, ...rest } = params;

      notes.push("This account can't list drafts on this site, so only published content was read.");
      return list(route, rest, limit);
    }
    if (!Array.isArray(first.body)) {
      if (first.response.status === 404) return [];
      throw blocked(siteUrl, `${route}: ${first.response.status} (not a list)`);
    }
    const totalPages = Number(first.response.headers["x-wp-totalpages"] ?? 1) || 1;
    const needed = limit ? Math.min(totalPages, Math.ceil(limit / perPage)) : totalPages;
    const rest = await Promise.all(
      Array.from({ length: Math.max(0, needed - 1) }, (_, i) => getJson(endpoint(apiRoot, route, { ...params, per_page: perPage, page: i + 2 })))
    );
    const all = [first.body as Json[], ...rest.map((page) => (Array.isArray(page.body) ? (page.body as Json[]) : []))].flat();

    options.onProgress?.({ phase: "read", label: `Read ${all.length} from ${route}`, done: all.length, total: Number(first.response.headers["x-wp-total"] ?? all.length) });
    return limit ? all.slice(0, limit) : all;
  }

  function absorbEmbedded(post: Json) {
    const embedded = (post._embedded ?? {}) as Json;

    for (const author of (embedded.author as Json[] | undefined) ?? []) {
      if (!isError(author) && author.id) authors.set(Number(author.id), { id: Number(author.id), slug: String(author.slug ?? ""), name: htmlToText(String(author.name ?? "")) });
    }
    for (const raw of (embedded["wp:featuredmedia"] as Json[] | undefined) ?? []) {
      const item = mediaFromRest(raw);

      if (item) media.set(item.id, item);
    }
    for (const group of (embedded["wp:term"] as Json[][] | undefined) ?? []) {
      for (const term of group ?? []) {
        if (isError(term) || !term.id) continue;
        terms.set(Number(term.id), { id: Number(term.id), taxonomy: String(term.taxonomy ?? ""), slug: decodeSlug(String(term.slug ?? "")), name: htmlToText(String(term.name ?? "")), ...(term.link ? { link: String(term.link) } : {}) });
      }
    }
  }

  function itemFromRest(post: Json): WordPressItem {
    absorbEmbedded(post);
    const content = (post.content ?? {}) as Json;
    const html = rendered(post.content);
    const builderName = isElementorHtml(html) || /^elementor_/.test(String(post.template ?? "")) ? "elementor" : builderOfHtml(html);
    const otherTerms: Record<string, number[]> = {};

    for (const [key, value] of Object.entries(post)) {
      if (key !== "categories" && key !== "tags" && Array.isArray(value) && value.every((entry) => typeof entry === "number") && /(_cat|_tag|category|_type|taxonomy)/.test(key)) otherTerms[key] = value as number[];
    }
    return {
      id: Number(post.id),
      type: String(post.type ?? "post"),
      slug: decodeSlug(String(post.slug ?? "")),
      title: htmlToText(rendered(post.title)),
      status: normalizeStatus(String(post.status ?? "publish")),
      date: post.date_gmt ? `${String(post.date_gmt)}Z` : String(post.date ?? ""),
      ...(post.date ? { dateLocal: String(post.date) } : {}),
      ...(post.modified_gmt ? { modified: `${String(post.modified_gmt)}Z` } : {}),
      link: String(post.link ?? ""),
      ...(Number(post.parent) ? { parentId: Number(post.parent) } : {}),
      ...(Number(post.menu_order) ? { menuOrder: Number(post.menu_order) } : {}),
      ...(Number(post.author) ? { authorId: Number(post.author) } : {}),
      // Sites that hide their authors from the API often still name them in Yoast's details.
      ...(typeof (post.yoast_head_json as Json | undefined)?.author === "string" ? { authorName: htmlToText(String((post.yoast_head_json as Json).author)) } : {}),
      excerpt: content.protected ? "" : rendered(post.excerpt),
      content: content.protected ? "" : html,
      contentForm: "rendered",
      categoryIds: Array.isArray(post.categories) ? (post.categories as number[]) : [],
      tagIds: Array.isArray(post.tags) ? (post.tags as number[]) : [],
      ...(Object.keys(otherTerms).length ? { otherTerms } : {}),
      ...(Number(post.featured_media) ? { featuredMediaId: Number(post.featured_media) } : {}),
      seo: seoFromRest(post, siteName),
      ...(builderName ? { builder: { name: builderName } } : {}),
      ...(post.template ? { template: String(post.template) } : {}),
      ...(post.sticky ? { sticky: true } : {}),
      ...(content.protected ? { passwordProtected: true } : {}),
    };
  }

  const baseParams: Record<string, string | number> = { _embed: "author,wp:featuredmedia,wp:term", orderby: "date", order: "desc" };

  if (authenticated) baseParams.status = "publish,future,draft,pending,private";
  if (options.since) baseParams.modified_after = `${options.since}T00:00:00`;
  const items: WordPressItem[] = [];

  if (only.has("posts")) {
    progress("Reading posts");
    items.push(...(await list("wp/v2/posts", baseParams, options.limit)).map(itemFromRest));
  }
  if (only.has("pages")) {
    progress("Reading pages");
    items.push(...(await list("wp/v2/pages", { ...baseParams, orderby: "date" }, options.limit)).map(itemFromRest));
  }

  // Content types beyond posts and pages: listed and counted, read only when asked for.
  const postTypes: WordPressPostType[] = [];
  const types = (await getJson(endpoint(apiRoot, "wp/v2/types"))).body as Record<string, Json> | undefined;

  if (types && typeof types === "object" && !Array.isArray(types)) {
    let probes = 0;

    for (const [slug, info] of Object.entries(types)) {
      if (slug === "post" || slug === "page" || INTERNAL_TYPES.has(slug) || !info.rest_base) continue;
      // Counting costs a request per type; a site with dozens of plugin types gets the first dozen counted.
      if (!options.types?.includes(slug) && (probes += 1) > 12) continue;
      if (slug === "product") features.add("woocommerce");
      const restBase = String(info.rest_base);
      const namespace = String(info.rest_namespace ?? "wp/v2");
      const route = `${namespace}/${restBase}`;
      const entry: WordPressPostType = { slug, name: htmlToText(String(info.name ?? slug)), restBase: route };

      if (options.types?.includes(slug)) {
        const read = (await list(route, baseParams, options.limit)).map(itemFromRest);

        items.push(...read);
        entry.count = read.length;
      } else {
        const probe = await fetcher.get(endpoint(apiRoot, route, { per_page: 1 }));

        // Plugin-internal types (form entries, activity logs) don't list publicly; only offer what a visitor could see.
        if (probe.status !== 200) continue;
        entry.count = Number(probe.headers["x-wp-total"] ?? 0);
      }
      if (entry.count !== 0) postTypes.push(entry);
    }
  }

  // Featured images that weren't embedded (private media, older sites), fetched by id in batches.
  const missingMedia = [...new Set(items.map((item) => item.featuredMediaId).filter((id): id is number => Boolean(id) && !media.has(id!)))];

  for (let i = 0; i < missingMedia.length; i += 100) {
    const batch = missingMedia.slice(i, i + 100);
    const { body } = await getJson(endpoint(apiRoot, "wp/v2/media", { include: batch.join(","), per_page: 100 }));

    for (const raw of Array.isArray(body) ? (body as Json[]) : []) {
      const item = mediaFromRest(raw);

      if (item) media.set(item.id, item);
    }
  }
  // The whole library only when media was asked for by name; otherwise just what the content uses.
  if (options.only?.includes("media")) {
    progress("Reading the media library");
    for (const raw of await list("wp/v2/media", { orderby: "date", order: "desc" }, options.limit)) {
      const item = mediaFromRest(raw);

      if (item) media.set(item.id, item);
    }
  }

  // Category parents aren't part of the embedded terms; one request per hundred categories fills them in.
  const categoryIds = [...new Set(items.flatMap((item) => item.categoryIds))];

  for (let i = 0; i < categoryIds.length; i += 100) {
    const { body } = await getJson(endpoint(apiRoot, "wp/v2/categories", { include: categoryIds.slice(i, i + 100).join(","), per_page: 100 }));

    for (const raw of Array.isArray(body) ? (body as Json[]) : []) {
      terms.set(Number(raw.id), { id: Number(raw.id), taxonomy: "category", slug: decodeSlug(String(raw.slug ?? "")), name: htmlToText(String(raw.name ?? "")), ...(Number(raw.parent) ? { parentId: Number(raw.parent) } : {}), ...(raw.link ? { link: String(raw.link) } : {}) });
    }
  }
  const missingTags = [...new Set(items.flatMap((item) => item.tagIds))].filter((id) => !terms.has(id));

  for (let i = 0; i < missingTags.length; i += 100) {
    const { body } = await getJson(endpoint(apiRoot, "wp/v2/tags", { include: missingTags.slice(i, i + 100).join(","), per_page: 100 }));

    for (const raw of Array.isArray(body) ? (body as Json[]) : []) {
      terms.set(Number(raw.id), { id: Number(raw.id), taxonomy: "post_tag", slug: decodeSlug(String(raw.slug ?? "")), name: htmlToText(String(raw.name ?? "")) });
    }
  }
  const missingAuthors = [...new Set(items.map((item) => item.authorId).filter((id): id is number => Boolean(id) && !authors.has(id!)))];

  if (missingAuthors.length) {
    const { body } = await getJson(endpoint(apiRoot, "wp/v2/users", { include: missingAuthors.slice(0, 100).join(","), per_page: 100 }));

    if (Array.isArray(body)) {
      for (const raw of body as Json[]) authors.set(Number(raw.id), { id: Number(raw.id), slug: String(raw.slug ?? ""), name: htmlToText(String(raw.name ?? "")) });
    }
    const unnamed = items.filter((item) => item.authorId && !authors.has(item.authorId) && !item.authorName).length;

    if (unnamed) notes.push(`The site keeps its list of authors private, so ${unnamed === 1 ? "one item has" : `${unnamed} items have`} no author name.`);
  }
  let commentCount = 0;
  const comments = await fetcher.get(endpoint(apiRoot, "wp/v2/comments", { per_page: 1 }));

  if (comments.status === 200) commentCount = Number(comments.headers["x-wp-total"] ?? 0);
  const filtered = items.filter((item) => isAfter(item, options.since));

  return {
    source: { kind: "rest", input, apiRoot, authenticated },
    siteUrl,
    title: siteName,
    description: htmlToText(String(api.index.description ?? "")),
    items: filtered,
    media: [...media.values()],
    terms: [...terms.values()],
    authors: [...authors.values()],
    postTypes,
    reusableBlocks: {},
    features: [...features],
    commentCount,
    notes,
  };
}

/** The cache folder an import of this site uses, so a finished import can clear it. */
export function restCacheDir(input: string): string {
  return join(defaultCacheDir(), createHash("sha256").update(normalizeSiteInput(input)).digest("hex").slice(0, 16));
}
