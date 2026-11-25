// Vendored from @galley/astro 0.4.0 by scripts/vendor.mjs. Don't edit: run the script again to update.
// @ts-check
// `@galley/astro/catalog` — what the site kit knows how to do, as JSON-able
// data, so an app can list it: the form destinations, the third-party
// script integrations and the AI crawlers robots.txt can allow or block. The
// first two are the contract shared with the app (packages/core/src/kit-catalog.ts,
// mirrored into catalog-data.js); the crawlers are the kit's own
// (visibility/crawlers.js), in the same shape as the app's CrawlerInfo.
import { FORM_PROVIDERS, SCRIPT_INTEGRATIONS } from "./catalog-data.js";
import { AI_CRAWLERS, aiCrawler, describePolicy } from "./visibility/crawlers.js";

/** @typedef {import("./visibility/crawlers.js").AiCrawler} AiCrawler */

/** The AI crawlers src/data/visibility.json can allow or block, with what each is for. */
export const aiCrawlers = AI_CRAWLERS;

export { aiCrawler, describePolicy };

/** @typedef {import("./kit").ScriptIntegrationInfo} ScriptIntegrationInfo */
/** @typedef {import("./kit").FormProviderInfo} FormProviderInfo */

/** @type {readonly ScriptIntegrationInfo[]} */
export const scriptIntegrations = SCRIPT_INTEGRATIONS;

/** @type {readonly FormProviderInfo[]} */
export const formProviders = FORM_PROVIDERS;

/**
 * @param {string} kind
 * @returns {ScriptIntegrationInfo | undefined}
 */
export function scriptIntegration(kind) {
  return SCRIPT_INTEGRATIONS.find((entry) => entry.kind === kind);
}

/**
 * @param {string} id
 * @returns {FormProviderInfo | undefined}
 */
export function formProvider(id) {
  return FORM_PROVIDERS.find((entry) => entry.id === id);
}
