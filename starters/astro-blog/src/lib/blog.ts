import { getCollection, getEntry, type CollectionEntry } from "astro:content";
import { slugify, withBase } from "./site";

export type Post = CollectionEntry<"blog">;
export type Author = CollectionEntry<"authors">;
export type Series = CollectionEntry<"series">;

/**
 * Whether a post is out: not a draft, and not dated in the future (a post
 * dated next Tuesday appears in the first build after next Tuesday).
 * Development shows everything, so drafts and scheduled posts can be read.
 */
export function isPublished(post: Post): boolean {
  if (import.meta.env.DEV) return true;
  return !post.data.draft && post.data.date.getTime() <= Date.now();
}

/** Newest first. */
export const byDate = (a: Post, b: Post) => b.data.date.getTime() - a.data.date.getTime();

/** Published posts, newest first. */
export async function getPosts(): Promise<Post[]> {
  return (await getCollection("blog", isPublished)).sort(byDate);
}

/** A post's address, including the base path. */
export const postUrl = (post: Post | string) => withBase(`/blog/${typeof post === "string" ? post : post.id}/`);
export const authorUrl = (id: string) => withBase(`/authors/${id}/`);
export const seriesUrl = (id: string) => withBase(`/series/${id}/`);
export const tagSlug = (tag: string) => slugify(tag);
export const tagUrl = (tag: string) => withBase(`/tags/${tagSlug(tag)}/`);

/** The id a reference holds, whether Astro resolved it ({ id }) or the section gallery passed a bare file name. */
export function refId(value: string | { id: string } | undefined): string | undefined {
  return typeof value === "string" ? value : value?.id;
}

/** Every tag used by `posts`, A–Z, with the posts that carry it (newest first). */
export function postsByTag(posts: Post[]): Array<{ tag: string; slug: string; posts: Post[] }> {
  const tags = new Map<string, { tag: string; slug: string; posts: Post[] }>();
  for (const post of posts) {
    for (const tag of post.data.tags) {
      const slug = tagSlug(tag);
      if (!slug) continue;
      if (!tags.has(slug)) tags.set(slug, { tag, slug, posts: [] });
      tags.get(slug)!.posts.push(post);
    }
  }
  return [...tags.values()].sort((a, b) => a.tag.localeCompare(b.tag));
}

/** A series' posts, in part order (then date). */
export function postsInSeries(posts: Post[], seriesId: string): Post[] {
  return posts
    .filter((post) => refId(post.data.series) === seriesId)
    .sort((a, b) => (a.data.seriesPart ?? 999) - (b.data.seriesPart ?? 999) || a.data.date.getTime() - b.data.date.getTime());
}

/** Posts to read next: most tags in common, then the same series, then the newest. */
export function relatedPosts(post: Post, posts: Post[], limit: number): Post[] {
  const tags = new Set(post.data.tags.map(tagSlug));
  const series = refId(post.data.series);
  return posts
    .filter((other) => other.id !== post.id)
    .map((other) => ({
      other,
      score: other.data.tags.filter((tag) => tags.has(tagSlug(tag))).length * 2 + (series && refId(other.data.series) === series ? 1 : 0),
    }))
    .sort((a, b) => b.score - a.score || byDate(a.other, b.other))
    .slice(0, limit)
    .map(({ other }) => other);
}

/** Posts grouped by year, newest year first. */
export function postsByYear(posts: Post[]): Array<{ year: number; posts: Post[] }> {
  const years = new Map<number, Post[]>();
  for (const post of posts) {
    const year = post.data.date.getUTCFullYear();
    if (!years.has(year)) years.set(year, []);
    years.get(year)!.push(post);
  }
  return [...years.entries()].sort((a, b) => b[0] - a[0]).map(([year, list]) => ({ year, posts: list }));
}

/** An author entry from a reference or file name. */
export async function authorOf(value: string | { id: string }): Promise<Author | undefined> {
  const id = refId(value);
  return id ? getEntry("authors", id) : undefined;
}

/** A series entry from a reference or file name. */
export async function seriesOf(value: string | { id: string } | undefined): Promise<Series | undefined> {
  const id = refId(value);
  return id ? getEntry("series", id) : undefined;
}
