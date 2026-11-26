import { afterAll, describe, expect, it } from "vitest";

import { detectWithAdapters, nuxtAdapter } from "../../src/adapter/index";
import { detectSite } from "../../src/content/index";
import { forgetPreviewSaves } from "../../src/workspace/index";
import type { SiteModel } from "../../src/types";
import { cleanup, entries, site } from "../adapter/helpers";

afterAll(cleanup);

const PKG = JSON.stringify({
  name: "harbour-nuxt",
  scripts: { dev: "nuxt dev", build: "nuxt build" },
  dependencies: { nuxt: "^3.16.0", "@nuxt/content": "^3.4.0" },
});
const urls = (model: SiteModel) => Object.fromEntries(model.collections.map((collection) => [collection.id, collection.url]));

describe("nuxtAdapter", () => {
  it("scores package + config, package only, config only, and refuses unrelated sites", async () => {
    const both = await detectWithAdapters(site({ "package.json": PKG, "nuxt.config.ts": "export default defineNuxtConfig({});" }));
    const pkgOnly = await detectWithAdapters(site({ "package.json": PKG }));
    const configOnly = await detectWithAdapters(site({ "nuxt.config.mjs": "export default {};" }));
    const foreign = await detectWithAdapters(site({ "package.json": JSON.stringify({ dependencies: { express: "^4.0.0" } }), ...entries("notes") }), {
      adapters: [nuxtAdapter],
      builtins: false,
    });

    expect(both.adapter.id).toBe("nuxt");
    expect(both.match).toEqual({ confidence: 0.95, version: "3.16.0" });
    expect(pkgOnly.match).toEqual({ confidence: 0.9, version: "3.16.0" });
    expect(configOnly.match).toEqual({ confidence: 0.8 });
    expect(foreign.candidates[0]?.match).toBeNull();
  });

  it("reads nuxt.config.* settings and @nuxt/content v3 content.config.ts collections and schemas", async () => {
    const root = site({
      "package.json": PKG,
      "nuxt.config.ts": `
        export default defineNuxtConfig({
          srcDir: "app",
          dir: { public: "assets-public" },
          nitro: { output: { publicDir: "dist/static" } },
          app: { baseURL: "/portal/" },
          router: { options: { strict: true } },
          devServer: { port: 3100 },
          site: { url: "https://harbour-portal.org" },
        });
      `,
      "content.config.ts": `
        import { defineContentConfig, defineCollection, z } from "@nuxt/content";
        export default defineContentConfig({
          collections: {
            blog: defineCollection({
              type: "page",
              source: "blog/**/*.md",
              schema: z.object({
                title: z.string(),
                featured: z.boolean().default(false),
              }),
            }),
            docs: defineCollection({
              type: "page",
              source: { include: "guides/**", prefix: "/handbook" },
            }),
            authors: defineCollection({
              type: "data",
              source: "authors/**.json",
              schema: z.object({ name: z.string(), role: z.string() }),
            }),
            settings: defineCollection({
              type: "data",
              source: "data/settings.yml",
            }),
          },
        });
      `,
      "app/assets-public/images/hero.png": "",
      "app/pages/index.vue": "<template><div/></template>",
      ...entries("content/blog"),
      ...entries("content/guides"),
      "content/authors/ana.json": '{ "name": "Ana", "role": "Keeper" }\n',
      "content/authors/ben.json": '{ "name": "Ben", "role": "Engineer" }\n',
      "content/data/settings.yml": "siteName: Harbour\n",
    });
    const model = await detectSite(root);

    expect(model.framework).toEqual({ id: "nuxt", name: "Nuxt", version: "3.16.0" });
    expect(model.dev).toEqual({ command: "npm run dev", port: 3100 });
    expect(model.build).toEqual({ command: "npm run build", outDir: "dist/static" });
    expect(model.media.dir).toBe("app/assets-public/images");
    expect(model.routesDir).toBe("app/pages");
    expect(model.urls).toEqual({ production: "https://harbour-portal.org" });
    expect(urls(model)).toEqual({
      blog: "/portal/blog/{slug}",
      docs: "/portal/handbook/{slug}",
      authors: null,
      settings: null,
    });
    expect(model.collections.find((c) => c.id === "blog")?.fields.find((f) => f.key === "featured")).toMatchObject({
      type: "boolean",
      default: false,
      source: "schema",
    });
    expect(model.collections.find((c) => c.id === "authors")).toMatchObject({ kind: "entries", format: "json", count: 2 });
    expect(model.collections.find((c) => c.id === "settings")).toMatchObject({ kind: "data", format: "yaml", path: "content/data/settings.yml" });
  });

  it("reads @nuxt/content v2 content.sources from nuxt.config.*", async () => {
    const root = site({
      "package.json": PKG,
      "nuxt.config.ts": `
        import { resolve } from "node:path";
        export default defineNuxtConfig({
          content: {
            sources: {
              handbook: { driver: "fs", prefix: "/manual", base: resolve(__dirname, "docs-src") },
              remote: { driver: "github", repo: "org/repo" },
            },
          },
        });
      `,
      ...entries("docs-src"),
      ...entries("content/blog"),
    });
    const model = await detectSite(root);

    expect(urls(model)).toEqual({
      handbook: "/manual/{slug}/",
      blog: "/blog/{slug}/",
    });
    expect(model.notes.some((n) => n.includes("github"))).toBe(true);
  });

  it("forgets .data/content/contents.sqlite when present and omits it when absent", async () => {
    const withCache = site({
      "package.json": PKG,
      "nuxt.config.ts": "export default defineNuxtConfig({});",
      ...entries("content/posts"),
      ".data/content/contents.sqlite": "sqlite-cache",
    });
    const withoutCache = site({
      "package.json": PKG,
      "nuxt.config.ts": "export default defineNuxtConfig({});",
      ...entries("content/posts"),
    });

    const cachedModel = await detectSite(withCache);
    const cleanModel = await detectSite(withoutCache);

    expect(cachedModel.previewSaves).toEqual([".data/content/contents.sqlite"]);
    expect(cleanModel.previewSaves).toBeUndefined();
    expect(await forgetPreviewSaves(withCache, cachedModel.previewSaves!)).toEqual([".data/content/contents.sqlite"]);
  });

  it("survives malformed nuxt.config.ts and content.config.ts cleanly", async () => {
    const root = site({
      "package.json": PKG,
      "nuxt.config.ts": "export default defineNuxtConfig({ srcDir: '../outside', {{{ broken",
      "content.config.ts": "export default broken(((",
      ...entries("content/posts"),
    });
    const model = await detectSite(root);

    expect(model.framework.id).toBe("nuxt");
    expect(model.collections.map((c) => c.id)).toEqual(["posts"]);
  });
});
