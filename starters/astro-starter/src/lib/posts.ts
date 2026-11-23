import { getCollection, type CollectionEntry } from "astro:content";
import { withBase } from "./site";

/** Published posts, newest first. Drafts are visible in development only. */
export async function getPosts(): Promise<CollectionEntry<"blog">[]> {
  const posts = await getCollection("blog", (post) => import.meta.env.DEV || !post.data.draft);
  return posts.sort((a, b) => b.data.date.getTime() - a.data.date.getTime());
}

/** A post's address on this site, including the base path. */
export function postUrl(post: CollectionEntry<"blog">): string {
  return withBase(`/blog/${post.id}/`);
}

/** "Living with building work" → "living-with-building-work". */
export function tagSlug(tag: string): string {
  return tag
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** The page listing every post filed under `tag`, including the base path. */
export function tagUrl(tag: string): string {
  return withBase(`/blog/tags/${tagSlug(tag)}/`);
}

/** Every tag used by `posts`, in alphabetical order, with the posts that carry it (newest first). */
export function postsByTag(posts: CollectionEntry<"blog">[]): Array<{ tag: string; slug: string; posts: CollectionEntry<"blog">[] }> {
  const tags = new Map<string, { tag: string; slug: string; posts: CollectionEntry<"blog">[] }>();

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
