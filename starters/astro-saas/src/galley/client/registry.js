// Vendored from @galley/astro 0.3.0 by scripts/vendor.mjs. Don't edit: run the script again to update.
// @ts-check
// The one seam for adding a form destination: a submitter registered under a
// provider id. Built-in providers load from ./providers/ on demand; a site or
// plugin registers its own before (or after) the forms start:
//
//   import { registerFormProvider } from "@galley/astro/client";
//   registerFormProvider("crm", async (values, destination, context) => {
//     const res = await fetch(String(destination.settings.url), { method: "POST", body: JSON.stringify(values) });
//     return res.ok ? { ok: true } : { ok: false, detail: `HTTP ${res.status}` };
//   });
//
// or, without a bundler: window.galleyForms.registerProvider("crm", fn).

/** @typedef {import("./types").Submitter} Submitter */

/** @type {Map<string, Submitter>} */
const registered = new Map();

/**
 * @param {string} id  The `provider` a destination names.
 * @param {Submitter} submitter
 */
export function registerFormProvider(id, submitter) {
  if (typeof submitter !== "function") throw new TypeError(`registerFormProvider("${id}") needs a function.`);
  registered.set(id, submitter);
}

/** @param {string} id */
export function registeredProvider(id) {
  return registered.get(id);
}
