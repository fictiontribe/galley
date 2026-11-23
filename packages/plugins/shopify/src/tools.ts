/**
 * The plugin's tools for the built-in assistant and any MCP harness. Four
 * only read. One writes — and it writes to the store, not to the site:
 * product copy changed there is live at once and never passes through
 * Proof, so it is offered only while "Let the assistant edit product copy
 * on Shopify" is on (`enabledBy`), its title says it changes Shopify
 * directly, its effect is declared destructive and open-world (MCP
 * harnesses ask the person before such a call), and its description tells
 * the model to show the exact text and get a yes in the conversation first.
 * The engine has no confirmation step of its own for the built-in
 * assistant; this plugin does not invent one.
 */
import type { JsonValue, SiteToolContribution, ToolCallContext, ToolResult } from "@galley/plugin-kit";
import { ShopifyError, scrub, type StoreConnection } from "./client";
import { demoCollections, demoProduct, demoSearch, resolveSource, type Source } from "./source";
import { accessScopes, adminToken, getProduct, listCollections, productCopy, searchProducts, shopInfo, updateCopy, type CopyChange, type ProductCopy } from "./store";

/**
 * Runs a tool's work: plain data goes back as JSON (undefined keys dropped),
 * a ShopifyError as an outcome the model reads and can act on; anything else
 * is reported as unexpected.
 */
async function guarded(ctx: ToolCallContext, work: () => Promise<object>): Promise<ToolResult> {
  try {
    const result = await work();

    if ("content" in result && typeof result.content === "string") return result as { content: string; isError?: boolean };
    return JSON.parse(JSON.stringify(result)) as JsonValue;
  } catch (error) {
    if (error instanceof ShopifyError) {
      if (error.detail) ctx.log.warn(`${error.kind}: ${error.detail}`);
      return { content: error.message, isError: true };
    }
    throw new Error(scrub(error instanceof Error ? error.message : String(error), null));
  }
}

const sourceLine = (source: Source) => (source.kind === "demo" ? `the demo catalogue in ${source.path} (no store is connected)` : source.connection.host);

// ── read-only ────────────────────────────────────────────────────────────

const storeStatus: SiteToolContribution = {
  name: "shopify_store_status",
  title: "Check the store connection",
  description:
    "Says which store the site's shop is connected to (or that it shows the demo catalogue), whether the store answers, which API version answered, what the Storefront access allows, whether an Admin token is set and which permissions it has, and whether product copy editing is switched on. Use it when the person asks whether the shop is connected, or before anything else that talks to the store. Read-only.",
  input: { type: "object", properties: {} },
  mode: "content",
  effect: { readOnly: true, openWorld: true, idempotent: true },
  label: () => "Checking the store connection",
  run: (_input, ctx) =>
    guarded(ctx, async () => {
      const source = await resolveSource(ctx.settings, ctx.site);

      if (source.kind === "demo") {
        return {
          connected: false,
          shows: `the demo catalogue in ${source.path}`,
          products: source.catalogue.products.length,
          collections: source.catalogue.collections?.length ?? 0,
          note: "No store is connected. The site's bag works in demo mode and never takes payment. To connect a store, add its address in the Shopify plugin's settings and in the site's src/data/shop/store.json.",
        };
      }
      const connection = source.connection;
      const shop = await shopInfo(ctx, connection, ctx.signal);
      const admin = await adminStatus(ctx, connection);

      return {
        connected: true,
        store: connection.host,
        name: shop.name,
        currency: shop.paymentSettings.currencyCode,
        apiVersion: { asked: connection.version, answered: shop.answeredVersion ?? "not said", fellForward: Boolean(shop.answeredVersion && shop.answeredVersion !== connection.version) },
        storefrontAccess:
          connection.storefront.kind === "tokenless"
            ? "no token: products, collections, search and carts can be read; stock counts, tags and metafields can't; queries are limited to a complexity of 1,000"
            : `${connection.storefront.kind} Storefront API token`,
        admin,
        productCopyEditing: connection.allowEdits ? (admin.canEditCopy ? "on: changes go to the store at once, without Proof" : "switched on, but the Admin token can't do it yet (see admin)") : "off",
        from: source.via === "site" ? "the store named in the site's src/data/shop/store.json (read without a token)" : "the plugin's settings",
      };
    }),
};

async function adminStatus(ctx: ToolCallContext, connection: StoreConnection) {
  if (!connection.admin.token && !(connection.admin.clientId && connection.admin.clientSecret)) return { set: false, canEditCopy: false, canEditAltText: false };
  try {
    const scopes = await accessScopes(ctx, connection, ctx.signal);

    return { set: true, scopes, canEditCopy: scopes.includes("write_products"), canEditAltText: scopes.includes("write_files") || scopes.includes("write_themes") };
  } catch (error) {
    if (error instanceof ShopifyError) return { set: true, problem: error.message, canEditCopy: false, canEditAltText: false };
    throw error;
  }
}

const searchTool: SiteToolContribution = {
  name: "shopify_search_products",
  title: "Search the store's products",
  description:
    "Find products in the connected store (or the site's demo catalogue) by words in their title, type or description. Returns each product's handle (what a page section stores to show it), title, type, price and whether it can be bought. Use it to find the handle for a section, or when the person asks what is in the shop. Read-only.",
  input: {
    type: "object",
    properties: {
      query: { type: "string", description: "Words to look for. Empty lists the first products.", maxLength: 200 },
      limit: { type: "integer", description: "How many to return, 1–50. Default 10.", minimum: 1, maximum: 50 },
    },
  },
  mode: "content",
  effect: { readOnly: true, openWorld: true, idempotent: true },
  label: (input) => (input.query ? `Looking for “${String(input.query).slice(0, 40)}” in the shop` : "Listing the shop's products"),
  run: (input, ctx) =>
    guarded(ctx, async () => {
      const source = await resolveSource(ctx.settings, ctx.site);
      const words = String(input.query ?? "");
      const limit = Number(input.limit ?? 10);
      const products = source.kind === "demo" ? demoSearch(source.catalogue, words, limit) : await searchProducts(ctx, source.connection, words, limit, ctx.signal);

      return { from: sourceLine(source), products };
    }),
};

const getTool: SiteToolContribution = {
  name: "shopify_get_product",
  title: "Read one product from the store",
  description:
    "Everything the store says about one product, by its handle: title, description (plain and HTML), search title and description, options, every variant with its price and availability, pictures with their descriptions, and the collections it is in. Read it before writing about a product, and before proposing a change to its copy. Read-only.",
  input: { type: "object", properties: { handle: { type: "string", description: "The product's handle, e.g. “field-coat”.", minLength: 1, maxLength: 255 } }, required: ["handle"] },
  mode: "content",
  effect: { readOnly: true, openWorld: true, idempotent: true },
  label: (input) => `Reading “${String(input.handle).slice(0, 40)}” from the shop`,
  run: (input, ctx) =>
    guarded(ctx, async () => {
      const source = await resolveSource(ctx.settings, ctx.site);
      const handle = String(input.handle);
      const product = source.kind === "demo" ? demoProduct(source.catalogue, handle) : await getProduct(ctx, source.connection, handle, ctx.signal);

      if (!product) return { content: `${source.kind === "demo" ? "The demo catalogue" : source.connection.host} has no product with the handle “${handle}”. Search for it with shopify_search_products.`, isError: true };
      return { from: sourceLine(source), product };
    }),
};

const collectionsTool: SiteToolContribution = {
  name: "shopify_list_collections",
  title: "List the store's collections",
  description: "The collections in the connected store (or the site's demo catalogue): handle, title and description. Use it to find a collection handle for a section. Read-only.",
  input: { type: "object", properties: { limit: { type: "integer", description: "How many, 1–100. Default 50.", minimum: 1, maximum: 100 } } },
  mode: "content",
  effect: { readOnly: true, openWorld: true, idempotent: true },
  label: () => "Listing the shop's collections",
  run: (input, ctx) =>
    guarded(ctx, async () => {
      const source = await resolveSource(ctx.settings, ctx.site);
      const limit = Number(input.limit ?? 50);
      const collections = source.kind === "demo" ? demoCollections(source.catalogue).slice(0, limit) : await listCollections(ctx, source.connection, limit, ctx.signal);

      return { from: sourceLine(source), collections };
    }),
};

// ── the one write ────────────────────────────────────────────────────────

const ALLOWED_TAGS = new Set(["p", "br", "strong", "em", "b", "i", "u", "ul", "ol", "li", "h2", "h3", "h4", "h5", "h6", "blockquote", "a", "span"]);

/** A description is refused (never cleaned up) when it holds anything but plain formatting and links. */
export function descriptionProblem(html: string): string | null {
  for (const match of html.matchAll(/<\/?([a-zA-Z][a-zA-Z0-9]*)([^>]*)>/g)) {
    const tag = match[1]!.toLowerCase();
    const attributes = match[2] ?? "";

    if (!ALLOWED_TAGS.has(tag)) return `the description has a <${tag}> element; only paragraphs, line breaks, emphasis, lists, headings, quotes and links are allowed`;
    for (const attribute of attributes.matchAll(/([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*(=\s*("[^"]*"|'[^']*'|[^\s>]+))?/g)) {
      const name = attribute[1]!.toLowerCase();
      const value = (attribute[3] ?? "").replace(/^["']|["']$/g, "").trim();

      if (name === "/") continue;
      if (tag !== "a" || name !== "href") return `the description has a “${name}” attribute; only links' href is allowed`;
      if (!/^(https:\/\/|http:\/\/|mailto:|\/|#)/i.test(value)) return "a link in the description doesn't start with https://, mailto:, / or #";
    }
  }
  if (/<!--|<!\[CDATA\[/i.test(html)) return "the description has a comment or CDATA section";
  return null;
}

function snapshot(copy: ProductCopy, change: CopyChange) {
  const out: Record<string, unknown> = {};

  if (change.title !== undefined) out.title = copy.title;
  if (change.descriptionHtml !== undefined) out.descriptionHtml = copy.descriptionHtml;
  if (change.seoTitle !== undefined) out.seoTitle = copy.seoTitle;
  if (change.seoDescription !== undefined) out.seoDescription = copy.seoDescription;
  if (change.imageAlts?.length) out.imageAlts = change.imageAlts.map((item) => ({ position: item.position, alt: copy.images.find((image) => image.position === item.position)?.alt ?? null }));
  return out;
}

const updateTool: SiteToolContribution = {
  name: "shopify_update_product_copy",
  title: "Change product copy on Shopify (changes Shopify directly)",
  description: [
    "Changes a product's words IN THE CONNECTED SHOPIFY STORE: its title, its description (HTML), its search title and search description, and the descriptions (alt text) of its pictures.",
    "This changes Shopify directly and the change is live in the store at once: it does NOT go through Proof, it is not part of the site's changes, and Discard or Undo in the app can't take it back.",
    "Before calling it: read the product with shopify_get_product, show the person the exact current text and the exact new text for every field you would change, say plainly that it goes live in the store straight away, and ask for a yes.",
    "Call it only after the person said yes in this conversation, with exactly the text they approved. If they change any word, show it again and ask again.",
    "It never changes price, stock, availability, status, the handle, or deletes anything — say so if asked; those stay in Shopify's admin.",
    "Returns the text before and after, so you can tell the person exactly what changed.",
  ].join(" "),
  input: {
    type: "object",
    properties: {
      handle: { type: "string", description: "The product's handle.", minLength: 1, maxLength: 255 },
      title: { type: "string", description: "The new title.", minLength: 1, maxLength: 255 },
      descriptionHtml: { type: "string", description: "The new description, as simple HTML (paragraphs, emphasis, lists, links).", maxLength: 20000 },
      seoTitle: { type: "string", description: "The new title search engines show.", maxLength: 255 },
      seoDescription: { type: "string", description: "The new description search engines show.", maxLength: 320 },
      imageAlts: {
        type: "array",
        description: "New descriptions for pictures, by position (1 is the first picture).",
        maxItems: 50,
        items: {
          type: "object",
          properties: { position: { type: "integer", minimum: 1, maximum: 250 }, alt: { type: "string", maxLength: 512 } },
          required: ["position", "alt"],
        },
      },
    },
    required: ["handle"],
  },
  mode: "content",
  effect: { readOnly: false, destructive: true, idempotent: true, openWorld: true },
  enabledBy: "allowProductEdits",
  label: (input) => `Changing the copy of “${String(input.handle).slice(0, 40)}” on Shopify`,
  run: (input, ctx) =>
    guarded(ctx, async () => {
      const source = await resolveSource(ctx.settings, ctx.site);

      if (source.kind !== "store" || source.via !== "settings") {
        return { content: "Product copy can only be changed in a store connected in the Shopify plugin's settings, with an Admin API token. Nothing was changed.", isError: true };
      }
      const connection = source.connection;
      const handle = String(input.handle);
      const change: CopyChange = {};

      if (typeof input.title === "string") change.title = input.title.trim();
      if (typeof input.descriptionHtml === "string") change.descriptionHtml = input.descriptionHtml;
      if (typeof input.seoTitle === "string") change.seoTitle = input.seoTitle;
      if (typeof input.seoDescription === "string") change.seoDescription = input.seoDescription;
      if (Array.isArray(input.imageAlts)) change.imageAlts = (input.imageAlts as Array<{ position: number; alt: string }>).map((item) => ({ position: Number(item.position), alt: String(item.alt) }));
      if (Object.keys(change).length === 0 || (change.imageAlts && change.imageAlts.length === 0 && Object.keys(change).length === 1)) {
        return { content: "Nothing to change: give a new title, description, search title, search description or picture descriptions.", isError: true };
      }
      if (change.title === "") return { content: "A product needs a title; it can't be empty. Nothing was changed.", isError: true };
      const problem = change.descriptionHtml !== undefined ? descriptionProblem(change.descriptionHtml) : null;

      if (problem) return { content: `Not sent: ${problem}. Nothing was changed.`, isError: true };
      const token = await adminToken(ctx, connection, Date.now(), ctx.signal);
      const before = await productCopy(ctx, connection, handle, token, ctx.signal);

      if (!before) return { content: `${connection.host} has no product with the handle “${handle}”. Nothing was changed.`, isError: true };
      await updateCopy(ctx, connection, before, change, token, ctx.signal);
      const after = await productCopy(ctx, connection, handle, token, ctx.signal);

      ctx.log.info(`changed the copy of ${handle} on ${connection.host}: ${Object.keys(change).join(", ")}`);
      return {
        changed: `the product “${before.title}” in the store ${connection.host}`,
        live: "These changes are live in the store now. They are not in the site's pending changes and can't be discarded from the app.",
        before: snapshot(before, change),
        after: after ? snapshot(after, change) : null,
      };
    }),
};

export const tools: SiteToolContribution[] = [storeStatus, searchTool, getTool, collectionsTool, updateTool];
