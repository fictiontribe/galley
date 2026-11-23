import { defineConfig } from "astro/config";
import site from "./src/data/site.json";

// The public URL lives in src/data/site.json so it can be edited with the rest
// of the site settings. It is used for canonical links, Open Graph images and
// the sitemap.
export default defineConfig({
  site: site.url,
  output: "static",
  trailingSlash: "ignore",
  build: {
    format: "directory",
  },
});
