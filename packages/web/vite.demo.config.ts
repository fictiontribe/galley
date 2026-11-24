/**
 * The in-browser demo: the real app with the mock server running in the
 * page, on the sample site, served from /demo/ on the marketing site. Built
 * by `pnpm build:demo` (demo/scripts/build.mjs), which first prepares the
 * sample site's snapshot in demo/.work/public. The product build
 * (vite.config.ts) never sees any of this: nothing under demo/ is imported
 * by src/.
 */
import { fileURLToPath } from "node:url";
import { defineConfig, mergeConfig } from "vite";
import product from "./vite.config.ts";
import { demoPlugin } from "./demo/build/plugin.ts";

const here = (path: string) => fileURLToPath(new URL(path, import.meta.url));
const base = "/demo/";
const nodeShim = here("./demo/shim/node.ts");

export default mergeConfig(
  product,
  defineConfig({
    root: here("./demo"),
    base,
    publicDir: here("./demo/.work/public"),
    plugins: [demoPlugin({ starterDir: here("../../starters/astro-editorial"), publicDir: here("./demo/.work/public"), base, mockDir: here("./mock"), demoDir: here("./demo") })],
    resolve: {
      alias: { "node:crypto": nodeShim, "node:fs": nodeShim, "node:url": nodeShim },
    },
    build: {
      outDir: here("./demo/dist"),
      emptyOutDir: true,
      // The snapshot's pages are files, not the app's: nothing in them is reported as an import.
      copyPublicDir: true,
    },
  }),
);
