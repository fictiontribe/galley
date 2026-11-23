/**
 * Where the engine gets the site kit's files to put into a site.
 *
 * Inside the monorepo (the CLI run from source, the dev server, tests) they
 * are read from `packages/astro` in place, through its own vendoring script,
 * so they are always the kit as it is now. Every shipped shell — the npm CLI,
 * the desktop app's sidecar, the Docker image — runs the one CLI bundle,
 * and its build (`packages/cli/build.mjs`) replaces this module with the
 * files embedded as data, exactly as it embeds the overlay script. Nothing
 * is looked up on disk at run time there, so no install layout can lose them.
 */
import { GalleyError } from "../errors";

export interface KitBundle {
  /** The kit's version, as each file's header names it. */
  version: string;
  /** Path under src/galley/ → text, every file the vendoring script writes except settings.json. */
  files: Record<string, string>;
  /** The first version of src/galley/settings.json, for a site that has none. */
  settings: string;
}

let cached: Promise<KitBundle> | null = null;

/** The kit's files. Cached: they don't change while the app runs. */
export function loadKitBundle(): Promise<KitBundle> {
  cached ??= (async () => {
    const url = new URL("../../../astro/scripts/vendor.mjs", import.meta.url);

    try {
      const module = (await import(url.href)) as { kitBundle?: () => KitBundle };

      if (typeof module.kitBundle !== "function") throw new Error("the kit's vendoring script has no kitBundle()");
      return module.kitBundle();
    } catch (error) {
      cached = null;
      throw new GalleyError("unconfigured", "This copy of the app doesn't include the site kit's files, so it can't add them to a site.", error instanceof Error ? error.message : String(error));
    }
  })();
  return cached;
}
