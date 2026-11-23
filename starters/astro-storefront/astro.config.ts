import { createRequire } from "node:module";
import { dirname } from "node:path";
import { defineConfig } from "astro/config";
import pkg from "./package.json";
import site from "./src/data/site.json";
import galley from "./src/galley/integration.js";
import sectionGallery from "./scripts/gallery/integration.mjs";

// The fonts are self-hosted from the @fontsource-variable packages: tokens.css
// imports their CSS, and that CSS points at .woff2 files inside the packages.
// `astro dev` serves files only from inside the project's workspace, so where
// node_modules is a link to somewhere else (pnpm's store, a shared install, a
// preview copy) every font was refused (403) and the page fell back to the
// next serif in the stack: the dev server and the build showed different type.
// This adds exactly the font packages' own folders to what dev may serve; the
// build copies the files into dist/ either way.
const require = createRequire(import.meta.url);
const fontFolders = Object.keys(pkg.dependencies)
  .filter((name) => name.startsWith("@fontsource"))
  .map((name) => dirname(require.resolve(`${name}/package.json`)));
const serveFonts = {
  name: "serve-font-packages",
  configResolved(config: { server: { fs: { allow: string[] } } }) {
    for (const folder of fontFolders) if (!config.server.fs.allow.includes(folder)) config.server.fs.allow.push(folder);
  },
};

// The public URL lives in src/data/site.json so it can be edited with the rest
// of the site settings. It is used for canonical links, Open Graph images and
// the sitemap. A host can override it at build time, and serve the site under
// a sub-path, with `astro build --site https://… --base /repo` (see README).
export default defineConfig({
  site: site.url,
  output: "static",
  trailingSlash: "ignore",
  build: {
    format: "directory",
  },
  vite: {
    plugins: [serveFonts],
  },
  integrations: [
    // The agent-readable version of the site (markdown twins, llms.txt,
    // structured data, robots.txt, sitemap.xml), from src/data/visibility.json.
    galley(),
    // Only for `npm run thumbnails`: the section gallery at /__gallery/.
    // Never part of a normal build, the sitemap or the navigation.
    ...(process.env.SECTION_GALLERY ? [sectionGallery()] : []),
  ],
});
