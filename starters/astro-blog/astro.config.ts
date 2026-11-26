import { createRequire } from "node:module";
import { dirname } from "node:path";
import { defineConfig } from "astro/config";
import type { AstroIntegration } from "astro";
import { satteri } from "@astrojs/markdown-satteri";
import pkg from "./package.json";
import site from "./src/data/site.json";
import galley from "./src/galley/integration.js";
import { EMBED_KINDS } from "./src/lib/embed-kinds";
import sectionGallery from "./scripts/gallery/integration.mjs";

// The public URL lives in src/data/site.json so it can be edited with the rest
// of the site settings. It is used for canonical links, share images, feeds and
// the sitemap. A host can override it at build time, and serve the site under
// a sub-path, with `astro build --site https://… --base /repo` (see README).

// The fonts are self-hosted from the @fontsource-variable packages: tokens.css
// imports their CSS. Where node_modules is a link to somewhere else (pnpm's
// store, a shared install) `astro dev` refuses files outside the project, so
// the font packages' own folders are added to what dev may serve. The build
// copies the files into dist/ either way.
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

type Ctx = {
  setField: (node: any, key: string, value: unknown) => void;
  replaceNode: (node: any, next: any) => void;
  insertBefore: (node: any, next: any) => void;
  insertAfter: (node: any, next: any) => void;
};

const kinds = new Set<string>(EMBED_KINDS);
const escapeAttribute = (value: string) => value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");

/**
 * The Markdown plugins, in one processor:
 *
 * - Embeds: a fenced block whose language is an embed kind (```chart,
 *   ```compare, ```verdict…) becomes a placeholder that the post page swaps for
 *   the component, with the block's YAML as its props (src/lib/embeds.ts).
 *   The file stays plain Markdown: on GitHub, or in any editor, the block
 *   reads as YAML.
 * - Code titles: ```js title="meter.js" gets a caption above the code.
 * - Base links: links and images written from the site root ("/about/") get
 *   the base path, so bodies work under a sub-path exactly like front matter.
 */
function markdown(): AstroIntegration {
  return {
    name: "blog-markdown",
    hooks: {
      "astro:config:setup": ({ config, updateConfig }) => {
        const base = config.base.replace(/\/+$/, "");
        const prefix = (url: string) => (base && url.startsWith("/") && !url.startsWith("//") && !url.startsWith(`${base}/`) ? `${base}${url}` : url);
        const rebase = (node: { url: string }, ctx: Ctx) => {
          const next = prefix(node.url);
          if (next !== node.url) ctx.setField(node, "url", next);
        };

        updateConfig({
          markdown: {
            processor: satteri({
              mdastPlugins: [
                {
                  name: "blog-embeds",
                  code(node: { lang?: string | null; meta?: string | null; value: string }, ctx: Ctx) {
                    const lang = (node.lang ?? "").toLowerCase();
                    if (kinds.has(lang)) {
                      ctx.replaceNode(node, {
                        type: "html",
                        value: `<div data-embed="${lang}" data-source="${encodeURIComponent(node.value)}"></div>`,
                      });
                      return;
                    }
                    const title = /(?:^|\s)title=(?:"([^"]+)"|'([^']+)'|(\S+))/.exec(node.meta ?? "");
                    const name = title?.[1] ?? title?.[2] ?? title?.[3];
                    if (name) {
                      ctx.insertBefore(node, { type: "html", value: `<figure class="code-figure"><figcaption class="code-figure__title">${escapeAttribute(name)}</figcaption>` });
                      ctx.insertAfter(node, { type: "html", value: "</figure>" });
                    }
                  },
                  link: rebase,
                  image: rebase,
                  definition: rebase,
                },
              ],
            }),
          },
        });
      },
    },
  };
}

export default defineConfig({
  site: site.url,
  output: "static",
  trailingSlash: "ignore",
  build: {
    format: "directory",
  },
  markdown: {
    // Code colours come from the look: tokens.css sets --astro-code-* for light and dark.
    shikiConfig: { theme: "css-variables" },
  },
  vite: {
    plugins: [serveFonts],
  },
  integrations: [
    // The agent-readable version of the site (markdown twins, llms.txt,
    // structured data, robots.txt, sitemap.xml), from src/data/visibility.json.
    galley(),
    markdown(),
    // Only for `npm run thumbnails`: the section gallery at /__gallery/.
    // Never part of a normal build.
    ...(process.env.SECTION_GALLERY ? [sectionGallery()] : []),
  ],
});
