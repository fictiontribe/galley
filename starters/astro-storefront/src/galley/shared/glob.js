// Vendored from @galley/astro 0.1.2 by scripts/vendor.mjs. Don't edit: run the script again to update.
// @ts-check
// Page-path globs for a script's `include` / `exclude`, matched at build time
// against each page's path (without the site's base):
//
//   "/"            the home page only
//   "/pricing/"    that page (with or without the trailing slash)
//   "/blog/*"      pages one level under /blog/
//   "/blog/**"     /blog/ and everything under it
//   "*/thanks/"    `*` never crosses a "/"; `?` is one character

/** @type {Map<string, RegExp>} */
const cache = new Map();

/** @param {string} glob */
function compile(glob) {
  const known = cache.get(glob);

  if (known) return known;
  let source = "";
  let pattern = glob.trim();

  if (!pattern.startsWith("/")) pattern = `/${pattern}`;
  pattern = pattern.replace(/\/+$/, "");
  for (let index = 0; index < pattern.length; index += 1) {
    const char = pattern[index];

    if (char === "*" && pattern[index + 1] === "*") {
      // "/blog/**" also matches "/blog" itself.
      if (source.endsWith("/")) source = `${source.slice(0, -1)}(?:/.*)?`;
      else source += ".*";
      index += 1;
    } else if (char === "*") source += "[^/]*";
    else if (char === "?") source += "[^/]";
    else source += String(char).replace(/[.+^${}()|[\]\\]/g, "\\$&");
  }
  const regex = new RegExp(`^${source}/?$`);

  cache.set(glob, regex);
  return regex;
}

/**
 * @param {string} path  The page's path, e.g. "/pricing/".
 * @param {string} glob
 */
export function matchGlob(path, glob) {
  const clean = path.split(/[?#]/)[0] || "/";

  return compile(glob).test(clean === "/" ? "/" : clean.replace(/\/+$/, "")) || (glob.trim().replace(/\/+$/, "") === "" && clean === "/");
}

/**
 * Whether a page is in an entry's scope: in `include` (or `include` is empty)
 * and not in `exclude`.
 *
 * @param {string} path
 * @param {{ include?: string[]; exclude?: string[] }} entry
 */
export function inScope(path, entry) {
  const included = !entry.include || entry.include.length === 0 || entry.include.some((glob) => matchGlob(path, glob));

  return included && !(entry.exclude ?? []).some((glob) => matchGlob(path, glob));
}
