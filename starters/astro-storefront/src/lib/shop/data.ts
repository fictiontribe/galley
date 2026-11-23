// The shop's products and collections as pages read them: from the
// storeProducts and storeCollections content collections (filled by
// loader.ts), plus the helpers every shop component shares — prices,
// links, the facts a filter needs, and what the browser is told.
import { getCollection } from "astro:content";
import { fill, labels, site, withBase } from "../site";
import { storeSettingsFromEnv } from "./store";
import type { Money, ShopCollection, ShopImage, ShopProduct, ShopVariant, StoreClientConfig } from "./types";

type Mode = "demo" | "store";

let cache: Promise<{ mode: Mode; products: ShopProduct[]; collections: ShopCollection[] }> | null = null;

async function read() {
  cache ??= (async () => {
    const inOrder = <T extends { position: number }>(list: T[]) => list.sort((a, b) => a.position - b.position);
    const products = inOrder((await getCollection("storeProducts")).map((entry) => entry.data as unknown as ShopProduct & { mode: Mode; position: number }));
    const collections = inOrder((await getCollection("storeCollections")).map((entry) => entry.data as unknown as ShopCollection & { mode: Mode; position: number }));
    const mode: Mode = products[0]?.mode ?? collections[0]?.mode ?? "demo";

    return { mode, products, collections };
  })();
  return cache;
}

export async function shopMode(): Promise<Mode> {
  return (await read()).mode;
}

/** Every product, in the store's order. */
export async function getProducts(): Promise<ShopProduct[]> {
  return (await read()).products;
}

export async function getProduct(handle: string | undefined): Promise<ShopProduct | undefined> {
  if (!handle) return undefined;
  return (await read()).products.find((product) => product.handle === handle);
}

/** The products these handles name, in that order; a handle the store doesn't have is left out (the publish check warns about it). */
export async function productsByHandle(handles: string[] = []): Promise<ShopProduct[]> {
  const products = (await read()).products;

  return handles.map((handle) => products.find((product) => product.handle === handle)).filter((product): product is ShopProduct => Boolean(product));
}

export async function getCollections(): Promise<ShopCollection[]> {
  return (await read()).collections;
}

export async function getShopCollection(handle: string | undefined): Promise<ShopCollection | undefined> {
  if (!handle) return undefined;
  return (await read()).collections.find((collection) => collection.handle === handle);
}

export async function collectionProducts(collection: ShopCollection): Promise<ShopProduct[]> {
  return productsByHandle(collection.products);
}

// ── addresses ────────────────────────────────────────────────────────────

export const productUrl = (handle: string) => withBase(`/products/${handle}/`);
export const collectionUrl = (handle: string) => withBase(`/shop/${handle}/`);
export const shopUrl = () => withBase("/shop/");

// ── prices ───────────────────────────────────────────────────────────────

const formats = new Map<string, Intl.NumberFormat>();

/** "£640", "£1,280", "£12.50": no pence when there are none. */
export function formatMoney(money: Money): string {
  const value = Number(money.amount);
  const whole = Number.isInteger(value);
  const key = `${money.currencyCode}:${whole}`;
  let format = formats.get(key);

  if (!format) {
    format = new Intl.NumberFormat(site.locale, { style: "currency", currency: money.currencyCode, minimumFractionDigits: whole ? 0 : 2, maximumFractionDigits: 2 });
    formats.set(key, format);
  }
  return format.format(value);
}

/** One price, or "from £210" when the variants differ. */
export function priceLabel(product: ShopProduct): string {
  const { min, max } = product.priceRange;

  return min.amount === max.amount ? formatMoney(min) : fill(labels.shop.from, { price: formatMoney(min) });
}

// ── pictures ─────────────────────────────────────────────────────────────

/** A picture's src and srcset, through withBase() when it lives in the site. */
export function imageSources(image: ShopImage): { src: string; srcset: string | undefined } {
  const local = (url: string) => (/^https?:\/\//.test(url) ? url : withBase(url));
  const sizes = image.sizes.filter(([, width]) => width < image.width);

  return {
    src: local(image.url),
    srcset: sizes.length ? [...sizes.map(([url, width]) => `${local(url)} ${width}w`), `${local(image.url)} ${image.width}w`].join(", ") : undefined,
  };
}

/** The picture a variant shows (its colour), else the product's first. */
export function variantImage(product: ShopProduct, variant: ShopVariant | undefined): ShopImage | undefined {
  return (variant?.image !== null && variant?.image !== undefined ? product.images[variant.image] : undefined) ?? product.images[0];
}

/** The first variant that can be bought, else the first. */
export function firstVariant(product: ShopProduct): ShopVariant | undefined {
  return product.variants.find((variant) => variant.availableForSale) ?? product.variants[0];
}

// ── filtering ────────────────────────────────────────────────────────────

/** What a filter needs to know about a product: values of each option that can be bought now. */
export function filterFacts(product: ShopProduct): Record<string, string[]> {
  const facts: Record<string, Set<string>> = {};

  for (const variant of product.variants) {
    if (!variant.availableForSale) continue;
    for (const option of variant.selectedOptions) (facts[option.name] ??= new Set()).add(option.value);
  }
  return Object.fromEntries(Object.entries(facts).map(([name, values]) => [name, [...values]]));
}

/**
 * Every value of every option across these products, in first-seen order —
 * the filter's choices. An option a product has only one value of ("One
 * size") is no choice, so it is left out.
 */
export function optionChoices(products: ShopProduct[]): Array<{ name: string; values: string[] }> {
  const out = new Map<string, Set<string>>();

  for (const product of products) {
    for (const option of product.options) {
      if (option.values.length < 2) continue;
      for (const value of option.values) (out.get(option.name) ?? out.set(option.name, new Set()).get(option.name)!).add(value);
    }
  }
  return [...out].map(([name, values]) => ({ name, values: [...values] }));
}

// ── the browser ──────────────────────────────────────────────────────────

/** What the bag script is told: the store's endpoint and public token, or that this is the demo shop. */
export async function storeClientConfig(): Promise<StoreClientConfig> {
  const mode = await shopMode();
  const settings = storeSettingsFromEnv();
  const store = mode === "store" && settings.origin;
  const currency = (await getProducts())[0]?.priceRange.min.currencyCode ?? "GBP";

  return {
    mode: store ? "store" : "demo",
    endpoint: store ? `${settings.origin}/api/${settings.version}/graphql.json` : null,
    publicToken: store ? settings.publicToken : null,
    checkoutDomain: store ? (settings.checkoutDomain ?? new URL(settings.origin!).host) : null,
    currency,
    locale: site.locale,
  };
}
