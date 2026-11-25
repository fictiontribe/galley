// Feeds: the RSS feed (/rss.xml) and the JSON feed (/feed.json) carry each
// post whole, so a reader app shows it without a click. Embeds become plain
// HTML a feed reader can show — a chart its table of numbers, a comparison
// its table, figures and lists as lists — and every link and image gets its
// full address.

import { getCollection } from "astro:content";
import { byDate, isPublished, postUrl, refId, type Post } from "./blog";
import { finish, readEmbed } from "./embeds";
import { absolute, labels, site } from "./site";

const escape = (text: string) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

type Data = Record<string, any>;

/** Plain HTML for one embed, for places that can't run the site's components. */
export function embedToHtml(type: string, data: Data): string {
  const title = data.title ? `<p><strong>${escape(data.title)}</strong></p>` : "";
  const list = (items: string[]) => `<ul>${items.map((item) => `<li>${escape(item)}</li>`).join("")}</ul>`;
  switch (type) {
    case "chart": {
      const head = `<tr><th></th>${data.series.map((s: Data) => `<th>${escape(s.name)}</th>`).join("")}</tr>`;
      const rows = data.labels
        .map((label: string, i: number) => `<tr><th>${escape(label)}</th>${data.series.map((s: Data) => `<td>${s.values[i] ?? "–"}${data.unit ? ` ${escape(data.unit)}` : ""}</td>`).join("")}</tr>`)
        .join("");
      return `${title}${data.text ? `<p>${escape(data.text)}</p>` : ""}<table>${head}${rows}</table>`;
    }
    case "compare": {
      const head = `<tr><th></th>${data.columns.map((c: string) => `<th>${escape(c)}</th>`).join("")}</tr>`;
      const rows = data.rows.map((row: Data) => `<tr><th>${escape(row.label)}</th>${data.columns.map((_: string, i: number) => `<td>${escape(row.values[i] ?? "")}</td>`).join("")}</tr>`).join("");
      return `${title}<table>${head}${rows}</table>`;
    }
    case "stats":
      return `${title}<ul>${data.items.map((item: Data) => `<li><strong>${escape(item.value)}</strong> ${escape(item.label)}${item.change ? ` (${escape(item.change)})` : ""}</li>`).join("")}</ul>`;
    case "verdict":
      return `<p><strong>${escape(data.title)}</strong>${typeof data.score === "number" ? ` — ${data.score}/${data.outOf}` : ""}</p><p>${escape(data.summary)}</p>${data.pros.length ? `<p>${labels.embeds.pros}</p>${list(data.pros)}` : ""}${data.cons.length ? `<p>${labels.embeds.cons}</p>${list(data.cons)}` : ""}`;
    case "proscons":
      return `${title}<p>${escape(data.prosLabel ?? labels.embeds.pros)}</p>${list(data.pros)}<p>${escape(data.consLabel ?? labels.embeds.cons)}</p>${list(data.cons)}`;
    case "timeline":
      return `${title}<ul>${data.items.map((item: Data) => `<li><strong>${escape(item.date)}</strong> — ${escape(item.title)}${item.text ? `. ${escape(item.text)}` : ""}</li>`).join("")}</ul>`;
    case "steps":
      return `${title}<ol>${data.items.map((item: Data) => `<li><strong>${escape(item.title)}</strong>${item.text ? ` ${escape(item.text)}` : ""}</li>`).join("")}</ol>`;
    case "faq":
      return `${title}${data.items.map((item: Data) => `<p><strong>${escape(item.question)}</strong></p><p>${escape(item.answer)}</p>`).join("")}`;
    case "gallery":
      return data.items.map((item: Data) => `<figure><img src="${item.image}" alt="${escape(item.imageAlt)}">${item.caption ? `<figcaption>${escape(item.caption)}</figcaption>` : ""}</figure>`).join("");
    case "pullquote":
      return `<blockquote><p>${escape(data.quote)}</p>${data.name ? `<p>— ${escape(data.name)}</p>` : ""}</blockquote>`;
    case "video":
      return `<p><a href="${data.href}"><img src="${data.image}" alt="${escape(data.imageAlt)}"><br>${escape(data.title)}</a></p>`;
    case "takeaways":
      return `${title}${list(data.items)}`;
    default:
      return "";
  }
}

/** A post's whole body as HTML a feed reader can show, with full addresses. */
export function feedHtml(post: Post): string {
  const html = (post.rendered?.html ?? "").replace(/<div data-embed="([a-z-]+)" data-source="([^"]*)"><\/div>/g, (_, type: string, source: string) => {
    const read = readEmbed(type, decodeURIComponent(source));
    return "data" in read ? embedToHtml(type, read.data) : "";
  });
  return finish(html)
    .replace(/\s(href|src)="(\/[^"/][^"]*|\/)"/g, (_, attr: string, path: string) => ` ${attr}="${absolute(import.meta.env.BASE_URL.replace(/\/$/, "") + path)}"`)
    .replace(/\ssrcset="[^"]*"/g, "")
    .replace(/\ssizes="[^"]*"/g, "")
    .replace(/<button[\s\S]*?<\/button>/g, "");
}

/** The posts a feed carries, newest first. */
export async function feedPosts(): Promise<Post[]> {
  return (await getCollection("blog", isPublished)).sort(byDate).slice(0, site.blog.feedItems);
}

export const feedTitle = site.name;
export const postLink = (post: Post) => absolute(postUrl(post));
export const authorName = async (post: Post) => {
  const { getEntry } = await import("astro:content");
  return (await getEntry("authors", refId(post.data.author) ?? ""))?.data.name ?? site.name;
};
