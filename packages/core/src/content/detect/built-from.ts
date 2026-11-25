/**
 * What a site is built from: the adapter's `builtFrom` globs and the
 * settings' `build.sources`, kept on the model. A file outside them (a
 * README, a script, a record kept beside the site) can name a picture
 * without the built site using it. With no list, every file counts.
 */
import picomatch from "picomatch";
import type { SiteModel } from "../../types";

/**
 * Globs for what a site is built from, as the engine keeps them: from the
 * site root, forward slashes, no way out of the site. Null when one of them
 * isn't that.
 */
export function builtFromGlobs(list: readonly string[]): string[] | null {
  const globs: string[] = [];

  for (const item of list) {
    const glob = item.trim().replace(/\\/g, "/").replace(/^\.\//, "");

    if (glob === "" || glob.startsWith("/") || /^[A-Za-z]:/.test(glob) || glob.split("/").includes("..")) return null;
    globs.push(glob);
  }
  return [...new Set(globs)];
}

/** Says whether a site-relative file is part of what the site is built from. */
export function builtFromMatcher(model: Pick<SiteModel, "builtFrom">): (path: string) => boolean {
  return model.builtFrom ? picomatch(model.builtFrom, { dot: true }) : () => true;
}

/**
 * The parts of a site its model names that fall outside what it says the
 * site is built from: a collection's folder or file, a media folder, the
 * folder of file-based routes. Each is something the built site certainly
 * reads, so an adapter whose `builtFrom` leaves one out has it wrong. Empty
 * when there is no list.
 */
export function outsideBuiltFrom(model: SiteModel): string[] {
  if (!model.builtFrom) return [];
  const built = builtFromMatcher(model);
  // A folder is inside when a file in it would be.
  const folder = (dir: string) => built(`${dir === "." || dir === "" ? "" : `${dir.replace(/\/+$/, "")}/`}file`);
  const outside: string[] = [];

  for (const collection of model.collections) if (!(collection.kind === "data" ? built(collection.path) : folder(collection.path))) outside.push(collection.path);
  for (const root of model.media.roots) if (!folder(root.dir)) outside.push(root.dir);
  if (model.routesDir && !folder(model.routesDir)) outside.push(model.routesDir);
  return [...new Set(outside)].sort();
}
