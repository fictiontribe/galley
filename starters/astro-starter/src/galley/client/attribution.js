// Vendored from @galley/astro 0.1.2 by scripts/vendor.mjs. Don't edit: run the script again to update.
// @ts-check
// UTM memory for `autofill: { from: "utm", touch }`: the campaign parameters
// of the visitor's first landing and of their latest landing, kept in this
// site's own localStorage under "galley:attribution" (nothing leaves the
// browser until a form is sent). A landing counts when its address carries
// at least one utm_* parameter.
//
// Consent: when the site uses a consent mode (window.galleyConsent, set up by
// the scripts runtime) the memory is written only once "marketing" is
// granted. Until then a form can still use the current page's parameters.
//
// The same capture runs on every page from the scripts runtime's head
// snippet (scripts/inline.js) when any form uses UTM autofill; this file is
// the forms runtime's copy, so pages with a form capture too.

export const STORAGE_KEY = "galley:attribution";
export const UTM_KEYS = ["utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content", "utm_id"];

/** @typedef {{ [key: string]: string }} Touch */

function allowed() {
  const consent = window.galleyConsent;

  return !consent || consent.mode === "none" || consent.granted("marketing");
}

/** @returns {{ first?: Touch; last?: Touch }} */
export function readAttribution() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}") || {};
  } catch {
    return {};
  }
}

/** The utm_* parameters of an address, with the landing page and referrer. */
export function touchFrom(/** @type {string} */ href, /** @type {string} */ referrer) {
  const url = new URL(href);
  /** @type {Touch} */
  const touch = {};

  for (const key of UTM_KEYS) {
    const value = url.searchParams.get(key);

    if (value) touch[key] = value.slice(0, 200);
  }
  if (Object.keys(touch).length === 0) return null;
  touch.landing_page = url.origin + url.pathname;
  if (referrer) touch.referrer = referrer.slice(0, 500);
  touch.at = new Date().toISOString();
  return touch;
}

/** Remembers this landing if it carries UTM parameters and consent allows. */
export function captureAttribution(href = location.href, referrer = document.referrer) {
  const touch = touchFrom(href, referrer);

  if (!touch || !allowed()) return;
  try {
    const memory = readAttribution();

    localStorage.setItem(STORAGE_KEY, JSON.stringify({ first: memory.first ?? touch, last: touch }));
  } catch {
    // Storage can be full or blocked; the current page's parameters still work.
  }
}

/**
 * @param {string} key  e.g. "utm_source"; also "landing_page", "referrer".
 * @param {"first" | "last"} [touch]
 */
export function utmValue(key, touch = "last") {
  const memory = readAttribution();
  const remembered = memory[touch]?.[key];

  if (remembered) return remembered;
  return new URL(location.href).searchParams.get(key) ?? "";
}
