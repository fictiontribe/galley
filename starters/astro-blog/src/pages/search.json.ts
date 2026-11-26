// The search index the search page reads: for every post its address,
// title, line, topics, headings and date. Small, built with the site, and
// fetched only when someone opens search.
import type { APIRoute } from "astro";
import { getCollection } from "astro:content";
import { byDate, isPublished, postUrl } from "../lib/blog";
import { formatDate } from "../lib/site";

export const GET: APIRoute = async () => {
  const posts = (await getCollection("blog", isPublished)).sort(byDate);
  const index = posts.map((post) => ({
    url: postUrl(post),
    title: post.data.title,
    description: post.data.description,
    tags: post.data.tags,
    headings: ((post.rendered?.metadata?.headings ?? []) as Array<{ text: string }>).map((heading) => heading.text),
    date: formatDate(post.data.date),
  }));
  return new Response(JSON.stringify(index), { headers: { "Content-Type": "application/json; charset=utf-8" } });
};
