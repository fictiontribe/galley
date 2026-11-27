/**
 * What the plugin asks a store, as plain functions over a connection:
 * products and collections from the Storefront API (read-only), and from
 * the Admin GraphQL API the product's editable copy, the app's granted
 * scopes, and the one write this plugin makes — product copy.
 *
 * Every field named here is on Shopify's reference for 2026-10 (read
 * 2026-11-23); no deprecated field is used (`price`, not `priceV2`;
 * `optionValues`, not `values`; `product(handle:)`, not `productByHandle`;
 * `fileUpdate` for alt text, not the deprecated `productUpdateMedia`).
 */
import type { PluginContext } from "@galleycms/plugin-kit";
import { graphql, ShopifyError, type StoreConnection } from "./client";

type Ctx = Pick<PluginContext, "fetch">;

interface Money {
  amount: string;
  currencyCode: string;
}

/** "£640", "£210 – £260": the store's own currency, written the way the store's country writes it. */
export function formatMoney(money: Money, locale = "en-GB"): string {
  const value = Number(money.amount);

  try {
    return new Intl.NumberFormat(locale, { style: "currency", currency: money.currencyCode, minimumFractionDigits: Number.isInteger(value) ? 0 : 2 }).format(value);
  } catch {
    return `${money.amount} ${money.currencyCode}`;
  }
}

function priceLine(range: { minVariantPrice: Money; maxVariantPrice: Money }): string {
  const min = formatMoney(range.minVariantPrice);
  const max = formatMoney(range.maxVariantPrice);

  return min === max ? min : `${min} – ${max}`;
}

// ── Storefront API ───────────────────────────────────────────────────────

const SUMMARY_FIELDS = `
  handle
  title
  productType
  availableForSale
  priceRange { minVariantPrice { amount currencyCode } maxVariantPrice { amount currencyCode } }
  featuredImage { url(transform: { maxWidth: 240 }) altText }
`;

interface SummaryNode {
  handle: string;
  title: string;
  productType: string;
  availableForSale: boolean;
  priceRange: { minVariantPrice: Money; maxVariantPrice: Money };
  featuredImage: { url: string; altText: string | null } | null;
}

export interface ProductSummary {
  handle: string;
  title: string;
  type: string;
  price: string;
  available: boolean;
  image: string | null;
}

function summary(node: SummaryNode): ProductSummary {
  return { handle: node.handle, title: node.title, type: node.productType, price: priceLine(node.priceRange), available: node.availableForSale, image: node.featuredImage?.url ?? null };
}

export async function shopInfo(ctx: Ctx, connection: StoreConnection, signal?: AbortSignal) {
  const result = await graphql<{ shop: { name: string; moneyFormat: string; paymentSettings: { currencyCode: string; countryCode: string }; primaryDomain: { url: string } } }>(
    ctx,
    connection,
    "storefront",
    `query ShopInfo { shop { name moneyFormat paymentSettings { currencyCode countryCode } primaryDomain { url } } }`,
    {},
    signal ? { signal } : {}
  );

  return { ...result.data.shop, answeredVersion: result.version };
}

/** Products matching the words (empty: the first few in the store's order). */
export async function searchProducts(ctx: Ctx, connection: StoreConnection, words: string, limit: number, signal?: AbortSignal): Promise<ProductSummary[]> {
  const first = Math.max(1, Math.min(limit, 50));
  const text = words.trim();

  if (!text) {
    const result = await graphql<{ products: { nodes: SummaryNode[] } }>(ctx, connection, "storefront", `query Products($first: Int!) { products(first: $first) { nodes { ${SUMMARY_FIELDS} } } }`, { first }, signal ? { signal } : {});

    return result.data.products.nodes.map(summary);
  }
  const result = await graphql<{ search: { nodes: Array<SummaryNode & { __typename: string }> } }>(
    ctx,
    connection,
    "storefront",
    `query Search($query: String!, $first: Int!) { search(query: $query, first: $first, types: [PRODUCT]) { nodes { __typename ... on Product { ${SUMMARY_FIELDS} } } } }`,
    { query: text, first },
    signal ? { signal } : {}
  );

  return result.data.search.nodes.filter((node) => node.__typename === "Product").map(summary);
}

/** One product's summary by its exact handle, or null when the store has none. */
export async function productSummary(ctx: Ctx, connection: StoreConnection, handle: string, signal?: AbortSignal): Promise<ProductSummary | null> {
  const result = await graphql<{ product: SummaryNode | null }>(ctx, connection, "storefront", `query ProductSummary($handle: String!) { product(handle: $handle) { ${SUMMARY_FIELDS} } }`, { handle }, signal ? { signal } : {});

  return result.data.product ? summary(result.data.product) : null;
}

export interface ProductDetail {
  handle: string;
  title: string;
  type: string;
  description: string;
  descriptionHtml: string;
  available: boolean;
  price: string;
  seo: { title: string | null; description: string | null };
  options: Array<{ name: string; values: string[] }>;
  variants: Array<{ title: string; sku: string | null; available: boolean; price: string; options: Record<string, string> }>;
  images: Array<{ url: string; alt: string | null }>;
  collections: string[];
}

export async function getProduct(ctx: Ctx, connection: StoreConnection, handle: string, signal?: AbortSignal): Promise<ProductDetail | null> {
  const result = await graphql<{
    product: null | {
      handle: string;
      title: string;
      productType: string;
      description: string;
      descriptionHtml: string;
      availableForSale: boolean;
      priceRange: { minVariantPrice: Money; maxVariantPrice: Money };
      seo: { title: string | null; description: string | null };
      options: Array<{ name: string; optionValues: Array<{ name: string }> }>;
      variants: { nodes: Array<{ title: string; sku: string | null; availableForSale: boolean; price: Money; selectedOptions: Array<{ name: string; value: string }> }> };
      images: { nodes: Array<{ url: string; altText: string | null }> };
      collections: { nodes: Array<{ handle: string }> };
    };
  }>(
    ctx,
    connection,
    "storefront",
    `query Product($handle: String!) {
      product(handle: $handle) {
        handle title productType description descriptionHtml availableForSale
        priceRange { minVariantPrice { amount currencyCode } maxVariantPrice { amount currencyCode } }
        seo { title description }
        options { name optionValues { name } }
        variants(first: 100) { nodes { title sku availableForSale price { amount currencyCode } selectedOptions { name value } } }
        images(first: 20) { nodes { url altText } }
        collections(first: 20) { nodes { handle } }
      }
    }`,
    { handle },
    signal ? { signal } : {}
  );
  const product = result.data.product;

  if (!product) return null;
  return {
    handle: product.handle,
    title: product.title,
    type: product.productType,
    description: product.description,
    descriptionHtml: product.descriptionHtml,
    available: product.availableForSale,
    price: priceLine(product.priceRange),
    seo: product.seo,
    options: product.options.map((option) => ({ name: option.name, values: option.optionValues.map((value) => value.name) })),
    variants: product.variants.nodes.map((variant) => ({
      title: variant.title,
      sku: variant.sku,
      available: variant.availableForSale,
      price: formatMoney(variant.price),
      options: Object.fromEntries(variant.selectedOptions.map((option) => [option.name, option.value])),
    })),
    images: product.images.nodes.map((image) => ({ url: image.url, alt: image.altText })),
    collections: product.collections.nodes.map((collection) => collection.handle),
  };
}

export interface CollectionSummary {
  handle: string;
  title: string;
  description: string;
  image: string | null;
}

export async function listCollections(ctx: Ctx, connection: StoreConnection, limit: number, signal?: AbortSignal): Promise<CollectionSummary[]> {
  const result = await graphql<{ collections: { nodes: Array<{ handle: string; title: string; description: string; image: { url: string } | null }> } }>(
    ctx,
    connection,
    "storefront",
    `query Collections($first: Int!) { collections(first: $first) { nodes { handle title description image { url(transform: { maxWidth: 240 }) } } } }`,
    { first: Math.max(1, Math.min(limit, 100)) },
    signal ? { signal } : {}
  );

  return result.data.collections.nodes.map((node) => ({ handle: node.handle, title: node.title, description: node.description, image: node.image?.url ?? null }));
}

export async function getCollection(ctx: Ctx, connection: StoreConnection, handle: string, signal?: AbortSignal): Promise<CollectionSummary | null> {
  const result = await graphql<{ collection: null | { handle: string; title: string; description: string; image: { url: string } | null } }>(
    ctx,
    connection,
    "storefront",
    `query Collection($handle: String!) { collection(handle: $handle) { handle title description image { url(transform: { maxWidth: 240 }) } } }`,
    { handle },
    signal ? { signal } : {}
  );
  const node = result.data.collection;

  return node ? { handle: node.handle, title: node.title, description: node.description, image: node.image?.url ?? null } : null;
}

/** Which of these product handles the store has (one request, aliased, at most 50 at a time). */
export async function existingHandles(ctx: Ctx, connection: StoreConnection, kind: "product" | "collection", handles: string[], signal?: AbortSignal): Promise<Set<string>> {
  const found = new Set<string>();
  const unique = [...new Set(handles)].filter((handle) => /^[a-z0-9][a-z0-9-]*$/i.test(handle));

  for (let start = 0; start < unique.length; start += 50) {
    const chunk = unique.slice(start, start + 50);
    const declarations = chunk.map((_handle, index) => `$h${index}: String!`).join(", ");
    const fields = chunk.map((_handle, index) => `h${index}: ${kind}(handle: $h${index}) { handle }`).join(" ");
    const variables = Object.fromEntries(chunk.map((handle, index) => [`h${index}`, handle]));
    const result = await graphql<Record<string, { handle: string } | null>>(ctx, connection, "storefront", `query Exists(${declarations}) { ${fields} }`, variables, signal ? { signal } : {});

    for (const value of Object.values(result.data)) if (value?.handle) found.add(value.handle);
  }
  return found;
}

// ── Admin GraphQL API ────────────────────────────────────────────────────

const issued = new Map<string, { token: string; expires: number }>();

/**
 * The Admin token to use: the one pasted into settings, or one issued for
 * the Dev Dashboard app's client ID and secret (valid 24 hours; kept until
 * five minutes before it runs out).
 */
export async function adminToken(ctx: Ctx, connection: StoreConnection, now = Date.now(), signal?: AbortSignal): Promise<string> {
  if (connection.admin.token) return connection.admin.token;
  const { clientId, clientSecret } = connection.admin;

  if (!clientId || !clientSecret) throw new ShopifyError("unconfigured", "Editing product copy needs an Admin API token, or the store app's client ID and client secret, in the Shopify plugin's settings.");
  const key = `${connection.origin} ${clientId}`;
  const cached = issued.get(key);

  if (cached && cached.expires > now) return cached.token;
  let response: Response;

  try {
    response = await ctx.fetch(`${connection.origin}/admin/oauth/access_token`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
      body: new URLSearchParams({ grant_type: "client_credentials", client_id: clientId, client_secret: clientSecret }).toString(),
      ...(signal ? { signal } : {}),
    });
  } catch {
    throw new ShopifyError("unavailable", `Couldn't reach ${connection.host} to sign in. Check the address and the internet connection.`);
  }
  const body = (await response.json().catch(() => null)) as { access_token?: string; expires_in?: number; error?: string } | null;

  if (!response.ok || !body?.access_token) {
    throw new ShopifyError(
      "auth",
      response.status === 400 || response.status === 401
        ? `${connection.host} didn't accept the app's client ID and secret. The app and the store have to belong to the same organisation in the Dev Dashboard, and the app has to be installed on the store.`
        : `${connection.host} didn't issue an Admin token (it answered ${response.status}).`,
      `oauth ${response.status} ${body?.error ?? ""}`
    );
  }
  issued.set(key, { token: body.access_token, expires: now + Math.max(60, (body.expires_in ?? 86399) - 300) * 1000 });
  return body.access_token;
}

export async function accessScopes(ctx: Ctx, connection: StoreConnection, signal?: AbortSignal): Promise<string[]> {
  const token = await adminToken(ctx, connection, Date.now(), signal);
  const result = await graphql<{ currentAppInstallation: { accessScopes: Array<{ handle: string }> } }>(
    ctx,
    connection,
    "admin",
    `query Scopes { currentAppInstallation { accessScopes { handle } } }`,
    {},
    { adminToken: token, ...(signal ? { signal } : {}) }
  );

  return result.data.currentAppInstallation.accessScopes.map((scope) => scope.handle);
}

export interface ProductCopy {
  id: string;
  handle: string;
  title: string;
  descriptionHtml: string;
  seoTitle: string;
  seoDescription: string;
  images: Array<{ position: number; id: string; alt: string; url: string }>;
}

const COPY_FIELDS = `id handle title descriptionHtml seo { title description } media(first: 50) { nodes { ... on MediaImage { id alt image { url } } } }`;

interface AdminProductNode {
  id: string;
  handle: string;
  title: string;
  descriptionHtml: string;
  seo: { title: string | null; description: string | null };
  media: { nodes: Array<{ id?: string; alt?: string | null; image?: { url: string } | null }> };
}

function copyOf(node: AdminProductNode): ProductCopy {
  return {
    id: node.id,
    handle: node.handle,
    title: node.title,
    descriptionHtml: node.descriptionHtml,
    seoTitle: node.seo.title ?? "",
    seoDescription: node.seo.description ?? "",
    images: node.media.nodes.filter((media) => media.id).map((media, index) => ({ position: index + 1, id: media.id!, alt: media.alt ?? "", url: media.image?.url ?? "" })),
  };
}

export async function productCopy(ctx: Ctx, connection: StoreConnection, handle: string, token: string, signal?: AbortSignal): Promise<ProductCopy | null> {
  const result = await graphql<{ productByIdentifier: AdminProductNode | null }>(
    ctx,
    connection,
    "admin",
    `query ProductCopy($identifier: ProductIdentifierInput!) { productByIdentifier(identifier: $identifier) { ${COPY_FIELDS} } }`,
    { identifier: { handle } },
    { adminToken: token, ...(signal ? { signal } : {}) }
  );

  return result.data.productByIdentifier ? copyOf(result.data.productByIdentifier) : null;
}

export interface CopyChange {
  title?: string;
  descriptionHtml?: string;
  seoTitle?: string;
  seoDescription?: string;
  /** By picture position (1 = the first picture). */
  imageAlts?: Array<{ position: number; alt: string }>;
}

/**
 * Changes a product's copy and nothing else: productUpdate with only id,
 * title, descriptionHtml and seo, then fileUpdate with only id and alt for
 * pictures. Price, stock, status, handle and deletion are not reachable from here.
 */
export async function updateCopy(ctx: Ctx, connection: StoreConnection, before: ProductCopy, change: CopyChange, token: string, signal?: AbortSignal): Promise<void> {
  const product: Record<string, unknown> = { id: before.id };

  if (change.title !== undefined) product.title = change.title;
  if (change.descriptionHtml !== undefined) product.descriptionHtml = change.descriptionHtml;
  if (change.seoTitle !== undefined || change.seoDescription !== undefined) {
    product.seo = { title: change.seoTitle ?? before.seoTitle, description: change.seoDescription ?? before.seoDescription };
  }
  if (Object.keys(product).length > 1) {
    const result = await graphql<{ productUpdate: { userErrors: Array<{ field: string[] | null; message: string }> } }>(
      ctx,
      connection,
      "admin",
      `mutation UpdateCopy($product: ProductUpdateInput!) { productUpdate(product: $product) { product { id } userErrors { field message } } }`,
      { product },
      { adminToken: token, ...(signal ? { signal } : {}) }
    );
    const errors = result.data.productUpdate.userErrors;

    if (errors.length) throw new ShopifyError("invalid", `${connection.host} didn't take the change: ${errors.map((error) => error.message).join("; ")}.`);
  }
  if (change.imageAlts?.length) {
    const files = change.imageAlts.map((item) => {
      const image = before.images.find((candidate) => candidate.position === item.position);

      if (!image) throw new ShopifyError("invalid", `The product has ${before.images.length} pictures, so there's no picture ${item.position}.`);
      return { id: image.id, alt: item.alt };
    });
    const result = await graphql<{ fileUpdate: { userErrors: Array<{ message: string }> } }>(
      ctx,
      connection,
      "admin",
      `mutation UpdateAlt($files: [FileUpdateInput!]!) { fileUpdate(files: $files) { files { id alt } userErrors { code field message } } }`,
      { files },
      { adminToken: token, ...(signal ? { signal } : {}) }
    );
    const errors = result.data.fileUpdate.userErrors;

    if (errors.length) throw new ShopifyError("invalid", `${connection.host} didn't take the picture descriptions: ${errors.map((error) => error.message).join("; ")}.`);
  }
}
