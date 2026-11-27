// @ts-check
// Every name, path and default the integration uses, in one place. The
// toolbar app imports this file too, so it must stay free of Node APIs.

/** The product the toolbar app is named after. */
export const PRODUCT_NAME = "Galley";

/** The npm package name, used as the integration's name in Astro's logs. */
export const INTEGRATION_NAME = "@galleycms/astro";

/** Dev Toolbar app id; also the prefix of anything the app stores. */
export const APP_ID = "galley";

/** Where the dev server answers the toolbar's status question. */
export const STATUS_PATH = "/__galley/status";

/** Where the dev server says which managed scripts a page loads (`?path=/about/`). Dev only. */
export const SCRIPTS_MANIFEST_PATH = "/__galley/scripts.json";

/** Where a local Galley listens unless told otherwise (`galley` picks 4400 first). */
export const DEFAULT_URL = "http://127.0.0.1:4400";

/** Environment variable that overrides the default address. */
export const URL_ENV = "GALLEY_URL";

/** The command the toolbar suggests when Galley is not running. */
export const START_COMMAND = "npx galley-cms";

/** How long the status check waits for Galley before saying it is not running. */
export const PROBE_TIMEOUT_MS = 1000;

/** How long one answer is reused, so opening the toolbar repeatedly stays cheap. */
export const STATUS_CACHE_MS = 1000;

/** The Galley mark (two bars over a caret, like a proofreader's insert mark), in currentColor. */
export const ICON =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" aria-hidden="true"><path fill="currentColor" d="M2 6h28v4H2zM2 14h10v4H2zM20 14h10v4H20zM8.76 24.24 16 15.33l7.24 8.91-3.1 2.52L16 21.67l-4.14 5.09z"/></svg>';
