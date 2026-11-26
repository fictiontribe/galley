/**
 * Which file changes reshape the site model. Everything else only touches the
 * content index (one file at a time) and, at most, a collection's count.
 */
import { PRODUCT } from "../brand";
import { collectionForPath, formatForPath } from "../content/index";
import type { SiteModel } from "../types";

const CONTENT_CONFIG = /^(?:src\/)?(?:content\.config|content\/config|contentlayer\.config|velite\.config)\.[cm]?[jt]s$/;
const FRAMEWORK_CONFIG =
  /^(astro|svelte|nuxt|next|docusaurus|vite|eleventy|gatsby)\.config\.[cm]?[jt]s$|^\.eleventy\.[cm]?js$|^(hugo|config)\.(toml|ya?ml|json)$|^_config\.ya?ml$/;
const LOCKFILES = /^(package-lock\.json|npm-shrinkwrap\.json|pnpm-lock\.yaml|yarn\.lock|bun\.lockb?)$/;
/** Folders where a new file can mean a new collection (detection offers each data file as one). */
const COLLECTION_HOMES = /^(src\/content|src\/data|content|data|_data)\//;

/**
 * True when `path` changing means detection must run again: the config file,
 * the content config, the framework's config, package.json or a lockfile — or
 * a content-looking file appearing where no collection owns it yet.
 */
export function shapesModel(model: SiteModel, path: string, exists: boolean): boolean {
  if (path === PRODUCT.configFile || path === "package.json") return true;
  if (CONTENT_CONFIG.test(path) || FRAMEWORK_CONFIG.test(path) || LOCKFILES.test(path)) return true;
  if (formatForPath(path) === null || !COLLECTION_HOMES.test(path)) return false;
  const owner = collectionForPath(model, path);

  // A data collection's own file going away removes that collection; a new
  // file nobody owns may be a new one. Entries in a known collection only
  // change its count, which is recounted without re-detecting.
  if (owner) return owner.kind === "data" && !exists;
  return exists;
}
