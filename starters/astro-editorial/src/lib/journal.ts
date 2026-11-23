import { getCollection, type CollectionEntry } from "astro:content";
import { withBase } from "./site";

export type Post = CollectionEntry<"journal">;

/** Published journal stories, newest first. Drafts are visible in development only. */
export async function getPosts(): Promise<Post[]> {
  const posts = await getCollection("journal", (post) => import.meta.env.DEV || !post.data.draft);
  return posts.sort((a, b) => b.data.date.getTime() - a.data.date.getTime());
}

/** A story's address on this site, including the base path. */
export function postUrl(post: Post): string {
  return withBase(`/journal/${post.id}/`);
}

/** "Pattern cutting" → "pattern-cutting". */
export function tagSlug(tag: string): string {
  return tag
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** The page listing every story filed under `tag`, including the base path. */
export function tagUrl(tag: string): string {
  return withBase(`/journal/tags/${tagSlug(tag)}/`);
}

/** Every tag used by `posts`, alphabetically, with the stories that carry it (newest first). */
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
