// The shop's data, in one shape whichever way it arrived: from a store's
// Storefront API at build time (src/lib/shop/store.ts) or from the demo
// catalogue (src/data/shop/catalogue.json) when no store is connected.

export interface Money {
  /** A decimal string, as the Storefront API sends it: "640.00". */
  amount: string;
  currencyCode: string;
}

export interface ShopImage {
  /** Absolute (a store's CDN) or from the site root (the demo catalogue). */
  url: string;
  altText: string;
  width: number;
  height: number;
  /** Smaller copies for srcset: [url, width]. */
  sizes: Array<[string, number]>;
}

export interface ShopVariant {
  id: string;
  title: string;
  sku: string | null;
  availableForSale: boolean;
  price: Money;
  compareAtPrice: Money | null;
  selectedOptions: Array<{ name: string; value: string }>;
  /** Index into the product's images: the picture of this variant (a colour). */
  image: number | null;
}

export interface ShopProduct {
  id: string;
  handle: string;
  title: string;
  description: string;
  descriptionHtml: string;
  productType: string;
  vendor: string;
  tags: string[];
  seo: { title: string | null; description: string | null };
  options: Array<{ name: string; values: string[] }>;
  images: ShopImage[];
  variants: ShopVariant[];
  availableForSale: boolean;
  priceRange: { min: Money; max: Money };
  /** Handles of the collections it is in, in the store's order. */
  collections: string[];
}

export interface ShopCollection {
  id: string;
  handle: string;
  title: string;
  description: string;
  image: ShopImage | null;
  /** Product handles, in the collection's order. */
  products: string[];
}

export interface ShopData {
  /** "demo": the bundled catalogue, nothing can be bought. "store": a real store. */
  mode: "demo" | "store";
  shop: { name: string; currencyCode: string; countryCode: string };
  products: ShopProduct[];
  collections: ShopCollection[];
}

/** What the browser needs to talk to the store (nothing secret: a public token is meant to be seen). */
export interface StoreClientConfig {
  mode: "demo" | "store";
  /** "https://your-store.myshopify.com/api/2026-10/graphql.json" when connected. */
  endpoint: string | null;
  publicToken: string | null;
  /** For the customer-privacy hand-off: the store's checkout and storefront domains. */
  checkoutDomain: string | null;
  currency: string;
  locale: string;
}
