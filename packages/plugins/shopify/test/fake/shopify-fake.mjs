// A strict local stand-in for one store's Storefront API, Admin GraphQL API
// and client-credentials token endpoint, built from the documented shapes
// (shopify.dev, API version 2026-10, read 2026-11-23 — see docs/shopify.md
// for every page). It answers over a real HTTP port (for the browser and the
// seed script) or as a `fetch` (for unit tests). Nothing here talks to the
// network.
//
// What it is strict about: the path and version, the auth header for each
// API, fields that exist on each type (deprecated ones refused), arguments,
// declared variables, fields tokenless access can't read, the tokenless
// complexity limit (1,000), Admin access scopes, Admin's cost bucket
// (THROTTLED), and HTML-only checkout links. What it simplifies: search is
// a case-insensitive substring match, sorting follows the catalogue order.
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { connection, GraphQLError, run } from "./graphql.mjs";

export const STABLE_VERSIONS = ["2026-01", "2026-04", "2026-07", "2026-10"];
export const RELEASE_CANDIDATE = "2027-01";
const TOKENLESS_LIMIT = 1000;

const conn = (node) => ({
  edges: { type: `[${node}Edge!]!` },
  nodes: { type: `[${node}!]!` },
  pageInfo: { type: "PageInfo!" },
});
const edge = (node) => ({ node: { type: `${node}!` }, cursor: { type: "String!" } });
const pageInfo = { hasNextPage: { type: "Boolean!" }, hasPreviousPage: { type: "Boolean!" }, startCursor: { type: "String" }, endCursor: { type: "String" } };

/** Fields tokenless access can't read (shopify.dev/docs/api/storefront, "Tokenless access"). */
function needsToken(what) {
  return (selection, context) => {
    if (context.access === "tokenless") throw new GraphQLError(`Access denied for ${selection.name} field. ${what} needs a Storefront API access token.`, "ACCESS_DENIED");
  };
}

// ── Storefront API schema (the parts a storefront uses) ────────────────────
const storefront = {
  QueryRoot: {
    shop: { type: "Shop!" },
    product: { type: "Product", args: ["handle", "id"] },
    products: { type: "ProductConnection!", args: ["first", "after", "last", "before", "query", "sortKey", "reverse"] },
    collection: { type: "Collection", args: ["handle", "id"] },
    collections: { type: "CollectionConnection!", args: ["first", "after", "query", "sortKey", "reverse"] },
    search: { type: "SearchResultItemConnection!", args: ["query", "first", "after", "types", "productFilters", "prefix", "unavailableProducts", "sortKey", "reverse"] },
    cart: { type: "Cart", args: ["id"] },
    productByHandle: { type: "Product", args: ["handle"], deprecated: "use product(handle:)" },
  },
  Mutation: {
    cartCreate: { type: "CartCreatePayload", args: ["input"] },
    cartLinesAdd: { type: "CartLinesAddPayload", args: ["cartId", "lines"] },
    cartLinesUpdate: { type: "CartLinesUpdatePayload", args: ["cartId", "lines"] },
    cartLinesRemove: { type: "CartLinesRemovePayload", args: ["cartId", "lineIds"] },
  },
  Shop: { name: { type: "String!" }, primaryDomain: { type: "Domain!" }, paymentSettings: { type: "PaymentSettings!" }, moneyFormat: { type: "String!" } },
  Domain: { url: { type: "URL!" }, host: { type: "String!" } },
  PaymentSettings: { currencyCode: { type: "CurrencyCode!" }, countryCode: { type: "CountryCode!" } },
  Product: {
    id: { type: "ID!" },
    handle: { type: "String!" },
    title: { type: "String!" },
    description: { type: "String!", args: ["truncateAt"] },
    descriptionHtml: { type: "HTML!" },
    vendor: { type: "String!" },
    productType: { type: "String!" },
    tags: { type: "[String!]!", check: needsToken("Product tags") },
    availableForSale: { type: "Boolean!" },
    featuredImage: { type: "Image" },
    images: { type: "ImageConnection!", args: ["first", "after", "sortKey", "reverse"] },
    options: { type: "[ProductOption!]!", args: ["first"] },
    variants: { type: "ProductVariantConnection!", args: ["first", "after", "sortKey", "reverse"] },
    variantsCount: { type: "Count" },
    priceRange: { type: "ProductPriceRange!" },
    compareAtPriceRange: { type: "ProductPriceRange!" },
    seo: { type: "SEO!" },
    selectedOrFirstAvailableVariant: { type: "ProductVariant", args: ["selectedOptions", "ignoreUnknownOptions", "caseInsensitiveMatch"] },
    onlineStoreUrl: { type: "URL" },
    updatedAt: { type: "DateTime!" },
    collections: { type: "CollectionConnection!", args: ["first", "after"] },
    requiresSellingPlan: { type: "Boolean!" },
    metafield: { type: "Metafield", args: ["namespace", "key"], check: needsToken("Metafields") },
  },
  Count: { count: { type: "Int!" }, precision: { type: "String!" } },
  Metafield: { value: { type: "String!" }, type: { type: "String!" } },
  ProductOption: { id: { type: "ID!" }, name: { type: "String!" }, optionValues: { type: "[ProductOptionValue!]!" }, values: { type: "[String!]!", deprecated: "use optionValues" } },
  ProductOptionValue: { id: { type: "ID!" }, name: { type: "String!" }, swatch: { type: "ProductOptionValueSwatch" }, firstSelectableVariant: { type: "ProductVariant" } },
  ProductOptionValueSwatch: { color: { type: "Color" } },
  ProductVariant: {
    id: { type: "ID!" },
    title: { type: "String!" },
    sku: { type: "String" },
    availableForSale: { type: "Boolean!" },
    currentlyNotInStock: { type: "Boolean!" },
    quantityAvailable: { type: "Int", check: needsToken("Stock counts") },
    price: { type: "MoneyV2!" },
    compareAtPrice: { type: "MoneyV2" },
    priceV2: { type: "MoneyV2!", deprecated: "use price" },
    compareAtPriceV2: { type: "MoneyV2", deprecated: "use compareAtPrice" },
    selectedOptions: { type: "[SelectedOption!]!" },
    image: { type: "Image" },
    product: { type: "Product!" },
    requiresShipping: { type: "Boolean!" },
  },
  SelectedOption: { name: { type: "String!" }, value: { type: "String!" } },
  MoneyV2: { amount: { type: "Decimal!" }, currencyCode: { type: "CurrencyCode!" } },
  ProductPriceRange: { minVariantPrice: { type: "MoneyV2!" }, maxVariantPrice: { type: "MoneyV2!" } },
  SEO: { title: { type: "String" }, description: { type: "String" } },
  Image: {
    id: { type: "ID" },
    url: { type: "URL!", args: ["transform"] },
    altText: { type: "String" },
    width: { type: "Int" },
    height: { type: "Int" },
    thumbhash: { type: "String" },
    originalSrc: { type: "URL!", deprecated: "use url" },
    src: { type: "URL!", deprecated: "use url" },
    transformedSrc: { type: "URL!", deprecated: "use url(transform:)" },
  },
  Collection: {
    id: { type: "ID!" },
    handle: { type: "String!" },
    title: { type: "String!" },
    description: { type: "String!" },
    descriptionHtml: { type: "HTML!" },
    image: { type: "Image" },
    seo: { type: "SEO!" },
    updatedAt: { type: "DateTime!" },
    onlineStoreUrl: { type: "URL" },
    products: { type: "ProductConnection!", args: ["first", "after", "filters", "sortKey", "reverse"] },
  },
  ProductConnection: { ...conn("Product"), filters: { type: "[Filter!]!" } },
  ProductEdge: edge("Product"),
  ProductVariantConnection: conn("ProductVariant"),
  ProductVariantEdge: edge("ProductVariant"),
  ImageConnection: conn("Image"),
  ImageEdge: edge("Image"),
  CollectionConnection: conn("Collection"),
  CollectionEdge: edge("Collection"),
  SearchResultItemConnection: { ...conn("SearchResultItem"), totalCount: { type: "Int!" }, productFilters: { type: "[Filter!]!" } },
  SearchResultItemEdge: edge("SearchResultItem"),
  SearchResultItem: { __possible: ["Product"] },
  Filter: { id: { type: "String!" }, label: { type: "String!" }, type: { type: "FilterType!" }, values: { type: "[FilterValue!]!" } },
  FilterValue: { id: { type: "String!" }, label: { type: "String!" }, count: { type: "Int!" }, input: { type: "JSON!" } },
  PageInfo: pageInfo,
  Cart: {
    id: { type: "ID!" },
    checkoutUrl: { type: "URL!" },
    totalQuantity: { type: "Int!" },
    cost: { type: "CartCost!" },
    lines: { type: "BaseCartLineConnection!", args: ["first", "after"] },
    note: { type: "String" },
    createdAt: { type: "DateTime!" },
    updatedAt: { type: "DateTime!" },
    estimatedCost: { type: "CartCost!", deprecated: "use cost" },
  },
  CartCost: {
    subtotalAmount: { type: "MoneyV2!" },
    totalAmount: { type: "MoneyV2!" },
    checkoutChargeAmount: { type: "MoneyV2!" },
    subtotalAmountEstimated: { type: "Boolean!" },
    totalAmountEstimated: { type: "Boolean!" },
    totalTaxAmount: { type: "MoneyV2", deprecated: "taxes are shown at checkout" },
    totalDutyAmount: { type: "MoneyV2", deprecated: "duties are shown at checkout" },
  },
  BaseCartLineConnection: conn("CartLine"),
  CartLineEdge: edge("CartLine"),
  CartLine: { id: { type: "ID!" }, quantity: { type: "Int!" }, merchandise: { type: "Merchandise!" }, cost: { type: "CartLineCost!" }, estimatedCost: { type: "CartLineCost!", deprecated: "use cost" } },
  Merchandise: { __possible: ["ProductVariant"] },
  CartLineCost: { amountPerQuantity: { type: "MoneyV2!" }, compareAtAmountPerQuantity: { type: "MoneyV2" }, subtotalAmount: { type: "MoneyV2!" }, totalAmount: { type: "MoneyV2!" } },
  CartCreatePayload: { cart: { type: "Cart" }, userErrors: { type: "[CartUserError!]!" }, warnings: { type: "[CartWarning!]!" } },
  CartLinesAddPayload: { cart: { type: "Cart" }, userErrors: { type: "[CartUserError!]!" }, warnings: { type: "[CartWarning!]!" } },
  CartLinesUpdatePayload: { cart: { type: "Cart" }, userErrors: { type: "[CartUserError!]!" }, warnings: { type: "[CartWarning!]!" } },
  CartLinesRemovePayload: { cart: { type: "Cart" }, userErrors: { type: "[CartUserError!]!" }, warnings: { type: "[CartWarning!]!" } },
  CartUserError: { code: { type: "CartErrorCode" }, field: { type: "[String!]" }, message: { type: "String!" } },
  CartWarning: { code: { type: "CartWarningCode!" }, message: { type: "String!" }, target: { type: "ID!" } },
};
storefront.Product.__possible = ["Product"];

// ── Admin GraphQL schema (product copy, scopes, the seed script) ───────────
function needsScope(scope) {
  return (selection, context) => {
    if (!context.scopes.includes(scope)) {
      throw new GraphQLError(`Access denied for ${selection.name} field. Required access: \`${scope}\` access scope.`, "ACCESS_DENIED", { requiredAccess: `\`${scope}\` access scope.` });
    }
  };
}

const admin = {
  QueryRoot: {
    shop: { type: "Shop!" },
    productByIdentifier: { type: "Product", args: ["identifier"], check: needsScope("read_products") },
    product: { type: "Product", args: ["id"], check: needsScope("read_products") },
    products: { type: "ProductConnection!", args: ["first", "after", "query"], check: needsScope("read_products") },
    collections: { type: "CollectionConnection!", args: ["first", "after", "query"], check: needsScope("read_products") },
    currentAppInstallation: { type: "AppInstallation!" },
    publications: { type: "PublicationConnection!", args: ["first", "after", "catalogType"], check: needsScope("read_publications") },
  },
  Mutation: {
    productUpdate: { type: "ProductUpdatePayload", args: ["product", "media", "identifier"], check: needsScope("write_products") },
    fileUpdate: { type: "FileUpdatePayload", args: ["files"], check: needsScope("write_files") },
    productSet: { type: "ProductSetPayload", args: ["input", "synchronous", "identifier"], check: needsScope("write_products") },
    collectionCreate: { type: "CollectionCreatePayload", args: ["collection"], check: needsScope("write_products") },
    publishablePublish: { type: "PublishablePublishPayload", args: ["id", "input"], check: needsScope("write_publications") },
  },
  Shop: { name: { type: "String!" }, myshopifyDomain: { type: "String!" }, currencyCode: { type: "CurrencyCode!" } },
  Product: {
    id: { type: "ID!" },
    handle: { type: "String!" },
    title: { type: "String!" },
    descriptionHtml: { type: "HTML!" },
    seo: { type: "SEO!" },
    status: { type: "ProductStatus!" },
    updatedAt: { type: "DateTime!" },
    media: { type: "MediaConnection!", args: ["first", "after"] },
    images: { type: "ImageConnection!", args: ["first"], deprecated: "use media" },
  },
  SEO: { title: { type: "String" }, description: { type: "String" } },
  MediaConnection: conn("Media"),
  MediaEdge: edge("Media"),
  Media: { __possible: ["MediaImage"], id: { type: "ID!" }, alt: { type: "String" }, mediaContentType: { type: "MediaContentType!" } },
  MediaImage: { id: { type: "ID!" }, alt: { type: "String" }, image: { type: "Image" }, status: { type: "MediaStatus!" }, mediaContentType: { type: "MediaContentType!" } },
  File: { __possible: ["MediaImage"], id: { type: "ID!" }, alt: { type: "String" } },
  Image: { url: { type: "URL!" }, altText: { type: "String" }, width: { type: "Int" }, height: { type: "Int" } },
  ImageConnection: conn("Image"),
  ImageEdge: edge("Image"),
  ProductConnection: conn("Product"),
  ProductEdge: edge("Product"),
  Collection: { id: { type: "ID!" }, handle: { type: "String!" }, title: { type: "String!" } },
  CollectionConnection: conn("Collection"),
  CollectionEdge: edge("Collection"),
  AppInstallation: { accessScopes: { type: "[AccessScope!]!" } },
  AccessScope: { handle: { type: "String!" }, description: { type: "String!" } },
  Publication: { id: { type: "ID!" }, autoPublish: { type: "Boolean!" }, catalog: { type: "Catalog" }, name: { type: "String!", deprecated: "use catalog" } },
  Catalog: { id: { type: "ID!" }, title: { type: "String!" }, status: { type: "CatalogStatus!" } },
  PublicationConnection: conn("Publication"),
  PublicationEdge: edge("Publication"),
  PageInfo: pageInfo,
  UserError: { field: { type: "[String!]" }, message: { type: "String!" } },
  FilesUserError: { code: { type: "FilesErrorCode" }, field: { type: "[String!]" }, message: { type: "String!" } },
  ProductSetUserError: { code: { type: "ProductSetUserErrorCode" }, field: { type: "[String!]" }, message: { type: "String!" } },
  ProductUpdatePayload: { product: { type: "Product" }, userErrors: { type: "[UserError!]!" } },
  FileUpdatePayload: { files: { type: "[File!]" }, userErrors: { type: "[FilesUserError!]!" } },
  ProductSetPayload: { product: { type: "Product" }, userErrors: { type: "[ProductSetUserError!]!" } },
  CollectionCreatePayload: { collection: { type: "Collection" }, userErrors: { type: "[UserError!]!" } },
  PublishablePublishPayload: { userErrors: { type: "[UserError!]!" } },
};

const money = (amount, currencyCode) => ({ amount: Number(amount).toFixed(2), currencyCode });

/** Only these keys may be sent in an input object; anything else is a client mistake the fake reports. */
function onlyKeys(input, keys, where) {
  for (const key of Object.keys(input ?? {})) {
    if (!keys.includes(key)) throw new GraphQLError(`Variable $input of type ${where} was provided invalid value for ${key} (Field is not defined on ${where})`, "INVALID_VARIABLE");
  }
}

/**
 * Builds the store from a catalogue in the starter's format
 * (src/data/shop/catalogue.json): { shop, collections, products }.
 */
export function createShopifyFake(options = {}) {
  const catalogue = structuredClone(options.catalogue ?? { shop: { name: "Fake store", currencyCode: "GBP" }, collections: [], products: [] });
  const state = {
    tokens: {
      storefrontPublic: options.storefrontPublicToken ?? null,
      storefrontPrivate: options.storefrontPrivateToken ?? null,
      admin: new Set(options.adminToken ? [options.adminToken] : []),
    },
    tokenless: options.tokenless !== false,
    scopes: options.scopes ?? ["read_products", "write_products", "write_files", "read_publications", "write_publications"],
    clientId: options.clientId ?? null,
    clientSecret: options.clientSecret ?? null,
    throttleNext: 0,
    bucket: 1000,
    carts: new Map(),
    publications: options.publications ?? [{ id: "gid://shopify/Publication/1", title: "Headless storefront" }],
    published: [],
    calls: [],
    origin: options.origin ?? "http://127.0.0.1",
    nextId: 1000,
  };
  const currency = catalogue.shop?.currencyCode ?? "GBP";
  const id = (kind) => `gid://shopify/${kind}/${state.nextId++}`;
  const imageUrl = (path) => (/^https?:\/\//.test(path) ? path : `${state.origin}/cdn${path}`);

  // Admin-side records hold what can change; the Storefront objects are derived from them on every read.
  const records = catalogue.products.map((product, index) => ({
    id: `gid://shopify/Product/${index + 1}`,
    status: "ACTIVE",
    updatedAt: "2026-11-01T09:00:00Z",
    ...product,
    images: (product.images ?? []).map((image, at) => ({ ...image, mediaId: `gid://shopify/MediaImage/${(index + 1) * 100 + at}` })),
    variants: (product.variants ?? []).map((variant, at) => ({ ...variant, id: `gid://shopify/ProductVariant/${(index + 1) * 100 + at}` })),
  }));
  const collections = (catalogue.collections ?? []).map((collection, index) => ({ id: `gid://shopify/Collection/${index + 1}`, ...collection }));
  const byHandle = (handle) => records.find((record) => record.handle === handle) ?? null;
  const variantById = (variantId) => {
    for (const record of records) for (const variant of record.variants) if (variant.id === variantId) return { record, variant };
    return null;
  };

  function sfImage(image) {
    if (!image) return null;
    return {
      __typename: "Image",
      id: image.mediaId.replace("MediaImage", "ProductImage"),
      url: (args) => {
        const width = args?.transform?.maxWidth;

        return width ? `${imageUrl(image.url)}?width=${width}` : imageUrl(image.url);
      },
      altText: image.altText ?? null,
      width: image.width ?? null,
      height: image.height ?? null,
      thumbhash: null,
    };
  }

  function sfVariant(record, variant) {
    return {
      __typename: "ProductVariant",
      id: variant.id,
      title: variant.title ?? variant.selectedOptions.map((option) => option.value).join(" / "),
      sku: variant.sku ?? null,
      availableForSale: Boolean(variant.availableForSale),
      currentlyNotInStock: !variant.availableForSale,
      quantityAvailable: variant.quantityAvailable ?? 0,
      price: money(variant.price.amount, variant.price.currencyCode ?? currency),
      compareAtPrice: variant.compareAtPrice ? money(variant.compareAtPrice.amount, currency) : null,
      selectedOptions: variant.selectedOptions,
      image: sfImage(record.images[variant.image ?? 0]),
      product: () => sfProduct(record),
      requiresShipping: true,
    };
  }

  function sfProduct(record) {
    const variants = record.variants.map((variant) => sfVariant(record, variant));
    const prices = record.variants.map((variant) => Number(variant.price.amount));

    return {
      __typename: "Product",
      id: record.id,
      handle: record.handle,
      title: record.title,
      description: (args) => {
        const text = (record.description ?? "").trim();

        return args?.truncateAt && text.length > args.truncateAt ? `${text.slice(0, args.truncateAt)}…` : text;
      },
      descriptionHtml: record.descriptionHtml ?? "",
      vendor: record.vendor ?? catalogue.shop?.name ?? "",
      productType: record.productType ?? "",
      tags: record.tags ?? [],
      availableForSale: record.variants.some((variant) => variant.availableForSale),
      featuredImage: sfImage(record.images[0]),
      images: record.images.map(sfImage),
      options: (record.options ?? []).map((option, at) => ({
        __typename: "ProductOption",
        id: `gid://shopify/ProductOption/${record.id.split("/").pop()}${at}`,
        name: option.name,
        optionValues: option.values.map((name, vat) => ({
          __typename: "ProductOptionValue",
          id: `gid://shopify/ProductOptionValue/${record.id.split("/").pop()}${at}${vat}`,
          name,
          swatch: null,
          firstSelectableVariant: () => variants.find((variant) => variant.selectedOptions.some((selected) => selected.name === option.name && selected.value === name)) ?? null,
        })),
      })),
      variants,
      variantsCount: { count: variants.length, precision: "EXACT" },
      priceRange: { minVariantPrice: money(Math.min(...prices), currency), maxVariantPrice: money(Math.max(...prices), currency) },
      compareAtPriceRange: { minVariantPrice: money(0, currency), maxVariantPrice: money(0, currency) },
      seo: { title: record.seo?.title ?? null, description: record.seo?.description ?? null },
      selectedOrFirstAvailableVariant: (args) => {
        const wanted = args?.selectedOptions ?? [];
        const match = variants.find((variant) => wanted.every((option) => variant.selectedOptions.some((selected) => selected.name === option.name && selected.value === option.value)));

        return (wanted.length ? match : null) ?? variants.find((variant) => variant.availableForSale) ?? variants[0] ?? null;
      },
      onlineStoreUrl: null,
      updatedAt: record.updatedAt,
      collections: () => collections.filter((collection) => collection.products.includes(record.handle)).map(sfCollection),
      requiresSellingPlan: false,
      metafield: null,
    };
  }

  function matchesFilter(product, filter) {
    if (filter.available !== undefined) return product.availableForSale === filter.available;
    if (filter.variantOption) return product.variants.some((variant) => variant.selectedOptions.some((option) => option.name === filter.variantOption.name && option.value === filter.variantOption.value));
    if (filter.productType) return product.productType === filter.productType;
    if (filter.price) {
      const prices = product.variants.map((variant) => Number(variant.price.amount));

      return prices.some((price) => (filter.price.min === undefined || price >= filter.price.min) && (filter.price.max === undefined || price <= filter.price.max));
    }
    throw new GraphQLError(`This fake doesn't filter by ${Object.keys(filter).join(", ")}.`, "INVALID_VARIABLE");
  }

  function filtersFor(products) {
    const options = new Map();

    for (const product of products) {
      for (const variant of product.variants) {
        for (const option of variant.selectedOptions) {
          const values = options.get(option.name) ?? new Map();

          values.set(option.value, (values.get(option.value) ?? new Set()).add(product.handle));
          options.set(option.name, values);
        }
      }
    }
    const available = products.filter((product) => product.variants.some((variant) => variant.availableForSale)).length;

    return [
      {
        id: "filter.v.availability",
        label: "Availability",
        type: "LIST",
        values: [
          { id: "filter.v.availability.1", label: "In stock", count: available, input: JSON.stringify({ available: true }) },
          { id: "filter.v.availability.0", label: "Out of stock", count: products.length - available, input: JSON.stringify({ available: false }) },
        ],
      },
      ...[...options].map(([name, values]) => ({
        id: `filter.v.option.${name.toLowerCase()}`,
        label: name,
        type: "LIST",
        values: [...values].map(([value, handles]) => ({ id: `filter.v.option.${name.toLowerCase()}.${value}`, label: value, count: handles.size, input: JSON.stringify({ variantOption: { name, value } }) })),
      })),
    ];
  }

  function sfCollection(collection) {
    return {
      __typename: "Collection",
      id: collection.id,
      handle: collection.handle,
      title: collection.title,
      description: collection.description ?? "",
      descriptionHtml: collection.descriptionHtml ?? `<p>${collection.description ?? ""}</p>`,
      image: collection.image ? sfImage({ ...collection.image, mediaId: `${collection.id}0` }) : null,
      seo: { title: collection.seo?.title ?? null, description: collection.seo?.description ?? null },
      updatedAt: "2026-11-01T09:00:00Z",
      onlineStoreUrl: null,
      products: (args) => {
        const members = collection.products.map(byHandle).filter(Boolean);
        const filtered = members.filter((record) => (args.filters ?? []).every((filter) => matchesFilter(record, filter)));

        return connection(filtered.map(sfProduct), args, { filters: filtersFor(members) });
      },
    };
  }

  function search(text) {
    const terms = String(text ?? "").toLowerCase().split(/\s+/).filter(Boolean);
    const fieldQuery = /^(\w+):(.+)$/.exec(String(text ?? "").trim());

    return records.filter((record) => {
      if (fieldQuery && ["title", "product_type", "tag", "available_for_sale"].includes(fieldQuery[1])) {
        const value = fieldQuery[2].replace(/^"|"$/g, "").toLowerCase();

        if (fieldQuery[1] === "title") return record.title.toLowerCase().includes(value.replace(/\*$/, ""));
        if (fieldQuery[1] === "product_type") return (record.productType ?? "").toLowerCase() === value;
        if (fieldQuery[1] === "tag") return (record.tags ?? []).some((tag) => tag.toLowerCase() === value);
        return String(record.variants.some((variant) => variant.availableForSale)) === value;
      }
      const haystack = [record.title, record.description, record.productType, ...(record.tags ?? [])].join(" ").toLowerCase();

      return terms.every((term) => haystack.includes(term));
    });
  }

  // ── carts ────────────────────────────────────────────────────────────
  function cartView(cart) {
    const lines = cart.lines.map((line) => {
      const found = variantById(line.merchandiseId);
      const unit = Number(found.variant.price.amount);

      return {
        __typename: "CartLine",
        id: line.id,
        quantity: line.quantity,
        merchandise: sfVariant(found.record, found.variant),
        cost: { amountPerQuantity: money(unit, currency), compareAtAmountPerQuantity: null, subtotalAmount: money(unit * line.quantity, currency), totalAmount: money(unit * line.quantity, currency) },
      };
    });
    const subtotal = cart.lines.reduce((sum, line) => sum + Number(variantById(line.merchandiseId).variant.price.amount) * line.quantity, 0);

    return {
      __typename: "Cart",
      id: cart.id,
      checkoutUrl: `${state.origin}/cart/c/${cart.token}?key=${cart.key}`,
      totalQuantity: cart.lines.reduce((sum, line) => sum + line.quantity, 0),
      cost: { subtotalAmount: money(subtotal, currency), totalAmount: money(subtotal, currency), checkoutChargeAmount: money(subtotal, currency), subtotalAmountEstimated: false, totalAmountEstimated: true },
      lines,
      note: null,
      createdAt: cart.createdAt,
      updatedAt: new Date().toISOString(),
    };
  }

  function cartFor(cartId) {
    const cart = state.carts.get(String(cartId));

    if (!cart) throw new GraphQLError("The specified cart does not exist.", "NOT_FOUND");
    return cart;
  }

  /** Lines are checked one by one, as the documented userErrors are: a bad variant, a quantity below 1, more than is in stock. */
  function addLines(cart, lines) {
    const userErrors = [];
    const warnings = [];

    for (const [index, line] of (lines ?? []).entries()) {
      onlyKeys(line, ["merchandiseId", "quantity", "attributes", "sellingPlanId"], "CartLineInput");
      const found = variantById(line.merchandiseId);
      const quantity = line.quantity ?? 1;

      if (!found) {
        userErrors.push({ code: "INVALID_MERCHANDISE_LINE", field: ["lines", String(index), "merchandiseId"], message: "The merchandise with id does not exist." });
        continue;
      }
      if (!found.variant.availableForSale) {
        userErrors.push({ code: "MERCHANDISE_NOT_ENOUGH_STOCK", field: ["lines", String(index), "quantity"], message: "The product is sold out." });
        continue;
      }
      const existing = cart.lines.find((item) => item.merchandiseId === line.merchandiseId);
      const wanted = (existing?.quantity ?? 0) + quantity;
      const stock = found.variant.quantityAvailable ?? 99;

      if (wanted > stock) {
        warnings.push({ code: "MERCHANDISE_NOT_ENOUGH_STOCK", message: `Only ${stock} left; the quantity was reduced.`, target: existing?.id ?? "new" });
      }
      if (existing) existing.quantity = Math.min(wanted, stock);
      else cart.lines.push({ id: `gid://shopify/CartLine/${state.nextId++}?cart=${cart.token}`, merchandiseId: line.merchandiseId, quantity: Math.min(quantity, stock) });
    }
    return { userErrors, warnings };
  }

  const storefrontRoots = {
    QueryRoot: {
      shop: {
        name: catalogue.shop?.name ?? "Store",
        primaryDomain: { url: `${state.origin}`, host: new URL(state.origin).host },
        paymentSettings: { currencyCode: currency, countryCode: catalogue.shop?.countryCode ?? "GB" },
        moneyFormat: catalogue.shop?.moneyFormat ?? "£{{amount}}",
      },
      product: (args) => {
        const record = args.handle ? byHandle(args.handle) : records.find((item) => item.id === args.id);

        return record ? sfProduct(record) : null;
      },
      products: (args) => connection((args.query ? search(args.query) : records).map(sfProduct), args),
      collection: (args) => {
        const found = collections.find((item) => (args.handle ? item.handle === args.handle : item.id === args.id));

        return found ? sfCollection(found) : null;
      },
      collections: (args) => connection(collections.map(sfCollection), args),
      search: (args) => {
        const results = search(args.query).filter((record) => (args.productFilters ?? []).every((filter) => matchesFilter(record, filter)));

        return connection(results.map(sfProduct), args, { totalCount: results.length, productFilters: filtersFor(results) });
      },
      cart: (args) => {
        const cart = state.carts.get(String(args.id));

        return cart ? cartView(cart) : null;
      },
    },
    Mutation: {
      cartCreate: (args) => {
        onlyKeys(args.input, ["lines", "buyerIdentity", "attributes", "note", "discountCodes"], "CartInput");
        const token = `hWN${(state.nextId++).toString(16)}fake`;
        const key = `k${(state.nextId++).toString(16)}`;
        const cart = { id: `gid://shopify/Cart/${token}?key=${key}`, token, key, lines: [], createdAt: new Date().toISOString() };
        const result = addLines(cart, args.input?.lines);

        state.carts.set(cart.id, cart);
        return { cart: cartView(cart), ...result };
      },
      cartLinesAdd: (args) => {
        const cart = cartFor(args.cartId);
        const result = addLines(cart, args.lines);

        return { cart: cartView(cart), ...result };
      },
      cartLinesUpdate: (args) => {
        const cart = cartFor(args.cartId);
        const userErrors = [];
        const warnings = [];

        for (const [index, change] of (args.lines ?? []).entries()) {
          onlyKeys(change, ["id", "quantity", "merchandiseId", "attributes", "sellingPlanId"], "CartLineUpdateInput");
          const line = cart.lines.find((item) => item.id === change.id);

          if (!line) {
            userErrors.push({ code: "INVALID", field: ["lines", String(index), "id"], message: "The cart line does not exist." });
            continue;
          }
          const stock = variantById(line.merchandiseId).variant.quantityAvailable ?? 99;

          if (change.quantity > stock) warnings.push({ code: "MERCHANDISE_NOT_ENOUGH_STOCK", message: `Only ${stock} left; the quantity was reduced.`, target: line.id });
          line.quantity = Math.min(change.quantity, stock);
        }
        cart.lines = cart.lines.filter((line) => line.quantity > 0);
        return { cart: cartView(cart), userErrors, warnings };
      },
      cartLinesRemove: (args) => {
        const cart = cartFor(args.cartId);

        cart.lines = cart.lines.filter((line) => !(args.lineIds ?? []).includes(line.id));
        return { cart: cartView(cart), userErrors: [], warnings: [] };
      },
    },
  };

  // ── admin ────────────────────────────────────────────────────────────
  function adminProduct(record) {
    return {
      __typename: "Product",
      id: record.id,
      handle: record.handle,
      title: record.title,
      descriptionHtml: record.descriptionHtml ?? "",
      seo: { title: record.seo?.title ?? null, description: record.seo?.description ?? null },
      status: record.status,
      updatedAt: record.updatedAt,
      media: record.images.map((image) => ({
        __typename: "MediaImage",
        id: image.mediaId,
        alt: image.altText ?? "",
        image: { url: imageUrl(image.url), altText: image.altText ?? "", width: image.width ?? null, height: image.height ?? null },
        status: "READY",
        mediaContentType: "IMAGE",
      })),
    };
  }

  const adminRoots = {
    QueryRoot: {
      shop: { name: catalogue.shop?.name ?? "Store", myshopifyDomain: "fake-store.myshopify.com", currencyCode: currency },
      productByIdentifier: (args) => {
        onlyKeys(args.identifier, ["id", "handle", "customId"], "ProductIdentifierInput");
        const record = args.identifier?.handle ? byHandle(args.identifier.handle) : records.find((item) => item.id === args.identifier?.id);

        return record ? adminProduct(record) : null;
      },
      product: (args) => {
        const record = records.find((item) => item.id === args.id);

        return record ? adminProduct(record) : null;
      },
      products: (args) => records.filter((record) => !args.query || search(args.query).includes(record)).map(adminProduct),
      collections: () => collections.map((collection) => ({ __typename: "Collection", id: collection.id, handle: collection.handle, title: collection.title })),
      currentAppInstallation: () => ({ accessScopes: state.scopes.map((handle) => ({ handle, description: handle })) }),
      publications: () => state.publications.map((publication) => ({ __typename: "Publication", id: publication.id, autoPublish: false, catalog: { id: `${publication.id}c`, title: publication.title, status: "ACTIVE" } })),
    },
    Mutation: {
      productUpdate: (args) => {
        onlyKeys(args.product, ["id", "title", "descriptionHtml", "seo", "handle", "productType", "vendor", "status", "tags", "metafields", "category", "collectionsToJoin", "collectionsToLeave", "templateSuffix", "redirectNewHandle", "requiresSellingPlan", "giftCardTemplateSuffix", "deleteConflictingConstrainedMetafields"], "ProductUpdateInput");
        const record = records.find((item) => item.id === args.product?.id);

        if (!record) return { product: null, userErrors: [{ field: ["product", "id"], message: "Product does not exist" }] };
        if (args.product.title !== undefined) {
          if (!String(args.product.title).trim()) return { product: null, userErrors: [{ field: ["product", "title"], message: "Title can't be blank" }] };
          record.title = args.product.title;
        }
        if (args.product.descriptionHtml !== undefined) {
          record.descriptionHtml = args.product.descriptionHtml;
          record.description = String(args.product.descriptionHtml).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
        }
        if (args.product.seo) {
          onlyKeys(args.product.seo, ["title", "description"], "SEOInput");
          record.seo = { ...(record.seo ?? {}), ...args.product.seo };
        }
        for (const key of ["status", "handle", "productType", "vendor", "tags"]) if (args.product[key] !== undefined) record[key] = args.product[key];
        record.updatedAt = new Date().toISOString();
        return { product: adminProduct(record), userErrors: [] };
      },
      fileUpdate: (args) => {
        const files = [];
        const userErrors = [];

        for (const [index, file] of (args.files ?? []).entries()) {
          onlyKeys(file, ["id", "alt", "filename", "originalSource", "previewImageSource", "referencesToAdd", "referencesToRemove"], "FileUpdateInput");
          const image = records.flatMap((record) => record.images).find((item) => item.mediaId === file.id);

          if (!image) {
            userErrors.push({ code: "FILE_DOES_NOT_EXIST", field: ["files", String(index), "id"], message: "File id does not exist." });
            continue;
          }
          if (file.alt !== undefined) image.altText = file.alt;
          files.push({ __typename: "MediaImage", id: image.mediaId, alt: image.altText });
        }
        return { files, userErrors };
      },
      productSet: (args) => {
        const input = args.input ?? {};

        onlyKeys(input, ["title", "handle", "descriptionHtml", "productType", "vendor", "status", "tags", "seo", "productOptions", "variants", "files", "collections", "metafields", "category", "templateSuffix", "giftCard", "requiresSellingPlan", "redirectNewHandle", "combinedListingRole", "claimOwnership", "giftCardTemplateSuffix"], "ProductSetInput");
        if (!input.title) return { product: null, userErrors: [{ code: "INVALID", field: ["input", "title"], message: "Title can't be blank" }] };
        if ((input.productOptions ?? []).length > 3) return { product: null, userErrors: [{ code: "INVALID", field: ["input", "productOptions"], message: "A product can have at most 3 options." }] };
        for (const option of input.productOptions ?? []) onlyKeys(option, ["id", "name", "position", "values", "linkedMetafield"], "OptionSetInput");
        for (const variant of input.variants ?? []) {
          onlyKeys(variant, ["optionValues", "price", "compareAtPrice", "sku", "file", "inventoryQuantities", "inventoryPolicy", "inventoryItem", "position", "taxable", "barcodes", "metafields", "published", "requiresComponents", "showUnitPrice", "taxCode", "unitPriceMeasurement", "id"], "ProductVariantSetInput");
          if (!Array.isArray(variant.optionValues) || variant.optionValues.some((value) => !value.optionName || !value.name)) {
            return { product: null, userErrors: [{ code: "INVALID", field: ["input", "variants"], message: "Each variant needs optionValues with optionName and name." }] };
          }
        }
        for (const file of input.files ?? []) onlyKeys(file, ["alt", "contentType", "duplicateResolutionMode", "filename", "id", "originalSource"], "FileSetInput");
        if (byHandle(input.handle)) return { product: null, userErrors: [{ code: "TAKEN", field: ["input", "handle"], message: "Handle has already been taken" }] };
        const record = {
          id: id("Product"),
          handle: input.handle,
          title: input.title,
          descriptionHtml: input.descriptionHtml ?? "",
          description: String(input.descriptionHtml ?? "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim(),
          productType: input.productType ?? "",
          vendor: input.vendor ?? "",
          tags: input.tags ?? [],
          seo: input.seo ?? {},
          status: input.status ?? "DRAFT",
          updatedAt: new Date().toISOString(),
          options: (input.productOptions ?? []).map((option) => ({ name: option.name, values: (option.values ?? []).map((value) => value.name) })),
          images: (input.files ?? []).map((file, at) => ({ url: file.originalSource, altText: file.alt ?? "", mediaId: `gid://shopify/MediaImage/${state.nextId++}${at}` })),
          variants: (input.variants ?? []).map((variant) => ({
            id: id("ProductVariant"),
            sku: variant.sku ?? null,
            selectedOptions: variant.optionValues.map((value) => ({ name: value.optionName, value: value.name })),
            price: { amount: String(variant.price ?? "0"), currencyCode: currency },
            compareAtPrice: variant.compareAtPrice ? { amount: String(variant.compareAtPrice) } : null,
            availableForSale: true,
            quantityAvailable: 0,
          })),
        };

        records.push(record);
        for (const collectionId of input.collections ?? []) collections.find((collection) => collection.id === collectionId)?.products.push(record.handle);
        return { product: adminProduct(record), userErrors: [] };
      },
      collectionCreate: (args) => {
        onlyKeys(args.collection, ["title", "handle", "descriptionHtml", "image", "metafields", "seo", "sortOrder", "sources", "templateSuffix"], "CollectionCreateInput");
        if (!args.collection?.title) return { collection: null, userErrors: [{ field: ["collection", "title"], message: "Title can't be blank" }] };
        if (collections.some((collection) => collection.handle === args.collection.handle)) return { collection: null, userErrors: [{ field: ["collection", "handle"], message: "Handle has already been taken" }] };
        const created = { id: id("Collection"), handle: args.collection.handle, title: args.collection.title, description: String(args.collection.descriptionHtml ?? "").replace(/<[^>]+>/g, ""), products: [] };

        collections.push(created);
        return { collection: { __typename: "Collection", id: created.id, handle: created.handle, title: created.title }, userErrors: [] };
      },
      publishablePublish: (args) => {
        for (const item of args.input ?? []) onlyKeys(item, ["publicationId", "publishDate"], "PublicationInput");
        const known = (args.input ?? []).every((item) => state.publications.some((publication) => publication.id === item.publicationId));

        if (!known) return { userErrors: [{ field: ["input", "publicationId"], message: "Publication does not exist" }] };
        state.published.push({ id: args.id, publications: (args.input ?? []).map((item) => item.publicationId) });
        return { userErrors: [] };
      },
    },
  };

  const cors = { "access-control-allow-origin": "*", "access-control-allow-headers": "content-type, x-shopify-storefront-access-token", "access-control-allow-methods": "POST, OPTIONS" };
  const jsonReply = (status, body, headers = {}) => ({ status, headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) });

  /** One request, as plain values: { method, url, headers (lower-case), body (text) }. */
  async function handle(request) {
    const url = new URL(request.url, state.origin);
    const headers = Object.fromEntries(Object.entries(request.headers ?? {}).map(([key, value]) => [key.toLowerCase(), String(value)]));
    const call = { method: request.method, path: url.pathname, headers, body: request.body ?? "" };

    state.calls.push(call);
    if (request.method === "OPTIONS") return { status: 204, headers: cors, body: "" };

    const versioned = /^\/(admin\/)?api\/([^/]+)\/graphql\.json$/.exec(url.pathname);

    if (versioned) {
      if (request.method !== "POST") return { status: 405, headers: { ...cors, allow: "POST" }, body: "" };
      const requested = versioned[2];
      // An unknown or retired version falls forward to the oldest supported stable one.
      const used = STABLE_VERSIONS.includes(requested) || requested === RELEASE_CANDIDATE || requested === "unstable" ? requested : STABLE_VERSIONS[0];
      const versionHeader = { "x-shopify-api-version": used };
      let body;

      try {
        body = JSON.parse(request.body || "null");
      } catch {
        return jsonReply(400, { errors: [{ message: "Request body is not valid JSON" }] }, { ...cors, ...versionHeader });
      }
      if (versioned[1]) return adminRequest(headers, body, versionHeader);
      return storefrontRequest(headers, body, versionHeader);
    }
    if (url.pathname === "/admin/oauth/access_token" && request.method === "POST") {
      const form = new URLSearchParams(request.body ?? "");

      if (!/application\/x-www-form-urlencoded/.test(headers["content-type"] ?? "")) return jsonReply(400, { error: "invalid_request", error_description: "Send the form url-encoded." });
      if (form.get("grant_type") !== "client_credentials") return jsonReply(400, { error: "unsupported_grant_type" });
      if (!state.clientId || form.get("client_id") !== state.clientId || form.get("client_secret") !== state.clientSecret) return jsonReply(401, { error: "invalid_client", error_description: "Client authentication failed" });
      const token = `shpat_fake_${(state.nextId++).toString(16)}${"0".repeat(20)}`;

      state.tokens.admin.add(token);
      return jsonReply(200, { access_token: token, scope: state.scopes.join(","), expires_in: 86399 });
    }
    if (url.pathname.startsWith("/cart/c/")) {
      const cart = [...state.carts.values()].find((item) => url.pathname.endsWith(item.token) && url.searchParams.get("key") === item.key);

      if (!cart) return { status: 404, headers: { "content-type": "text/html; charset=utf-8" }, body: "<!doctype html><title>Not found</title><h1>That checkout isn't here.</h1>" };
      const view = cartView(cart);

      return {
        status: 200,
        headers: { "content-type": "text/html; charset=utf-8" },
        body: `<!doctype html><html lang="en"><title>Checkout (local fake)</title><h1>Checkout (local fake store)</h1><p data-fake-checkout="${cart.token}">${view.totalQuantity} items, ${view.cost.subtotalAmount.amount} ${view.cost.subtotalAmount.currencyCode}. Nothing is charged here.</p></html>`,
      };
    }
    if (url.pathname.startsWith("/cdn/") && options.publicDir) {
      const file = normalize(join(options.publicDir, url.pathname.slice(4)));

      if (!file.startsWith(normalize(options.publicDir))) return { status: 403, headers: {}, body: "" };
      try {
        const data = await readFile(file);
        const types = { ".webp": "image/webp", ".jpg": "image/jpeg", ".png": "image/png", ".svg": "image/svg+xml" };

        return { status: 200, headers: { "content-type": types[extname(file)] ?? "application/octet-stream", "access-control-allow-origin": "*" }, body: data };
      } catch {
        return { status: 404, headers: {}, body: "" };
      }
    }
    return { status: 404, headers: { "content-type": "text/plain" }, body: "Not found" };
  }

  async function storefrontRequest(headers, body, versionHeader) {
    const publicToken = headers["x-shopify-storefront-access-token"];
    const privateToken = headers["shopify-storefront-private-token"];
    let access = "tokenless";

    if (privateToken !== undefined) {
      if (!state.tokens.storefrontPrivate || privateToken !== state.tokens.storefrontPrivate) return jsonReply(401, { errors: [{ message: "Invalid Storefront API access token" }] }, { ...cors, ...versionHeader });
      access = "private";
    } else if (publicToken !== undefined) {
      if (!state.tokens.storefrontPublic || publicToken !== state.tokens.storefrontPublic) return jsonReply(401, { errors: [{ message: "Invalid Storefront API access token" }] }, { ...cors, ...versionHeader });
      access = "public";
    } else if (!state.tokenless) {
      return jsonReply(401, { errors: [{ message: "This store doesn't allow tokenless access" }] }, { ...cors, ...versionHeader });
    }
    const result = await run(storefront, storefrontRoots, body, {
      access,
      beforeExecute(cost) {
        if (access === "tokenless" && cost > TOKENLESS_LIMIT) {
          return { errors: [{ message: `Query cost is ${cost}, which exceeds the maximum complexity of ${TOKENLESS_LIMIT} for tokenless access.`, extensions: { code: "MAX_COMPLEXITY_EXCEEDED", cost, maxCost: TOKENLESS_LIMIT } }] };
        }
        return null;
      },
    });
    const { cost: _cost, ...out } = result;

    return jsonReply(200, out, { ...cors, ...versionHeader });
  }

  async function adminRequest(headers, body, versionHeader) {
    const token = headers["x-shopify-access-token"];

    if (!token || !state.tokens.admin.has(token)) return jsonReply(401, { errors: "[API] Invalid API key or access token (unrecognized login or wrong password)" }, versionHeader);
    const result = await run(admin, adminRoots, body, {
      scopes: state.scopes,
      beforeExecute(cost) {
        if (cost > 1000) return { errors: [{ message: `Query cost is ${cost}, which exceeds the single query max cost limit (1000).`, extensions: { code: "MAX_COST_EXCEEDED", cost, maxCost: 1000 } }] };
        if (state.throttleNext > 0) {
          state.throttleNext--;
          return {
            errors: [{ message: "Throttled", extensions: { code: "THROTTLED" } }],
            extensions: { cost: { requestedQueryCost: cost, actualQueryCost: null, throttleStatus: { maximumAvailable: 1000, currentlyAvailable: 0, restoreRate: 50 } } },
          };
        }
        return null;
      },
    });
    const { cost, ...out } = result;

    if (cost !== undefined) out.extensions = { cost: { requestedQueryCost: cost, actualQueryCost: cost, throttleStatus: { maximumAvailable: 1000, currentlyAvailable: 1000 - cost, restoreRate: 50 } } };
    return jsonReply(200, out, versionHeader);
  }

  /** The fake as a `fetch`, for code that is handed one. */
  async function fakeFetch(input, init = {}) {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    const headers = {};

    new Headers(init.headers).forEach((value, key) => {
      headers[key] = value;
    });
    if (init.signal?.aborted) throw new DOMException("The operation was aborted.", "AbortError");
    const reply = await handle({ method: init.method ?? "GET", url, headers, body: typeof init.body === "string" ? init.body : init.body instanceof URLSearchParams ? init.body.toString() : "" });

    return new Response(reply.status === 204 ? null : reply.body, { status: reply.status, headers: reply.headers });
  }

  /** Serves the fake on 127.0.0.1:port. Resolves with the server once it listens. */
  function listen(port) {
    const server = createServer(async (req, res) => {
      const chunks = [];

      for await (const chunk of req) chunks.push(chunk);
      try {
        const reply = await handle({ method: req.method, url: req.url, headers: req.headers, body: Buffer.concat(chunks).toString("utf8") });

        res.writeHead(reply.status, reply.headers);
        res.end(reply.body);
      } catch (error) {
        res.writeHead(500, { "content-type": "application/json" });
        res.end(JSON.stringify({ errors: [{ message: String(error?.message ?? error) }] }));
      }
    });

    return new Promise((resolve) =>
      server.listen(port, "127.0.0.1", () => {
        // Port 0 picks a free one; links the fake hands out (checkout, pictures) use the real one.
        state.origin = `http://127.0.0.1:${server.address().port}`;
        resolve(server);
      })
    );
  }

  return {
    state,
    handle,
    fetch: fakeFetch,
    listen,
    /** The next n Admin requests answer THROTTLED. */
    throttle(n = 1) {
      state.throttleNext = n;
    },
    product: (handle) => byHandle(handle),
    collections,
  };
}
