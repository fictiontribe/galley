/**
 * @galley/plugin-shopify — a store's products for a Galley site, written
 * against @galley/plugin-kit only, the way a third party writes a plugin.
 *
 * Shopify keeps what it is good at (products, prices, stock, cart,
 * checkout, orders); the site — its pages, campaigns, editorial and look —
 * is files Galley edits. This plugin connects the two: product and
 * collection pickers for page sections (data sources), read-only store
 * tools for the assistant and MCP, a publish check that warns about
 * products a page names but the store no longer has, and — only when the
 * person switches it on — product copy edits that change the store
 * directly (they go live at once; Proof doesn't apply to them).
 *
 * "Shopify" is a trademark of Shopify Inc.; this plugin is not made or
 * endorsed by Shopify. It is named only to say what it connects to.
 */
import { definePlugin, PLUGIN_API_VERSION, type GalleyPlugin, type PluginSettingField } from "@galley/plugin-kit";
import { DEFAULT_API_VERSION } from "./client";
import { collectionSource, productSource } from "./data-sources";
import { beforePublish } from "./hooks";
import { tools } from "./tools";

export const SHOPIFY_PLUGIN_NAME = "@galley/plugin-shopify";

// #region settings
export const settings: PluginSettingField[] = [
  {
    key: "storeDomain",
    label: "Store address",
    help: "The store's myshopify.com address, e.g. your-store.myshopify.com. A site also names its store in src/data/shop/store.json; the two must match.",
    placeholder: "your-store.myshopify.com",
    pattern: "^(https?://)?[A-Za-z0-9.-]+(:[0-9]+)?/?$",
    env: ["SHOPIFY_STORE_DOMAIN"],
  },
  {
    key: "storefrontPrivateToken",
    label: "Storefront API private token (optional)",
    help: "Leave it empty to read the store without a token: products, collections, search and carts work that way. A private token from the store's Headless channel lifts the limits and lets the assistant see stock counts. It stays on this computer.",
    secret: true,
    env: ["SHOPIFY_STOREFRONT_PRIVATE_TOKEN"],
  },
  {
    key: "storefrontPublicToken",
    label: "Storefront API public token (optional)",
    help: "Used only when there is no private token. Public tokens are meant to be seen by shoppers; the site's own pages carry theirs in src/data/shop/store.json.",
    secret: true,
    env: ["SHOPIFY_STOREFRONT_PUBLIC_TOKEN"],
  },
  {
    key: "adminToken",
    label: "Admin API access token (optional)",
    help: "Only needed to let the assistant edit product copy. From an app installed on the store with the write_products permission (and write_files for picture descriptions).",
    secret: true,
    placeholder: "shpat_…",
    env: ["SHOPIFY_ADMIN_TOKEN"],
  },
  {
    key: "adminClientId",
    label: "Admin app client ID (optional)",
    help: "Instead of a token: the client ID of a Dev Dashboard app installed on the store (same organisation). The app then signs in for 24 hours at a time.",
    env: ["SHOPIFY_ADMIN_CLIENT_ID"],
  },
  {
    key: "adminClientSecret",
    label: "Admin app client secret (optional)",
    help: "The secret that goes with the client ID above.",
    secret: true,
    env: ["SHOPIFY_ADMIN_CLIENT_SECRET"],
  },
  // #region switch
  {
    key: "allowProductEdits",
    type: "toggle",
    label: "Let the assistant edit product copy on Shopify",
    consequence: "Product titles, descriptions, search texts and picture descriptions the assistant changes go live in the store at once — they don't wait in Proof.",
    help: "It shows you the new text and asks before each change. Prices, stock and status are never touched. Needs the Admin API token (or client ID and secret) above.",
  },
  // #endregion switch
  {
    key: "apiVersion",
    label: "API version (optional)",
    help: `Leave empty for ${DEFAULT_API_VERSION}. Versions look like ${DEFAULT_API_VERSION}; Shopify keeps each one for at least a year.`,
    placeholder: DEFAULT_API_VERSION,
    pattern: "^\\d{4}-(01|04|07|10)$",
  },
];
// #endregion settings

export function createShopifyPlugin(): GalleyPlugin {
  return definePlugin({
    name: SHOPIFY_PLUGIN_NAME,
    displayName: "Shopify",
    description: "Show a store's products on the site's pages: pick products and collections for sections, let the assistant look things up in the store, and — if you switch it on — let it edit product copy in the store.",
    version: "0.1.0",
    apiVersion: PLUGIN_API_VERSION,
    settings,
    tools,
    dataSources: [productSource, collectionSource],
    hooks: { beforePublish },
  });
}

export const shopifyPlugin = createShopifyPlugin();
export default shopifyPlugin;

export { connectionFrom, DEFAULT_API_VERSION, graphql, scrub, ShopifyError, storeOrigin, throttleWait, type StoreConnection } from "./client";
export { referencedHandles } from "./hooks";
export { DEMO_CATALOGUE_FILE, resolveSource, SITE_STORE_FILE, type DemoCatalogue } from "./source";
export { adminToken, existingHandles, formatMoney, getProduct, productCopy, searchProducts, updateCopy } from "./store";
export { descriptionProblem } from "./tools";
