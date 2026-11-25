/**
 * For a program that builds its own edition of the editor from this source.
 * Add it to the program's Vite config, beside the React plugin:
 *
 *   import react from "@vitejs/plugin-react";
 *   import { galleyWeb } from "@galley/web/vite";
 *
 *   export default defineConfig({ plugins: [react(), galleyWeb()] });
 *
 * What it sets, and why an edition needs each:
 *
 *   - the two aliases the app's source is written with, `@` and `@brand`
 *     (so the program's own source can't use either name for something else);
 *   - one copy of React and of the router, whatever versions the program has
 *     beside the app's: with two, a hook called from an addition throws;
 *   - the app's public folder, unless the program names its own: it holds
 *     `theme.js`, which paints the saved theme before the page loads;
 *   - the app's build target, unless the program names its own.
 *
 * The app's own build uses it too (vite.config.ts).
 */
import { fileURLToPath } from "node:url";

/** Where each alias leads. */
export const galleyWebAliases = Object.freeze({
  "@": fileURLToPath(new URL("./src", import.meta.url)),
  "@brand": fileURLToPath(new URL("../../brand", import.meta.url)),
});

/** The app's public folder (`theme.js`). */
export const galleyWebPublicDir = fileURLToPath(new URL("./public", import.meta.url));
/** What the app's source is written for. */
export const galleyWebTarget = "es2023";
/** Packages there must be one copy of in the page. */
export const galleyWebDedupe = Object.freeze(["react", "react-dom", "react-router-dom"]);

/** The Vite plugin. What the program's own config already says about the public folder or the target is left as it is. */
export function galleyWeb() {
  return {
    name: "galley-web",
    config: (user = {}) => ({
      resolve: { alias: { ...galleyWebAliases }, dedupe: [...galleyWebDedupe] },
      ...(user.publicDir === undefined ? { publicDir: galleyWebPublicDir } : {}),
      ...(user.build?.target === undefined ? { build: { target: galleyWebTarget } } : {}),
    }),
  };
}
