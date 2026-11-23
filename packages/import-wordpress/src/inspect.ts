/**
 * inspectWordPress: the quick look the app takes while a person is still
 * typing the address — is it WordPress, can its content be read, and how
 * much is there — without reading the whole site.
 *
 * For a live site that is discovery plus one tiny request per list (the
 * totals come back in WordPress's own X-WP-Total header). An export file is
 * read in full (it streams, and the plan needs it anyway), so its counts are
 * exact. Every failure is an ImportError whose reason says which next step
 * to offer: an application password, an export file, a corrected address.
 */
import { ImportError } from "./errors";
import { createFetcher } from "./source/http";
import { discoverApi, endpoint } from "./source/rest";
import { readWxr } from "./source/wxr";
import type { WordPressSite, WordPressSource } from "./types";

export interface Inspection {
  kind: "rest" | "file";
  title: string;
  siteUrl: string;
  /** null: the site doesn't say (a list it keeps private). */
  counts: { posts: number | null; pages: number | null; media: number | null; comments: number | null };
  /** Page-builder pages, when they can be told without reading every page (export files). */
  builderPages?: number;
  /** The account given could read drafts and private pages. */
  signedIn: boolean;
  /** Plugins and features it shows signs of. */
  features: string[];
  /** For an export file: the whole site, read, so the plan needn't read it again. */
  site?: WordPressSite;
}

export interface InspectOptions {
  fetch?: typeof fetch;
  signal?: AbortSignal;
  timeoutMs?: number;
}

function total(headers: Record<string, string>): number | null {
  const value = Number(headers["x-wp-total"]);

  return Number.isFinite(value) ? value : null;
}

export async function inspectWordPress(source: WordPressSource, options: InspectOptions = {}): Promise<Inspection> {
  if ("file" in source) {
    const site = await readWxr(source.file, options.signal ? { signal: options.signal } : {});
    const count = (type: string) => site.items.filter((item) => item.type === type).length;

    return {
      kind: "file",
      title: site.title,
      siteUrl: site.siteUrl,
      counts: { posts: count("post"), pages: count("page"), media: site.media.length, comments: site.commentCount },
      builderPages: site.items.filter((item) => item.builder).length,
      signedIn: false,
      features: site.features,
      site,
    };
  }
  // Nothing is cached: this look is repeated as the address is typed, and must say what the site says now.
  const fetcher = createFetcher({
    fresh: true,
    timeoutMs: options.timeoutMs ?? 15_000,
    retries: 1,
    ...(source.auth ? { auth: source.auth } : {}),
    ...(options.fetch ? { fetch: options.fetch } : {}),
    ...(options.signal ? { signal: options.signal } : {}),
  });
  const api = await discoverApi(source.url, fetcher);
  const namespaces = Array.isArray(api.index.namespaces) ? (api.index.namespaces as string[]) : [];
  const probe = async (route: string, params: Record<string, string | number> = {}) => fetcher.get(endpoint(api.apiRoot, route, { per_page: 1, ...params }), { cache: false });
  const signedIn = Boolean(source.auth);
  const posts = await probe("wp/v2/posts", signedIn ? { status: "publish,future,draft,pending,private" } : {});

  if (posts.status === 401 || posts.status === 403) {
    if (signedIn) throw new ImportError("auth", "WordPress didn't accept that user name and application password. Check both and try again.", `posts: ${posts.status}`);
    throw new ImportError("blocked", `${api.siteUrl} is a WordPress site, but it hides its content from visitors.`, `posts: ${posts.status}`);
  }
  const [pages, media, comments] = await Promise.all([probe("wp/v2/pages"), probe("wp/v2/media"), probe("wp/v2/comments")]);
  const features = namespaces.filter((ns) => /woocommerce|wc\/|contact-form-7|elementor|yoast|rankmath|aioseo|wpml|polylang/i.test(ns));

  return {
    kind: "rest",
    title: typeof api.index.name === "string" ? api.index.name : "",
    siteUrl: api.siteUrl,
    counts: {
      posts: posts.status === 200 ? total(posts.headers) : null,
      pages: pages.status === 200 ? total(pages.headers) : null,
      media: media.status === 200 ? total(media.headers) : null,
      comments: comments.status === 200 ? total(comments.headers) : null,
    },
    signedIn,
    features,
  };
}
