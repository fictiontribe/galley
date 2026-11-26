// The RSS feed: every recent post, whole (src/lib/feed.ts).
import type { APIRoute } from "astro";
import { authorName, feedHtml, feedPosts, postLink } from "../lib/feed";
import { absolute, site, withBase } from "../lib/site";

const xml = (text: string) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const cdata = (text: string) => `<![CDATA[${text.replace(/]]>/g, "]]]]><![CDATA[>")}]]>`;

export const GET: APIRoute = async () => {
  const posts = await feedPosts();
  const items = await Promise.all(
    posts.map(async (post) => {
      const link = postLink(post);
      const image = absolute(withBase(post.data.image));
      return `    <item>
      <title>${xml(post.data.title)}</title>
      <link>${link}</link>
      <guid isPermaLink="true">${link}</guid>
      <pubDate>${post.data.date.toUTCString()}</pubDate>
      <dc:creator>${xml(await authorName(post))}</dc:creator>
      <description>${xml(post.data.description)}</description>
${post.data.tags.map((tag) => `      <category>${xml(tag)}</category>`).join("\n")}
      <media:content url="${xml(image)}" medium="image" />
      <content:encoded>${cdata(`<p><img src="${image}" alt="${xml(post.data.imageAlt)}"></p>${feedHtml(post)}`)}</content:encoded>
    </item>`;
    }),
  );
  const home = absolute(withBase("/"));
  const body = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:content="http://purl.org/rss/1.0/modules/content/" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:atom="http://www.w3.org/2005/Atom" xmlns:media="http://search.yahoo.com/mrss/">
  <channel>
    <title>${xml(site.name)}</title>
    <link>${home}</link>
    <description>${xml(site.description)}</description>
    <language>${site.locale}</language>
    <atom:link href="${absolute(withBase("/rss.xml"))}" rel="self" type="application/rss+xml" />
${posts[0] ? `    <lastBuildDate>${(posts[0].data.updated ?? posts[0].data.date).toUTCString()}</lastBuildDate>\n` : ""}${items.join("\n")}
  </channel>
</rss>
`;
  return new Response(body, { headers: { "Content-Type": "application/rss+xml; charset=utf-8" } });
};
