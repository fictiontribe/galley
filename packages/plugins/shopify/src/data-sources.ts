/**
 * Products and collections as data sources: a page section's field that
 * holds a product (or collection) handle opts in with
 * `"dataSource": "shopify-products"` (or `"shopify-collections"`) in
 * galley.config.json, and the app's picker searches here. The file keeps
 * the handle — a plain string — so the site stays files.
 */
import type { DataSourceContribution, DataSourceItem } from "@galley/plugin-kit";
import { ShopifyError } from "./client";
import { demoCollections, demoSearch, demoSummary, resolveSource } from "./source";
import { getCollection, listCollections, productSummary, searchProducts, type CollectionSummary, type ProductSummary } from "./store";

const HANDLE = /^[a-z0-9][a-z0-9-]*$/i;

function productItem(product: ProductSummary, demo: boolean): DataSourceItem {
  const detail = [product.price, product.type, product.available ? null : "Sold out", demo ? "Demo catalogue" : null].filter(Boolean).join(" · ");

  return { value: product.handle, title: product.title, ...(product.image ? { image: product.image } : {}), ...(detail ? { detail } : {}) };
}

function collectionItem(collection: CollectionSummary, demo: boolean): DataSourceItem {
  return { value: collection.handle, title: collection.title, ...(collection.image ? { image: collection.image } : {}), ...(demo ? { detail: "Demo catalogue" } : {}) };
}

/** A ShopifyError's sentence is what the picker shows; anything else is unexpected. */
async function plain<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (error) {
    if (error instanceof ShopifyError) throw new Error(error.message);
    throw error;
  }
}

export const productSource: DataSourceContribution = {
  id: "shopify-products",
  label: "Products in the shop",
  description: "Pick a product from the connected store (or the site's demo catalogue). The page keeps its handle.",
  search: (query, ctx) =>
    plain(async () => {
      const source = await resolveSource(ctx.settings, ctx.site);

      if (source.kind === "demo") return demoSearch(source.catalogue, query, ctx.limit).map((product) => productItem(product, true));
      return (await searchProducts(ctx, source.connection, query, ctx.limit, ctx.signal)).map((product) => productItem(product, false));
    }),
  get: (value, ctx) =>
    plain(async () => {
      if (!HANDLE.test(value)) return null;
      const source = await resolveSource(ctx.settings, ctx.site);

      if (source.kind === "demo") {
        const product = source.catalogue.products.find((item) => item.handle === value);

        return product ? productItem(demoSummary(source.catalogue, product), true) : null;
      }
      const found = await productSummary(ctx, source.connection, value, ctx.signal);

      return found ? productItem(found, false) : null;
    }),
};

export const collectionSource: DataSourceContribution = {
  id: "shopify-collections",
  label: "Collections in the shop",
  description: "Pick a collection from the connected store (or the site's demo catalogue). The page keeps its handle.",
  search: (query, ctx) =>
    plain(async () => {
      const source = await resolveSource(ctx.settings, ctx.site);
      const all = source.kind === "demo" ? demoCollections(source.catalogue) : await listCollections(ctx, source.connection, 100, ctx.signal);
      const words = query.toLowerCase().split(/\s+/).filter(Boolean);

      return all
        .filter((collection) => words.every((word) => `${collection.title} ${collection.handle}`.toLowerCase().includes(word)))
        .slice(0, ctx.limit)
        .map((collection) => collectionItem(collection, source.kind === "demo"));
    }),
  get: (value, ctx) =>
    plain(async () => {
      if (!HANDLE.test(value)) return null;
      const source = await resolveSource(ctx.settings, ctx.site);

      if (source.kind === "demo") {
        const found = demoCollections(source.catalogue).find((collection) => collection.handle === value);

        return found ? collectionItem(found, true) : null;
      }
      const found = await getCollection(ctx, source.connection, value, ctx.signal);

      return found ? collectionItem(found, false) : null;
    }),
};
