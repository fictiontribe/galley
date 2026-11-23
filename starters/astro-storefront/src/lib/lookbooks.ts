import { getCollection, getEntry, type CollectionEntry } from "astro:content";

export type Lookbook = CollectionEntry<"lookbooks">;

/** Published lookbooks, newest season first. Drafts are visible in development only. */
export async function getLookbooks(): Promise<Lookbook[]> {
  const lookbooks = await getCollection("lookbooks", (entry) => import.meta.env.DEV || !entry.data.draft);
  return lookbooks.sort((a, b) => b.data.date.getTime() - a.data.date.getTime());
}

/**
 * The lookbook a section points at. Content writes a file name
 * ("aw26-the-long-afternoon"); once validated it arrives as a reference
 * ({ collection, id }). Both work; without one, the newest lookbook.
 */
export async function findLookbook(ref: string | { id: string } | undefined): Promise<Lookbook | undefined> {
  const id = typeof ref === "string" ? ref : ref?.id;
  if (id) return getEntry("lookbooks", id);
  return (await getLookbooks())[0];
}
