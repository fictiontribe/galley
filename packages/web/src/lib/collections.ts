import type { Collection, SiteModel } from "@galley/core/types";
import type { IconName } from "@/ui/Icon";

/** Collections shown in navigation (config can hide some). */
export function visibleCollections(model: SiteModel | null | undefined): Collection[] {
  return (model?.collections ?? []).filter((collection) => !collection.hidden);
}

/** The collection a repo path belongs to, by its directory (entries) or file (data). */
export function collectionForPath(model: SiteModel | null | undefined, path: string): Collection | null {
  if (!model) return null;
  let best: Collection | null = null;
  for (const collection of model.collections) {
    const base = collection.path.replace(/\/+$/, "");
    const hit = collection.kind === "data" ? path === base : path.startsWith(`${base}/`);
    if (hit && (!best || base.length > best.path.length)) best = collection;
  }
  return best;
}

/** A sidebar icon that suits the collection, guessed from its id. */
export function collectionIcon(collection: Collection): IconName {
  if (collection.kind === "data") return "data";
  const id = `${collection.id} ${collection.label}`.toLowerCase();
  if (/team|people|author|staff|member/.test(id)) return "person";
  if (/blog|post|news|journal|article|update|changelog/.test(id)) return "posts";
  return "page";
}
