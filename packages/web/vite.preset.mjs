/**
 * For a program that builds its own edition of the editor from this source:
 * the two aliases the app is written with. Add it to the program's Vite
 * config, beside the React plugin:
 *
 *   import react from "@vitejs/plugin-react";
 *   import { galleyWeb } from "@galley/web/vite";
 *
 *   export default defineConfig({ plugins: [react(), galleyWeb()] });
 *
 * `@` and `@brand` are then the app's: the program's own source can't use
 * either name for something else.
 */
import { fileURLToPath } from "node:url";

/** Where each alias leads. */
export const galleyWebAliases = Object.freeze({
  "@": fileURLToPath(new URL("./src", import.meta.url)),
  "@brand": fileURLToPath(new URL("../../brand", import.meta.url)),
});

/** A Vite plugin that sets the two aliases and nothing else. */
export function galleyWeb() {
  return {
    name: "galley-web",
    config: () => ({ resolve: { alias: { ...galleyWebAliases } } }),
  };
}
