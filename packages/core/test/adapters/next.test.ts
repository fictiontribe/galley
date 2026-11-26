import { afterAll, describe, expect, it } from "vitest";

import { detectWithAdapters, nextAdapter } from "../../src/adapter/index";
import { detectSite } from "../../src/content/index";
import type { SiteModel } from "../../src/types";
import { cleanup, entries, site } from "../adapter/helpers";

afterAll(cleanup);

const PKG = JSON.stringify({
  name: "harbour-next",
  scripts: { dev: "next dev", build: "next build" },
  dependencies: { next: "^15.2.0", react: "^19.0.0" },
});
const urls = (model: SiteModel) => Object.fromEntries(model.collections.map((collection) => [collection.id, collection.url]));

describe("nextAdapter", () => {
  it("scores package + config, package only, config only, and refuses unrelated sites", async () => {
    const both = await detectWithAdapters(site({ "package.json": PKG, "next.config.mjs": "export default {};" }));
    const pkgOnly = await detectWithAdapters(site({ "package.json": PKG }));
    const configOnly = await detectWithAdapters(site({ "next.config.ts": "export default {};" }));
    const foreign = await detectWithAdapters(site({ "package.json": JSON.stringify({ dependencies: { express: "^4.0.0" } }), ...entries("notes") }), {
      adapters: [nextAdapter],
      builtins: false,
    });

    expect(both.adapter.id).toBe("next");
    expect(both.match).toEqual({ confidence: 0.95, version: "15.2.0" });
    expect(pkgOnly.match).toEqual({ confidence: 0.9, version: "15.2.0" });
    expect(configOnly.match).toEqual({ confidence: 0.8 });
    expect(foreign.candidates[0]?.match).toBeNull();
  });

  it("unwraps withMDX(nextConfig), reads output/distDir/trailingSlash/basePath, and finds MDX Pages Router files", async () => {
    const root = site({
      "package.json": JSON.stringify({
        name: "harbour-next",
        scripts: { dev: "next dev", build: "next build" },
        dependencies: { next: "^15.2.0", "@next/mdx": "^15.2.0" },
      }),
      "next.config.mjs": `
        import createMDX from "@next/mdx";
        const withMDX = createMDX({ extension: /\\.mdx?$/ });
        const nextConfig = {
          output: "export",
          trailingSlash: true,
          basePath: "/docs",
          pageExtensions: ["js", "jsx", "ts", "tsx", "md", "mdx"],
        };
        export default withMDX(nextConfig);
      `,
      "pages/index.mdx": "---\ntitle: Home\n---\nWelcome.\n",
      "pages/about.mdx": "---\ntitle: About\n---\nAbout.\n",
      ...entries("content/blog"),
      "data/nav.json": '{ "links": [] }\n',
    });
    const model = await detectSite(root);

    expect(model.build).toEqual({ command: "npm run build", outDir: "out" });
    expect(model.routesDir).toBe("pages");
    expect(urls(model)).toEqual({
      pages: "/docs/{slug}/",
      blog: "/docs/blog/{slug}/",
      nav: null,
    });
    expect(model.collections.find((c) => c.id === "pages")).toMatchObject({ path: "pages", format: "mdx", count: 2 });
  });

  it("uses distDir (or .next) when output is not 'export' and defaults trailingSlash to false", async () => {
    const customDist = await detectSite(
      site({
        "package.json": PKG,
        "next.config.ts": 'export default { distDir: "build-next" };',
        ...entries("posts"),
      })
    );
    const defaultDist = await detectSite(
      site({
        "package.json": PKG,
        "next.config.ts": "export default {};",
        ...entries("posts"),
      })
    );

    expect(customDist.build?.outDir).toBe("build-next");
    expect(defaultDist.build?.outDir).toBe(".next");
    expect(urls(defaultDist)).toEqual({ posts: "/posts/{slug}" });
  });

  it("reads Contentlayer document types from contentlayer.config.ts", async () => {
    const root = site({
      "package.json": PKG,
      "next.config.js": `
        const { withContentlayer } = require("next-contentlayer");
        module.exports = withContentlayer({ trailingSlash: false });
      `,
      "contentlayer.config.ts": `
        import { defineDocumentType, makeSource } from "contentlayer/source-files";
        export const Post = defineDocumentType(() => ({
          name: "Post",
          filePathPattern: "posts/**/*.mdx",
          contentType: "mdx",
        }));
        export const Author = defineDocumentType(() => ({
          name: "Author",
          filePathPattern: "authors/*.json",
          contentType: "data",
        }));
        export default makeSource({
          contentDirPath: "content",
          documentTypes: [Post, Author],
        });
      `,
      "content/posts/hello.mdx": "---\ntitle: Hello\n---\nBody.\n",
      "content/posts/second.mdx": "---\ntitle: Second\n---\nBody.\n",
      "content/authors/ana.json": '{ "name": "Ana" }\n',
      "content/authors/ben.json": '{ "name": "Ben" }\n',
    });
    const model = await detectSite(root);

    expect(model.collections.map((c) => [c.id, c.path, c.format, c.count, c.url])).toEqual([
      ["posts", "content/posts", "mdx", 2, "/posts/{slug}"],
      ["authors", "content/authors", "json", 2, null],
    ]);
    expect(model.notes).toContain("Read 2 collections from contentlayer.config.ts.");
  });

  it("reads Velite collections from velite.config.ts", async () => {
    const root = site({
      "package.json": PKG,
      "next.config.mjs": "export default { output: 'export' };",
      "velite.config.ts": `
        import { defineConfig, defineCollection, s } from "velite";
        const articles = defineCollection({
          name: "Article",
          pattern: "articles/**/*.md",
          schema: s.object({ title: s.string() }),
        });
        export default defineConfig({
          root: "src/content",
          collections: {
            articles,
            site: defineCollection({ name: "Site", pattern: "meta/site.yaml", single: true }),
          },
        });
      `,
      ...entries("src/content/articles"),
      "src/content/meta/site.yaml": "name: Harbour\n",
    });
    const model = await detectSite(root);

    expect(model.collections.map((c) => [c.id, c.kind, c.path, c.count, c.url])).toEqual([
      ["articles", "entries", "src/content/articles", 2, "/articles/{slug}"],
      ["site", "data", "src/content/meta/site.yaml", 1, null],
    ]);
    expect(model.notes).toContain("Read 2 collections from velite.config.ts.");
  });

  it("discovers App Router page.mdx files with url: null and survives malformed configs", async () => {
    const root = site({
      "package.json": PKG,
      "next.config.mjs": "export default { pageExtensions: ['ts', 'tsx', 'mdx'] };",
      "src/app/page.mdx": "---\ntitle: Home\n---\nHome.\n",
      "src/app/about/page.mdx": "---\ntitle: About\n---\nAbout.\n",
    });
    const malformed = site({
      "package.json": PKG,
      "next.config.js": "module.exports = {{{ broken distDir: '../escape'",
      ...entries("posts"),
    });

    const model = await detectSite(root);
    const badModel = await detectSite(malformed);

    expect(model.collections.map((c) => [c.id, c.path, c.pattern, c.count, c.url])).toEqual([
      ["pages", "src/app", "**/page.{md,mdx}", 2, null],
    ]);
    expect(badModel.framework.id).toBe("next");
    expect(badModel.build?.outDir).toBe(".next");
    expect(badModel.collections.map((c) => c.id)).toEqual(["posts"]);
  });
});
