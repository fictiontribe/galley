// The shop's content loaders: products and collections become Astro
// content collections ("storeProducts", "storeCollections") when the site
// is built, from the connected store or the demo catalogue (store.ts).
//
// An object loader (Astro's content loader API, astro@7): `load()` runs at
// build time and fills the collection's data store. The store is read once
// per build for both collections; each entry's digest lets Astro skip
// unchanged entries. These collections are the store's, not files, so
// an editor lists them as not editable — products are edited in the store.
import type { Loader } from "astro/loaders";
import { loadShop } from "./store";

export function shopLoader(kind: "products" | "collections"): Loader {
  return {
    name: `shop-${kind}`,
    async load({ store, logger, generateDigest }) {
      const data = await loadShop();
      const items = kind === "products" ? data.products : data.collections;

      store.clear();
      for (const [position, item] of items.entries()) {
        // Entries come back sorted by id; `position` keeps the store's own order.
        const record = { ...item, mode: data.mode, position } as unknown as Record<string, unknown>;

        store.set({ id: item.handle, data: record, digest: generateDigest(record) });
      }
      logger.info(`${items.length} ${kind} from ${data.mode === "demo" ? "the demo catalogue" : "the store"}`);
    },
  };
}
