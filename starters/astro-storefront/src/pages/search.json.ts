// The search index, built with the site: every product (name, type,
// description, price) and every story, lookbook and page, with their
// addresses. The search page reads it in the browser.
import type { APIRoute } from "astro";
import { getCollection } from "astro:content";
import { getPosts, postUrl } from "../lib/journal";
import { getLookbooks } from "../lib/lookbooks";
import { labels, lookbookUrl, plain, withBase } from "../lib/site";
import { getProducts, imageSources, priceLabel, productUrl } from "../lib/shop/data";

export const GET: APIRoute = async () => {
  const products = (await getProducts()).map((product) => {
    const image = product.images[0];
    const sources = image ? imageSources({ ...image, url: image.sizes[0]?.[0] ?? image.url, sizes: [] }) : null;

    return {
      title: product.title,
      url: productUrl(product.handle),
      price: product.availableForSale ? priceLabel(product) : labels.shop.soldOut,
      image: sources?.src ?? "",
      text: [product.productType, product.description, ...product.options.flatMap((option) => option.values)].join(" "),
    };
  });
  const pages = [
    ...(await getPosts()).map((post) => ({ title: post.data.title, url: postUrl(post), kind: labels.journal.backToJournal, text: `${post.data.description} ${post.data.tags.join(" ")}` })),
    ...(await getLookbooks()).map((lookbook) => ({ title: lookbook.data.title, url: lookbookUrl(lookbook.id), kind: lookbook.data.season, text: lookbook.data.summary })),
    ...(await getCollection("pages", (page) => !page.data.noindex && !["404", "bag", "search"].includes(page.id))).map((page) => ({
      title: plain(page.data.title),
      url: withBase(page.id === "index" ? "/" : `/${page.id}/`),
      kind: "",
      text: page.data.description,
    })),
  ];

  return new Response(JSON.stringify({ products, pages }), { headers: { "Content-Type": "application/json; charset=utf-8" } });
};
