import { fileURLToPath } from "node:url";

import { afterAll, describe, expect, it } from "vitest";

import { checkAdapter } from "../../../adapter-kit/src/index";
import { detectWithAdapters, eleventyAdapter } from "../../src/adapter/index";
import { detectSite } from "../../src/content/index";
import { cleanup, entries, site } from "../adapter/helpers";

afterAll(cleanup);

const EXAMPLE_FIXTURE = fileURLToPath(new URL("../../../../examples/adapter-eleventy/fixture", import.meta.url));
const EXAMPLE_CLASSIC = fileURLToPath(new URL("../../../../examples/adapter-eleventy/fixture-classic", import.meta.url));
const PKG = JSON.stringify({
  name: "bakery-site",
  scripts: { dev: "eleventy --serve", build: "eleventy" },
  devDependencies: { "@11ty/eleventy": "^3.0.0" },
});
const urls = (collections: Array<{ id: string; url: string | null }>) =>
  Object.fromEntries(collections.map((collection) => [collection.id, collection.url]));

describe("eleventyAdapter detection", () => {
  it("scores dependency + config (0.95), dependency alone (0.9), and config alone (0.8)", async () => {
    const both = await detectWithAdapters(site({ "package.json": PKG, "eleventy.config.mjs": "export default function() {};" }));
    const depOnly = await detectWithAdapters(site({ "package.json": PKG }));
    const configOnly = await detectWithAdapters(site({ ".eleventy.mjs": "export default {};" }));
    const tsConfig = await detectWithAdapters(site({ "eleventy.config.ts": "export default function() {};" }));

    expect(both.adapter.id).toBe("eleventy");
    expect(both.match).toEqual({ confidence: 0.95, version: "3.0.0" });
    expect(depOnly.adapter.id).toBe("eleventy");
    expect(depOnly.match).toEqual({ confidence: 0.9, version: "3.0.0" });
    expect(configOnly.adapter.id).toBe("eleventy");
    expect(configOnly.match).toEqual({ confidence: 0.8 });
    expect(tsConfig.adapter.id).toBe("eleventy");
    expect(tsConfig.match).toEqual({ confidence: 0.8 });
  });

  it("ignores unrelated sites and empty folders", async () => {
    const empty = await detectWithAdapters(site({}));
    const plain = await detectWithAdapters(site(entries("notes")));

    expect(empty.adapter.id).toBe("generic");
    expect(plain.adapter.id).toBe("generic");
  });
});

describe("eleventyAdapter config reading", () => {
  it("reads Eleventy 3 fluent directory calls, object addPassthroughCopy, pathPrefix, and .11tydata.{json,js}", async () => {
    const root = site({
      "package.json": PKG,
      "eleventy.config.js": `
        export default function (eleventyConfig) {
          // eleventyConfig.setInputDirectory("ignored-comment");
          eleventyConfig.setInputDirectory("src");
          eleventyConfig.setOutputDirectory("dist");
          eleventyConfig.setDataDirectory("_global");
          eleventyConfig.setIncludesDirectory("_partials");
          eleventyConfig.setLayoutsDirectory("_layouts");
          eleventyConfig.addPassthroughCopy({ "src/img": "assets/img", "static/media": "media" });
        }
        export const config = {
          pathPrefix: "/bakery/",
        };
      `,
      "src/img/loaf.jpg": "",
      "static/media/oven.jpg": "",
      "src/_partials/header.md": "---\ntitle: Ignored partial\n---\n",
      "src/_partials/footer.md": "---\ntitle: Ignored partial 2\n---\n",
      "src/_layouts/base.md": "---\ntitle: Ignored layout\n---\n",
      "src/_layouts/post.md": "---\ntitle: Ignored layout 2\n---\n",
      "dist/built/a.md": "---\ntitle: Ignored output\n---\n",
      "dist/built/b.md": "---\ntitle: Ignored output 2\n---\n",
      "src/_global/hours.json": '{ "weekdays": "7am - 5pm" }\n',
      "src/_global/menu.yaml": "featured: sourdough\n",
      "src/index.md": "---\ntitle: Home\n---\nWelcome.\n",
      "src/about.md": "---\ntitle: About\n---\nStory.\n",
      "src/posts/posts.11tydata.json": JSON.stringify({
        tags: ["journal"],
        permalink: "/journal/{{ page.fileSlug }}/index.html",
      }),
      ...entries("src/posts"),
      "src/recipes/recipes.11tydata.js": `
        export default {
          tags: "recipes",
          permalink: false,
        };
      `,
      ...entries("src/recipes"),
      "src/archive/archive.11tydata.json": JSON.stringify({
        tags: "archive",
        permalink: "/{{ page.date | date: '%Y' }}/{{ page.fileSlug }}/",
      }),
      ...entries("src/archive"),
      ...entries("src/notes"),
    });

    const model = await detectSite(root);

    expect(model.framework).toEqual({ id: "eleventy", name: "Eleventy", version: "3.0.0" });
    expect(model.build).toEqual({ command: "npm run build", outDir: "dist" });
    expect(model.media).toEqual({
      dir: "src/img",
      publicPath: "/assets/img",
      roots: [
        { dir: "src/img", publicPath: "/assets/img" },
        { dir: "static/media", publicPath: "/media" },
      ],
    });
    expect(model.collections.map((collection) => collection.id).sort()).toEqual([
      "archive",
      "hours",
      "journal",
      "menu",
      "notes",
      "pages",
      "recipes",
    ]);
    expect(urls(model.collections)).toEqual({
      journal: "/bakery/journal/{slug}/",
      recipes: null,
      archive: null,
      pages: "/bakery/{slug}/",
      notes: "/bakery/notes/{slug}/",
      hours: null,
      menu: null,
    });
    expect(model.notes.some((note) => note.includes("built from more than the file name"))).toBe(true);

    const report = await checkAdapter(eleventyAdapter, root, {
      collections: [
        { id: "journal", minEntries: 2, url: "/bakery/journal/{slug}/" },
        { id: "recipes", minEntries: 2, url: null },
        { id: "archive", minEntries: 2, url: null },
        { id: "notes", minEntries: 2, url: "/bakery/notes/{slug}/" },
        { id: "pages", minEntries: 2, url: "/bakery/{slug}/" },
        { id: "hours", url: null },
        { id: "menu", url: null },
      ],
    });

    expect(report.checks.filter((check) => check.status === "fail")).toEqual([]);
    expect(report.ok).toBe(true);
  });

  it("reads export const config = { dir }, module.exports = { dir }, and dynamic .11tydata.js permalinks", async () => {
    const root = site({
      "package.json": JSON.stringify({ devDependencies: { "@11ty/eleventy": "3.1.2" } }),
      "eleventy.config.mjs": `
        export default function (eleventyConfig) {
          eleventyConfig.addPassthroughCopy("content/images");
        }
        export const config = {
          dir: { input: "content", output: "_out", data: "_data", includes: "_inc", layouts: "_lay" },
        };
      `,
      "content/images/hero.png": "",
      "content/dynamic/dynamic.11tydata.js": `
        module.exports = {
          tags: "updates",
          permalink: (data) => \`/u/\${data.page.date}/\${data.page.fileSlug}/\`,
        };
      `,
      ...entries("content/dynamic"),
      "content/_data/site.toml": 'title = "Harbour"\n',
    });

    const model = await detectSite(root);

    expect(model.build).toEqual({ command: "npx @11ty/eleventy", outDir: "_out" });
    expect(model.dev).toEqual({ command: "npx @11ty/eleventy --serve", port: 8080 });
    expect(model.media.dir).toBe("content/images");
    expect(model.media.publicPath).toBe("/images");
    expect(urls(model.collections)).toEqual({ updates: null, site: null });
    expect(model.notes.some((note) => note.includes("computed by code"))).toBe(true);

    const cjsRoot = site({
      ".eleventy.cjs": `module.exports = { dir: { input: "site", output: "public_html" } };`,
      ...entries("site/blog"),
    });
    const cjsModel = await detectSite(cjsRoot);

    expect(cjsModel.build?.outDir).toBe("public_html");
    expect(urls(cjsModel.collections)).toEqual({ blog: "/blog/{slug}/" });
  });

  it("passes checkAdapter on both example Eleventy fixtures", async () => {
    const modern = await checkAdapter(eleventyAdapter, EXAMPLE_FIXTURE, {
      collections: [
        { id: "posts", minEntries: 2, url: "/journal/{slug}/", fields: ["title", "date", "author"] },
        { id: "recipes", minEntries: 2, url: null, fields: ["serves"] },
        { id: "pages", minEntries: 2, url: "/{slug}/" },
        { id: "hours", url: null, fields: ["weekdays"] },
        { id: "staff", url: null },
      ],
      dev: { command: "npm start", port: 8080 },
    });
    const classic = await checkAdapter(eleventyAdapter, EXAMPLE_CLASSIC, {
      collections: [
        { id: "notes", minEntries: 2, url: "/notes/{slug}/" },
        { id: "pages", minEntries: 2, url: "/{slug}/" },
        { id: "site", url: null },
      ],
    });

    expect(modern.checks.filter((check) => check.status === "fail")).toEqual([]);
    expect(classic.checks.filter((check) => check.status === "fail")).toEqual([]);
  });
});
