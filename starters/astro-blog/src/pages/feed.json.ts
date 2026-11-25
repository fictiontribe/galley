// The JSON feed (jsonfeed.org, version 1.1): every recent post, whole.
import type { APIRoute } from "astro";
import { authorName, feedHtml, feedPosts, postLink } from "../lib/feed";
import { absolute, site, withBase } from "../lib/site";

export const GET: APIRoute = async () => {
  const posts = await feedPosts();
  const feed = {
    version: "https://jsonfeed.org/version/1.1",
    title: site.name,
    home_page_url: absolute(withBase("/")),
    feed_url: absolute(withBase("/feed.json")),
    description: site.description,
    language: site.lang,
    items: await Promise.all(
      posts.map(async (post) => ({
        id: postLink(post),
        url: postLink(post),
        title: post.data.title,
        summary: post.data.description,
        content_html: feedHtml(post),
        image: absolute(withBase(post.data.image)),
        date_published: post.data.date.toISOString(),
        ...(post.data.updated ? { date_modified: post.data.updated.toISOString() } : {}),
        authors: [{ name: await authorName(post) }],
        tags: post.data.tags,
      })),
    ),
  };
  return new Response(`${JSON.stringify(feed, null, 2)}\n`, { headers: { "Content-Type": "application/feed+json; charset=utf-8" } });
};
