// Reading the shop when the site is built: the store's Storefront API when
// one is connected, the demo catalogue when not. Runs in Node only (the
// content loader and the pages that read its collections).
//
// Which store: SHOPIFY_STORE_DOMAIN, else `domain` in src/data/shop/store.json.
// An empty domain means the demo shop. A configured store that can't be
// read fails the build with a plain message: the site never falls back to
// demo products when it is meant to sell real ones.
//
// The Storefront API (shopify.dev, API version 2026-10, read 2026-11-23):
// POST https://<store>/api/<version>/graphql.json. Without a token it reads
// products, collections and carts, with a query complexity limit of 1,000,
// so products are fetched a few at a time. SHOPIFY_STOREFRONT_PRIVATE_TOKEN
// (build only, never written to a file) or a public token lift that limit.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import storeSettings from "../../data/shop/store.json";
import type { Money, ShopCollection, ShopData, ShopImage, ShopProduct, ShopVariant } from "./types";

const DEFAULT_VERSION = "2026-10";

export interface StoreSettings {
  origin: string | null;
  version: string;
  publicToken: string | null;
  privateToken: string | null;
  checkoutDomain: string | null;
}

/** "your-store", "your-store.myshopify.com" or a full address, as an origin. Plain http only for this computer. */
export function storeOrigin(input: string): string {
  const raw = input.trim();

  if (/^[a-z0-9][a-z0-9-]*$/i.test(raw)) return `https://${raw.toLowerCase()}.myshopify.com`;
  const url = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);

  if (url.protocol === "http:" && url.hostname !== "127.0.0.1" && url.hostname !== "localhost") {
    throw new Error(`The store address “${raw}” must start with https:// (src/data/shop/store.json).`);
  }
  return `${url.protocol}//${url.host}`;
}

export function storeSettingsFromEnv(env: Record<string, string | undefined> = process.env): StoreSettings {
  const domain = (env.SHOPIFY_STORE_DOMAIN ?? storeSettings.domain ?? "").trim();
  const version = (storeSettings.apiVersion || DEFAULT_VERSION).trim();

  if (!/^\d{4}-(01|04|07|10)$/.test(version)) throw new Error(`“${version}” in src/data/shop/store.json isn't a Storefront API version. Versions look like ${DEFAULT_VERSION}.`);
  return {
    origin: domain ? storeOrigin(domain) : null,
    version,
    publicToken: (env.PUBLIC_SHOPIFY_STOREFRONT_TOKEN ?? storeSettings.publicToken ?? "").trim() || null,
    privateToken: (env.SHOPIFY_STOREFRONT_PRIVATE_TOKEN ?? "").trim() || null,
    checkoutDomain: (storeSettings.checkoutDomain ?? "").trim() || null,
  };
}

// ── the demo catalogue ───────────────────────────────────────────────────

interface CatalogueImage {
  url: string;
  altText?: string;
  width?: number;
  height?: number;
}

interface CatalogueFile {
  shop: { name: string; currencyCode: string; countryCode?: string };
  collections: Array<{ handle: string; title: string; description?: string; image?: CatalogueImage; products: string[] }>;
  products: Array<{
    handle: string;
    title: string;
    description?: string;
    descriptionHtml?: string;
    productType?: string;
    vendor?: string;
    tags?: string[];
    seo?: { title?: string; description?: string };
    options?: Array<{ name: string; values: string[] }>;
    images?: CatalogueImage[];
    variants: Array<{ sku?: string; title?: string; selectedOptions: Array<{ name: string; value: string }>; price: Money; compareAtPrice?: Money | null; availableForSale?: boolean; image?: number }>;
  }>;
}

/** The smaller copy `npm run sizes` makes beside a demo photograph, when it is there. */
function localSizes(url: string): Array<[string, number]> {
  if (!url.startsWith("/images/")) return [];
  const small = url.replace(/^\/images\//, "/images/_sizes/").replace(/\.(webp|jpe?g|png)$/, "-640.webp");

  return existsSync(join(process.cwd(), "public", small)) ? [[small, 640]] : [];
}

function demoImage(image: CatalogueImage): ShopImage {
  return { url: image.url, altText: image.altText ?? "", width: image.width ?? 1600, height: image.height ?? 2000, sizes: localSizes(image.url) };
}

function priceRange(variants: ShopVariant[], currencyCode: string): { min: Money; max: Money } {
  const amounts = variants.map((variant) => Number(variant.price.amount));
  const money = (value: number): Money => ({ amount: value.toFixed(2), currencyCode });

  return amounts.length ? { min: money(Math.min(...amounts)), max: money(Math.max(...amounts)) } : { min: money(0), max: money(0) };
}

export function fromCatalogue(file: CatalogueFile): ShopData {
  const currency = file.shop.currencyCode;
  const products: ShopProduct[] = file.products.map((product) => {
    const variants: ShopVariant[] = product.variants.map((variant, index) => ({
      // Demo ids are stable and plainly not a store's: the bag keeps them in demo mode only.
      id: `demo:${product.handle}:${index}`,
      title: variant.title ?? variant.selectedOptions.map((option) => option.value).join(" / "),
      sku: variant.sku ?? null,
      availableForSale: variant.availableForSale !== false,
      price: { amount: variant.price.amount, currencyCode: variant.price.currencyCode ?? currency },
      compareAtPrice: variant.compareAtPrice ?? null,
      selectedOptions: variant.selectedOptions,
      image: typeof variant.image === "number" ? variant.image : null,
    }));

    return {
      id: `demo:${product.handle}`,
      handle: product.handle,
      title: product.title,
      description: product.description ?? "",
      descriptionHtml: product.descriptionHtml ?? "",
      productType: product.productType ?? "",
      vendor: product.vendor ?? file.shop.name,
      tags: product.tags ?? [],
      seo: { title: product.seo?.title ?? null, description: product.seo?.description ?? null },
      options: product.options ?? [],
      images: (product.images ?? []).map(demoImage),
      variants,
      availableForSale: variants.some((variant) => variant.availableForSale),
      priceRange: priceRange(variants, currency),
      collections: file.collections.filter((collection) => collection.products.includes(product.handle)).map((collection) => collection.handle),
    };
  });
  const collections: ShopCollection[] = file.collections.map((collection) => ({
    id: `demo:${collection.handle}`,
    handle: collection.handle,
    title: collection.title,
    description: collection.description ?? "",
    image: collection.image ? demoImage(collection.image) : null,
    products: collection.products.filter((handle) => products.some((product) => product.handle === handle)),
  }));

  return { mode: "demo", shop: { name: file.shop.name, currencyCode: currency, countryCode: file.shop.countryCode ?? "GB" }, products, collections };
}

// ── a store ──────────────────────────────────────────────────────────────

async function storefront<T>(settings: StoreSettings, query: string, variables: Record<string, unknown>, fetcher: typeof fetch): Promise<T> {
  const headers: Record<string, string> = { "content-type": "application/json", accept: "application/json" };

  // A build is not a shopper's visit, so no Shopify-Storefront-Buyer-IP header.
  if (settings.privateToken) headers["shopify-storefront-private-token"] = settings.privateToken;
  else if (settings.publicToken) headers["x-shopify-storefront-access-token"] = settings.publicToken;
  const host = new URL(settings.origin!).host;
  let response: Response;

  try {
    response = await fetcher(`${settings.origin}/api/${settings.version}/graphql.json`, { method: "POST", headers, body: JSON.stringify({ query, variables }) });
  } catch {
    throw new Error(`The shop couldn't reach ${host} to read its products. Check the address in src/data/shop/store.json and the connection, or empty the domain to build the demo shop.`);
  }
  const body = (await response.json().catch(() => null)) as { data?: T; errors?: Array<{ message?: string; extensions?: { code?: string } }> } | null;

  if (response.status === 401) throw new Error(`${host} didn't accept the Storefront API token. Check it, or remove it to read the store without one.`);
  if (response.status === 404) throw new Error(`There's no store at ${host}. Check the domain in src/data/shop/store.json.`);
  if (!response.ok || !body || body.errors?.length || !body.data) {
    const codes = (body?.errors ?? []).map((error) => error.extensions?.code).filter(Boolean).join(", ");

    throw new Error(`${host} couldn't answer the shop's question (${response.status}${codes ? `, ${codes}` : ""}). ${codes.includes("ACCESS_DENIED") ? "The store needs a Storefront API token for this." : ""}`.trim());
  }
  const answered = response.headers.get("x-shopify-api-version");

  if (answered && answered !== settings.version) console.warn(`[shop] ${host} answered with API version ${answered}, not ${settings.version}: the version in src/data/shop/store.json is no longer supported.`);
  return body.data;
}

const IMAGE_FIELDS = `url altText width height small: url(transform: { maxWidth: 640 }) medium: url(transform: { maxWidth: 1200 })`;

interface StoreImage {
  url: string;
  altText: string | null;
  width: number | null;
  height: number | null;
  small: string;
  medium: string;
}

function storeImage(image: StoreImage): ShopImage {
  return {
    url: image.url,
    altText: image.altText ?? "",
    width: image.width ?? 1600,
    height: image.height ?? 2000,
    sizes: [
      [image.small, 640],
      [image.medium, 1200],
    ],
  };
}

const PRODUCT_QUERY = `query ShopProduct($handle: String!) {
  product(handle: $handle) {
    id handle title description descriptionHtml productType vendor availableForSale
    seo { title description }
    options { name optionValues { name } }
    images(first: 10) { nodes { ${IMAGE_FIELDS} } }
    variants(first: 50) { nodes { id title sku availableForSale price { amount currencyCode } compareAtPrice { amount currencyCode } selectedOptions { name value } image { url } } }
  }
}`;

interface StoreProductNode {
  id: string;
  handle: string;
  title: string;
  description: string;
  descriptionHtml: string;
  productType: string;
  vendor: string;
  availableForSale: boolean;
  seo: { title: string | null; description: string | null };
  options: Array<{ name: string; optionValues: Array<{ name: string }> }>;
  images: { nodes: StoreImage[] };
  variants: { nodes: Array<{ id: string; title: string; sku: string | null; availableForSale: boolean; price: Money; compareAtPrice: Money | null; selectedOptions: Array<{ name: string; value: string }>; image: { url: string } | null }> };
}

export async function fromStore(settings: StoreSettings, fetcher: typeof fetch = fetch): Promise<ShopData> {
  const shop = await storefront<{ shop: { name: string; paymentSettings: { currencyCode: string; countryCode: string } } }>(settings, `query ShopName { shop { name paymentSettings { currencyCode countryCode } } }`, {}, fetcher);
  const handles: string[] = [];

  for (let after: string | null = null, page = 0; page < 40; page++) {
    const result: { products: { nodes: Array<{ handle: string }>; pageInfo: { hasNextPage: boolean; endCursor: string | null } } } = await storefront(
      settings,
      `query ShopHandles($after: String) { products(first: 100, after: $after) { nodes { handle } pageInfo { hasNextPage endCursor } } }`,
      { after },
      fetcher
    );

    handles.push(...result.products.nodes.map((node) => node.handle));
    if (!result.products.pageInfo.hasNextPage) break;
    after = result.products.pageInfo.endCursor;
  }
  // One product a request keeps each request well inside the tokenless complexity limit.
  const nodes: StoreProductNode[] = [];

  for (const handle of handles) {
    const result = await storefront<{ product: StoreProductNode | null }>(settings, PRODUCT_QUERY, { handle }, fetcher);

    if (result.product) nodes.push(result.product);
  }
  const collectionList = await storefront<{ collections: { nodes: Array<{ id: string; handle: string; title: string; description: string; image: StoreImage | null }> } }>(
    settings,
    `query ShopCollections { collections(first: 50) { nodes { id handle title description image { ${IMAGE_FIELDS} } } } }`,
    {},
    fetcher
  );
  const collections: ShopCollection[] = [];

  for (const node of collectionList.collections.nodes) {
    const members = await storefront<{ collection: { products: { nodes: Array<{ handle: string }> } } | null }>(
      settings,
      `query ShopCollectionProducts($handle: String!) { collection(handle: $handle) { products(first: 100) { nodes { handle } } } }`,
      { handle: node.handle },
      fetcher
    );

    collections.push({
      id: node.id,
      handle: node.handle,
      title: node.title,
      description: node.description,
      image: node.image ? storeImage(node.image) : null,
      products: (members.collection?.products.nodes ?? []).map((product) => product.handle).filter((handle) => handles.includes(handle)),
    });
  }
  const currency = shop.shop.paymentSettings.currencyCode;
  const products: ShopProduct[] = nodes.map((node) => {
    const images = node.images.nodes.map(storeImage);
    const variants: ShopVariant[] = node.variants.nodes.map((variant) => {
      const at = variant.image ? node.images.nodes.findIndex((image) => image.url === variant.image!.url) : -1;

      return {
        id: variant.id,
        title: variant.title,
        sku: variant.sku,
        availableForSale: variant.availableForSale,
        price: variant.price,
        compareAtPrice: variant.compareAtPrice,
        selectedOptions: variant.selectedOptions,
        image: at >= 0 ? at : null,
      };
    });

    return {
      id: node.id,
      handle: node.handle,
      title: node.title,
      description: node.description,
      descriptionHtml: node.descriptionHtml,
      productType: node.productType,
      vendor: node.vendor,
      tags: [],
      seo: node.seo,
      options: node.options.map((option) => ({ name: option.name, values: option.optionValues.map((value) => value.name) })),
      images,
      variants,
      availableForSale: node.availableForSale,
      priceRange: priceRange(variants, currency),
      collections: collections.filter((collection) => collection.products.includes(node.handle)).map((collection) => collection.handle),
    };
  });

  return { mode: "store", shop: { name: shop.shop.name, currencyCode: currency, countryCode: shop.shop.paymentSettings.countryCode }, products, collections };
}

let loading: Promise<ShopData> | null = null;

/** The shop's data, read once per build (both collections' loaders share it). */
export function loadShop(): Promise<ShopData> {
  loading ??= (async () => {
    const settings = storeSettingsFromEnv();

    if (!settings.origin) {
      const file = JSON.parse(readFileSync(join(process.cwd(), "src/data/shop/catalogue.json"), "utf8")) as CatalogueFile;

      return fromCatalogue(file);
    }
    return fromStore(settings);
  })();
  return loading;
}
