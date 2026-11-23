import { getCollection, type CollectionEntry } from "astro:content";
import { withBase } from "./site";

/** Published customer stories, newest first. Drafts are visible in development only. */
export async function getCustomers(): Promise<CollectionEntry<"customers">[]> {
  const stories = await getCollection("customers", (story) => import.meta.env.DEV || !story.data.draft);
  return stories.sort((a, b) => b.data.date.getTime() - a.data.date.getTime());
}

/** A story's address on this site, including the base path. */
export function customerUrl(story: CollectionEntry<"customers">): string {
  return withBase(`/customers/${story.id}/`);
}

/** A reference written in content: "ostrell-logistics" or { id: "ostrell-logistics" }. */
export function referenceId(value: string | { id: string }): string {
  return typeof value === "string" ? value : value.id;
}
