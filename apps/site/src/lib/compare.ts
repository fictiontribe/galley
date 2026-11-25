/**
 * Comparison articles: src/content/compare/<slug>.md, one page each at
 * /compare/<slug>/. The hub (/compare/) lists the guides first, then the
 * products, each kind by `order`. Its words, and the words every article
 * shares, are src/content/pages/compare.md. A draft is shown while developing
 * and left out of the built site.
 */
import { getCollection, type CollectionEntry } from "astro:content";

export type Comparison = CollectionEntry<"compare">;

export const compareHref = (slug: string) => `/compare/${slug}/`;

export async function getComparisons(): Promise<Comparison[]> {
  const all = await getCollection("compare", (e) => !(import.meta.env.PROD && e.data.draft));
  const rank = (e: Comparison) => (e.data.kind === "guide" ? 0 : 1);
  return all.sort((a, b) => rank(a) - rank(b) || a.data.order - b.data.order || a.data.heading.localeCompare(b.data.heading));
}

/** A link to another page on the hub: an article, or one of the hub's `also` pages (such as /wordpress/). */
export interface CompareLink {
  title: string;
  text: string;
  href: string;
}

export function linkFor(ref: string, all: Comparison[], also: CompareLink[]): CompareLink | undefined {
  const entry = all.find((e) => e.id === ref);
  if (entry) return { title: entry.data.name ?? entry.data.heading, text: entry.data.lead, href: compareHref(entry.id) };
  return also.find((l) => l.href === ref);
}
