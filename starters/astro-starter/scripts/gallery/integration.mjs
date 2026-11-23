// The section gallery: an Astro integration that adds /__gallery/ routes
// rendering every section type alone (from ./sections.md) and every page
// template in galley/templates/. scripts/make-thumbnails.mjs builds the site
// with it and photographs the result. astro.config.ts adds it only when
// SECTION_GALLERY is set, so a normal build never contains these pages.
//
// SECTION_GALLERY_LOOK=<id> serves src/styles/themes/<id>.css in place of
// src/styles/tokens.css for that build — the same as copying the file over,
// without touching the working tree.

import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

export default function sectionGallery() {
  return {
    name: "section-gallery",
    hooks: {
      "astro:config:setup": ({ config, injectRoute, updateConfig }) => {
        injectRoute({ pattern: "/__gallery/[...path]", entrypoint: new URL("./gallery.astro", import.meta.url), prerender: true });

        const look = process.env.SECTION_GALLERY_LOOK;
        if (!look) return;
        const tokens = fileURLToPath(new URL("src/styles/tokens.css", config.root));
        const theme = fileURLToPath(new URL(`src/styles/themes/${look}.css`, config.root));
        if (!existsSync(theme)) throw new Error(`section-gallery: there is no look called “${look}” (expected ${theme}).`);
        updateConfig({
          vite: {
            plugins: [
              {
                name: "section-gallery-look",
                enforce: "pre",
                load(id) {
                  if (id.split("?")[0] === tokens) return readFileSync(theme, "utf8");
                },
              },
            ],
          },
        });
      },
    },
  };
}
