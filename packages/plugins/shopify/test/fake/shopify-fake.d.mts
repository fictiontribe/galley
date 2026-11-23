// Types for the fake store (shopify-fake.mjs), so the TypeScript tests can use it.
import type { Server } from "node:http";

export interface FakeCatalogue {
  shop?: { name?: string; currencyCode?: string; countryCode?: string; moneyFormat?: string };
  collections?: Array<{ handle: string; title: string; description?: string; products: string[]; image?: { url: string; altText?: string; width?: number; height?: number } }>;
  products: Array<Record<string, unknown> & { handle: string; title: string }>;
}

export interface FakeOptions {
  catalogue?: FakeCatalogue;
  tokenless?: boolean;
  storefrontPublicToken?: string;
  storefrontPrivateToken?: string;
  adminToken?: string;
  scopes?: string[];
  clientId?: string;
  clientSecret?: string;
  publications?: Array<{ id: string; title: string }>;
  publicDir?: string;
  origin?: string;
}

export interface FakeCall {
  method: string;
  path: string;
  headers: Record<string, string>;
  body: string;
}

export interface ShopifyFake {
  state: {
    calls: FakeCall[];
    scopes: string[];
    tokenless: boolean;
    carts: Map<string, unknown>;
    published: Array<{ id: string; publications: string[] }>;
    origin: string;
    throttleNext: number;
  };
  handle(request: { method: string; url: string; headers: Record<string, string>; body?: string }): Promise<{ status: number; headers: Record<string, string>; body: string | Uint8Array }>;
  fetch: typeof fetch;
  listen(port: number): Promise<Server>;
  throttle(n?: number): void;
  product(handle: string): (Record<string, unknown> & { title: string; descriptionHtml?: string; seo?: { title?: string; description?: string }; images: Array<{ altText?: string; mediaId: string }> }) | null;
  collections: Array<{ id: string; handle: string; title: string; products: string[] }>;
}

export const STABLE_VERSIONS: string[];
export const RELEASE_CANDIDATE: string;
export function createShopifyFake(options?: FakeOptions): ShopifyFake;
