/**
 * Which store a call is about. The plugin's settings are the connection
 * (address and tokens); a site also names its store in its own files
 * (`src/data/shop/store.json`, the file its build reads), and a site with
 * no store at all carries a demo catalogue (`src/data/shop/catalogue.json`).
 *
 * In that order: the settings' store; else the store the site names, read
 * without a token; else the site's demo catalogue. When the settings and
 * the site name different stores the call refuses rather than pick one.
 */
import type { SiteService } from "@galley/plugin-kit";
import { connectionFrom, ShopifyError, storeOrigin, type StoreConnection } from "./client";
import { formatMoney, type CollectionSummary, type ProductDetail, type ProductSummary } from "./store";

export const SITE_STORE_FILE = "src/data/shop/store.json";
export const DEMO_CATALOGUE_FILE = "src/data/shop/catalogue.json";

/** The starter's catalogue format (also what the fake store and the seed script read). */
export interface DemoCatalogue {
  shop?: { name?: string; currencyCode?: string };
  collections?: Array<{ handle: string; title: string; description?: string; products: string[]; image?: { url: string } }>;
  products: Array<{
    handle: string;
    title: string;
    description?: string;
    descriptionHtml?: string;
    productType?: string;
    seo?: { title?: string; description?: string };
    options?: Array<{ name: string; values: string[] }>;
    images?: Array<{ url: string; altText?: string }>;
    variants: Array<{ title?: string; sku?: string; availableForSale?: boolean; price: { amount: string; currencyCode?: string }; selectedOptions: Array<{ name: string; value: string }> }>;
  }>;
}

export type Source = { kind: "store"; connection: StoreConnection; via: "settings" | "site" } | { kind: "demo"; catalogue: DemoCatalogue; path: string };

async function readJson<T>(site: SiteService, path: string): Promise<T | null> {
  let file: { content: string };

  try {
    file = await site.readFile(path);
  } catch {
    return null;
  }
  try {
    return JSON.parse(file.content) as T;
  } catch {
    throw new ShopifyError("invalid", `${path} isn't valid JSON, so the shop can't be read from it.`);
  }
}

export async function resolveSource(settings: Readonly<Record<string, string | undefined>>, site: SiteService | null): Promise<Source> {
  const siteStore = site ? await readJson<{ domain?: string }>(site, SITE_STORE_FILE) : null;
  const siteDomain = siteStore?.domain?.trim() || "";

  if (settings.storeDomain?.trim()) {
    const connection = connectionFrom(settings);

    if (siteDomain && storeOrigin(siteDomain) !== connection.origin) {
      throw new ShopifyError(
        "invalid",
        `This site's ${SITE_STORE_FILE} names ${new URL(storeOrigin(siteDomain)).host}, but the Shopify plugin is connected to ${connection.host}. Make them the same store first.`
      );
    }
    return { kind: "store", connection, via: "settings" };
  }
  if (siteDomain) return { kind: "store", connection: connectionFrom({ storeDomain: siteDomain, apiVersion: settings.apiVersion }), via: "site" };
  const catalogue = site ? await readJson<DemoCatalogue>(site, DEMO_CATALOGUE_FILE) : null;

  if (catalogue && Array.isArray(catalogue.products)) return { kind: "demo", catalogue, path: DEMO_CATALOGUE_FILE };
  throw new ShopifyError("unconfigured", "No store is connected. Add the store's address in the Shopify plugin's settings.");
}

// ── the demo catalogue, answered the way a store would ───────────────────

function demoPrice(product: DemoCatalogue["products"][number], currency: string): string {
  const prices = product.variants.map((variant) => Number(variant.price.amount));
  const min = formatMoney({ amount: String(Math.min(...prices)), currencyCode: currency });
  const max = formatMoney({ amount: String(Math.max(...prices)), currencyCode: currency });

  return min === max ? min : `${min} – ${max}`;
}

export function demoSummary(catalogue: DemoCatalogue, product: DemoCatalogue["products"][number]): ProductSummary {
  return {
    handle: product.handle,
    title: product.title,
    type: product.productType ?? "",
    price: demoPrice(product, catalogue.shop?.currencyCode ?? "GBP"),
    available: product.variants.some((variant) => variant.availableForSale !== false),
    image: product.images?.[0]?.url ?? null,
  };
}

export function demoSearch(catalogue: DemoCatalogue, words: string, limit: number): ProductSummary[] {
  const terms = words.toLowerCase().split(/\s+/).filter(Boolean);

  return catalogue.products
    .filter((product) => terms.every((term) => [product.title, product.handle, product.productType ?? "", product.description ?? ""].join(" ").toLowerCase().includes(term)))
    .slice(0, limit)
    .map((product) => demoSummary(catalogue, product));
}

export function demoProduct(catalogue: DemoCatalogue, handle: string): ProductDetail | null {
  const product = catalogue.products.find((item) => item.handle === handle);
  const currency = catalogue.shop?.currencyCode ?? "GBP";

  if (!product) return null;
  return {
    handle: product.handle,
    title: product.title,
    type: product.productType ?? "",
    description: product.description ?? "",
    descriptionHtml: product.descriptionHtml ?? "",
    available: product.variants.some((variant) => variant.availableForSale !== false),
    price: demoPrice(product, currency),
    seo: { title: product.seo?.title ?? null, description: product.seo?.description ?? null },
    options: product.options ?? [],
    variants: product.variants.map((variant) => ({
      title: variant.title ?? variant.selectedOptions.map((option) => option.value).join(" / "),
      sku: variant.sku ?? null,
      available: variant.availableForSale !== false,
      price: formatMoney({ amount: variant.price.amount, currencyCode: variant.price.currencyCode ?? currency }),
      options: Object.fromEntries(variant.selectedOptions.map((option) => [option.name, option.value])),
    })),
    images: (product.images ?? []).map((image) => ({ url: image.url, alt: image.altText ?? null })),
    collections: (catalogue.collections ?? []).filter((collection) => collection.products.includes(product.handle)).map((collection) => collection.handle),
  };
}

export function demoCollections(catalogue: DemoCatalogue): CollectionSummary[] {
  return (catalogue.collections ?? []).map((collection) => ({ handle: collection.handle, title: collection.title, description: collection.description ?? "", image: collection.image?.url ?? null }));
}
