// @ts-check
// Where the components read the site's kit settings. In the package they come
// from the integration (a virtual module it serves); a vendored copy
// (scripts/vendor.mjs) replaces this one file with plain defaults that read
// src/data/scripts.json and src/content/forms/ directly.
export { mailto, options, scripts, scriptsFile, utm } from "virtual:galley-kit/config";
