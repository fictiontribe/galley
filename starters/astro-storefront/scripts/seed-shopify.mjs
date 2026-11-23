#!/usr/bin/env node
// Creates this site's demo catalogue (src/data/shop/catalogue.json) in a
// real store, so the shop you connect shows the same seventeen pieces the
// demo does. Meant for a development store. It only adds: a product or
// collection whose handle is already in the store is left as it is.
//
//   SHOPIFY_STORE_DOMAIN=your-dev-store.myshopify.com \
//   SHOPIFY_ADMIN_TOKEN=shpat_… \
//   node scripts/seed-shopify.mjs --images-from https://your-site.example.com \
//     [--publication "Headless storefront"] [--dry-run]
//
// Instead of SHOPIFY_ADMIN_TOKEN, a Dev Dashboard app installed on the store
// can sign in with SHOPIFY_ADMIN_CLIENT_ID and SHOPIFY_ADMIN_CLIENT_SECRET
// (the client-credentials grant; the app and the store must belong to the
// same organisation). The app needs the write_products permission, and
// read_publications and write_publications to put the products on a sales
// channel (--publication, the channel's catalogue title as the store shows
// it, e.g. the Headless storefront you created).
//
// Pictures: a store fetches each picture from a public address, so pass
// --images-from with the address where this site (or any copy of public/)
// is online; without it the products are made without pictures. Stock is
// not set — set it in the store's admin, per location.
//
// Admin GraphQL API, version 2026-10 (shopify.dev, read 2026-11-23):
// productSet (synchronous), collectionCreate, publishablePublish,
// currentAppInstallation.accessScopes. Never logs a token.
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const VERSION = "2026-10";
const { values: args } = parseArgs({
  options: {
    store: { type: "string" },
    "images-from": { type: "string" },
    publication: { type: "string" },
    catalogue: { type: "string" },
    "dry-run": { type: "boolean" },
  },
});

function fail(message) {
  console.error(`seed-shopify: ${message}`);
  process.exit(1);
}

const domain = (args.store ?? process.env.SHOPIFY_STORE_DOMAIN ?? "").trim();
if (!domain) fail("say which store: SHOPIFY_STORE_DOMAIN=your-dev-store.myshopify.com (or --store).");
let origin;
try {
  const url = new URL(/^https?:\/\//.test(domain) ? domain : `https://${/\./.test(domain) ? domain : `${domain}.myshopify.com`}`);
  const local = url.hostname === "127.0.0.1" || url.hostname === "localhost";
  if (url.protocol === "http:" && !local) fail("the store's address must start with https://.");
  origin = `${url.protocol}//${url.host}`;
} catch {
  fail(`“${domain}” isn't a store address.`);
}
const host = new URL(origin).host;
const catalogue = JSON.parse(readFileSync(args.catalogue ? resolve(args.catalogue) : join(ROOT, "src/data/shop/catalogue.json"), "utf8"));
const imagesFrom = args["images-from"]?.replace(/\/+$/, "");
const secrets = [process.env.SHOPIFY_ADMIN_TOKEN, process.env.SHOPIFY_ADMIN_CLIENT_SECRET].filter((value) => value && value.length >= 4);
const scrub = (text) => secrets.reduce((out, secret) => out.split(secret).join("[redacted]"), String(text));

async function adminToken() {
  if (process.env.SHOPIFY_ADMIN_TOKEN) return process.env.SHOPIFY_ADMIN_TOKEN.trim();
  const id = process.env.SHOPIFY_ADMIN_CLIENT_ID;
  const secret = process.env.SHOPIFY_ADMIN_CLIENT_SECRET;
  if (!id || !secret) fail("give an Admin API token (SHOPIFY_ADMIN_TOKEN), or a Dev Dashboard app's SHOPIFY_ADMIN_CLIENT_ID and SHOPIFY_ADMIN_CLIENT_SECRET.");
  const response = await fetch(`${origin}/admin/oauth/access_token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
    body: new URLSearchParams({ grant_type: "client_credentials", client_id: id, client_secret: secret }).toString(),
  }).catch(() => fail(`couldn't reach ${host}.`));
  const body = await response.json().catch(() => null);
  if (!response.ok || !body?.access_token) fail(`${host} didn't accept the client ID and secret (${response.status}). The app must be installed on the store, and both must belong to the same organisation.`);
  return body.access_token;
}

const token = await adminToken();
secrets.push(token);

async function admin(query, variables = {}) {
  for (let attempt = 1; ; attempt++) {
    let response;
    try {
      response = await fetch(`${origin}/admin/api/${VERSION}/graphql.json`, {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json", "x-shopify-access-token": token },
        body: JSON.stringify({ query, variables }),
      });
    } catch {
      fail(`couldn't reach ${host}. Check the address and the connection.`);
    }
    const body = await response.json().catch(() => null);
    const errors = Array.isArray(body?.errors) ? body.errors : [];
    if (errors.some((error) => error.extensions?.code === "THROTTLED") && attempt < 5) {
      const status = body?.extensions?.cost?.throttleStatus;
      const wait = status ? Math.min(4000, Math.max(250, ((body.extensions.cost.requestedQueryCost ?? 50) - status.currentlyAvailable) / status.restoreRate * 1000)) : 1000;
      await new Promise((done) => setTimeout(done, wait));
      continue;
    }
    if (response.status === 401) fail(`${host} didn't accept the Admin API token.`);
    if (errors.some((error) => error.extensions?.code === "ACCESS_DENIED")) {
      const needed = errors.map((error) => error.extensions?.requiredAccess?.match(/`([a-z_]+)`/)?.[1]).find(Boolean);
      fail(`the app on ${host} is missing a permission${needed ? `: ${needed}` : ""}. Add it to the app's access scopes, release the version and approve it on the store.`);
    }
    if (!response.ok || !body?.data || errors.length) fail(`${host} couldn't answer (${response.status}): ${scrub(errors.map((error) => error.message).join("; ") || (typeof body?.errors === "string" ? body.errors : ""))}`);
    return body.data;
  }
}

// ── what is there already ────────────────────────────────────────────────

const scopes = (await admin(`query Scopes { currentAppInstallation { accessScopes { handle } } }`)).currentAppInstallation.accessScopes.map((scope) => scope.handle);
if (!scopes.includes("write_products")) fail(`the app on ${host} needs the write_products permission (it has: ${scopes.join(", ") || "none"}).`);
if (args.publication && !(scopes.includes("read_publications") && scopes.includes("write_publications"))) {
  fail(`--publication needs the read_publications and write_publications permissions (the app has: ${scopes.join(", ")}).`);
}
const existingProducts = new Set((await admin(`query Handles { products(first: 250) { nodes { handle } } }`)).products.nodes.map((node) => node.handle));
const existingCollections = new Map((await admin(`query Collections { collections(first: 250) { nodes { id handle } } }`)).collections.nodes.map((node) => [node.handle, node.id]));
let publicationId = null;
if (args.publication) {
  const publications = (await admin(`query Publications { publications(first: 50) { nodes { id catalog { title } } } }`)).publications.nodes;
  const matches = publications.filter((publication) => publication.catalog?.title === args.publication);
  if (matches.length !== 1) fail(`no single sales channel is called “${args.publication}”. The store has: ${publications.map((publication) => `“${publication.catalog?.title ?? "(untitled)"}”`).join(", ") || "none"}.`);
  publicationId = matches[0].id;
}

const dry = Boolean(args["dry-run"]);
const report = { collections: [], products: [], skipped: [], published: 0 };
const toPublish = [];

// ── collections ──────────────────────────────────────────────────────────

for (const collection of catalogue.collections) {
  if (existingCollections.has(collection.handle)) {
    report.skipped.push(`collection ${collection.handle}`);
    continue;
  }
  if (dry) {
    report.collections.push(collection.handle);
    continue;
  }
  const result = (await admin(`mutation MakeCollection($collection: CollectionCreateInput!) { collectionCreate(collection: $collection) { collection { id handle } userErrors { field message } } }`, {
    collection: { title: collection.title, handle: collection.handle, descriptionHtml: `<p>${collection.description ?? ""}</p>` },
  })).collectionCreate;
  if (result.userErrors.length) fail(`the collection “${collection.title}” wasn't made: ${result.userErrors.map((error) => error.message).join("; ")}`);
  existingCollections.set(collection.handle, result.collection.id);
  report.collections.push(collection.handle);
  toPublish.push(result.collection.id);
}

// ── products ─────────────────────────────────────────────────────────────

for (const product of catalogue.products) {
  if (existingProducts.has(product.handle)) {
    report.skipped.push(`product ${product.handle}`);
    continue;
  }
  const collectionIds = catalogue.collections.filter((collection) => collection.products.includes(product.handle)).map((collection) => existingCollections.get(collection.handle)).filter(Boolean);
  const input = {
    title: product.title,
    handle: product.handle,
    descriptionHtml: product.descriptionHtml ?? "",
    productType: product.productType ?? "",
    vendor: product.vendor ?? catalogue.shop.name,
    status: "ACTIVE",
    tags: product.tags ?? [],
    ...(product.seo ? { seo: { title: product.seo.title ?? product.title, description: product.seo.description ?? "" } } : {}),
    productOptions: (product.options ?? []).map((option, index) => ({ name: option.name, position: index + 1, values: option.values.map((name) => ({ name })) })),
    variants: product.variants.map((variant) => ({
      optionValues: variant.selectedOptions.map((option) => ({ optionName: option.name, name: option.value })),
      price: variant.price.amount,
      ...(variant.compareAtPrice ? { compareAtPrice: variant.compareAtPrice.amount } : {}),
      ...(variant.sku ? { sku: variant.sku } : {}),
    })),
    ...(imagesFrom ? { files: (product.images ?? []).map((image) => ({ originalSource: `${imagesFrom}${image.url}`, alt: image.altText ?? "", contentType: "IMAGE" })) } : {}),
    ...(dry ? {} : { collections: collectionIds }),
  };
  if (dry) {
    report.products.push(product.handle);
    continue;
  }
  const result = (await admin(`mutation MakeProduct($input: ProductSetInput!) { productSet(synchronous: true, input: $input) { product { id handle } userErrors { code field message } } }`, { input })).productSet;
  if (result.userErrors.length) fail(`“${product.title}” wasn't made: ${result.userErrors.map((error) => error.message).join("; ")}`);
  report.products.push(product.handle);
  toPublish.push(result.product.id);
}

// ── on the sales channel ─────────────────────────────────────────────────

if (publicationId && !dry) {
  for (const id of toPublish) {
    const result = (await admin(`mutation Publish($id: ID!, $input: [PublicationInput!]!) { publishablePublish(id: $id, input: $input) { userErrors { field message } } }`, { id, input: [{ publicationId }] })).publishablePublish;
    if (result.userErrors.length) fail(`couldn't put ${id} on “${args.publication}”: ${result.userErrors.map((error) => error.message).join("; ")}`);
    report.published++;
  }
}

const verb = dry ? "would make" : "made";
console.log(`${host}: ${verb} ${report.collections.length} collections and ${report.products.length} products${publicationId ? `, ${report.published} put on “${args.publication}”` : ""}.`);
if (report.skipped.length) console.log(`Already there, left as they are: ${report.skipped.join(", ")}.`);
if (!imagesFrom && report.products.length) console.log("No pictures were sent: pass --images-from with the address where this site's public/ folder is online.");
if (report.products.length && !dry) console.log("Stock isn't set by this script: set it in the store's admin, for each location.");
if (!publicationId && report.products.length && !dry) console.log("The products aren't on a sales channel yet: pass --publication with your Headless storefront's name, or add them in the store's admin.");
