import { afterAll, describe, expect, it } from "vitest";

import { detectWithAdapters, docusaurusAdapter } from "../../src/adapter/index";
import { detectSite, listEntries } from "../../src/content/index";
import type { SiteModel } from "../../src/types";
import { cleanup, entries, site } from "../adapter/helpers";

afterAll(cleanup);

const PKG = JSON.stringify({
  name: "harbour-docs",
  scripts: { start: "docusaurus start", build: "docusaurus build" },
  dependencies: { "@docusaurus/core": "^3.7.0", "@docusaurus/preset-classic": "^3.7.0" },
});
const urls = (model: SiteModel) => Object.fromEntries(model.collections.map((collection) => [collection.id, collection.url]));

describe("docusaurusAdapter", () => {
  it("scores package + config, package only, config only, and refuses unrelated sites", async () => {
    const both = await detectWithAdapters(site({ "package.json": PKG, "docusaurus.config.ts": "export default {};" }));
    const pkgOnly = await detectWithAdapters(site({ "package.json": PKG }));
    const configOnly = await detectWithAdapters(site({ "docusaurus.config.mjs": "export default {};" }));
    const foreign = await detectWithAdapters(site({ "package.json": JSON.stringify({ dependencies: { express: "^4.0.0" } }), ...entries("notes") }), {
      adapters: [docusaurusAdapter],
      builtins: false,
    });

    expect(both.adapter.id).toBe("docusaurus");
    expect(both.match).toEqual({ confidence: 0.95, version: "3.7.0" });
    expect(pkgOnly.match).toEqual({ confidence: 0.9, version: "3.7.0" });
    expect(configOnly.match).toEqual({ confidence: 0.8 });
    expect(foreign.candidates[0]?.match).toBeNull();
  });

  it("reads url, baseUrl, trailingSlash, staticDirectories, and classic preset paths", async () => {
    const root = site({
      "package.json": PKG,
      "docusaurus.config.ts": `
        import type { Config } from "@docusaurus/types";
        const config: Config = {
          title: "Harbour Docs",
          url: "https://docs.harbour-lantern.org",
          baseUrl: "/handbook/",
          trailingSlash: false,
          staticDirectories: ["assets-static", "static"],
          presets: [
            [
              "classic",
              {
                docs: { path: "guides", routeBasePath: "guides" },
                blog: { path: "news", routeBasePath: "changelog" },
                pages: { path: "src/pages" },
              },
            ],
          ],
        };
        export default config;
      `,
      ...entries("guides"),
      ...entries("news"),
      "src/pages/about.mdx": "---\ntitle: About\n---\nAbout us.\n",
      "data/links.json": '{ "items": [] }\n',
      "assets-static/img/logo.png": "",
      "static/favicon.ico": "",
    });
    const model = await detectSite(root);

    expect(model.framework).toEqual({ id: "docusaurus", name: "Docusaurus", version: "3.7.0" });
    expect(model.dev).toEqual({ command: "npm start", port: 3000 });
    expect(model.build).toEqual({ command: "npm run build", outDir: "build" });
    expect(model.urls).toEqual({ production: "https://docs.harbour-lantern.org/handbook" });
    expect(model.media.dir).toBe("assets-static/img");
    expect(model.media.roots).toEqual([
      { dir: "assets-static/img", publicPath: "/img" },
      { dir: "assets-static", publicPath: "/" },
      { dir: "static", publicPath: "/" },
    ]);
    expect(urls(model)).toEqual({
      docs: "/handbook/guides/{slug}",
      blog: "/handbook/changelog/{slug}",
      pages: "/handbook/{slug}",
      links: null,
    });
    expect(model.collections.find((c) => c.id === "pages")?.format).toBe("mdx");
  });

  it("supports docs-only mode (routeBasePath: '/') with blog disabled", async () => {
    const root = site({
      "package.json": PKG,
      "docusaurus.config.js": `
        module.exports = {
          url: "https://wiki.harbour-lantern.org",
          baseUrl: "/",
          presets: [
            [
              "@docusaurus/preset-classic",
              {
                docs: { routeBasePath: "/" },
                blog: false,
              },
            ],
          ],
        };
      `,
      "docs/intro.md": "---\ntitle: Welcome\n---\nHello.\n",
      "docs/getting-started/install.md": "---\ntitle: Install\n---\nSteps.\n",
      ...entries("blog"),
    });
    const model = await detectSite(root);
    const docs = await listEntries(root, model, "docs");

    expect(model.collections.map((c) => c.id)).toEqual(["docs"]);
    expect(urls(model)).toEqual({ docs: "/{slug}/" });
    expect(docs.items.map((item) => item.url)).toEqual(["/getting-started/install/", "/intro/"]);
  });

  it("reads standalone content plugins and multi-instance docs plugins", async () => {
    const root = site({
      "package.json": PKG,
      "docusaurus.config.mjs": `
        export default {
          url: "https://api.harbour-lantern.org",
          presets: [["classic", { docs: { routeBasePath: "docs" }, blog: false }]],
          plugins: [
            [
              "@docusaurus/plugin-content-docs",
              { id: "community", path: "community", routeBasePath: "community" },
            ],
          ],
        };
      `,
      ...entries("docs"),
      ...entries("community"),
    });
    const model = await detectSite(root);

    expect(urls(model)).toEqual({
      docs: "/docs/{slug}/",
      community: "/community/{slug}/",
    });
  });

  it("ignores placeholder example.com URLs and survives malformed configs without throwing", async () => {
    const placeholder = await detectSite(
      site({
        "package.json": PKG,
        "docusaurus.config.js": 'module.exports = { url: "https://your-docusaurus-site.example.com" };',
        ...entries("docs"),
      })
    );
    const malformed = await detectSite(
      site({
        "package.json": PKG,
        "docusaurus.config.js": "module.exports = {{{ broken syntax !!! path: '../escape' ",
        ...entries("docs"),
      })
    );

    expect(placeholder.urls).toEqual({});
    expect(placeholder.notes.some((n) => n.includes("is a placeholder"))).toBe(true);
    expect(malformed.framework.id).toBe("docusaurus");
    expect(malformed.collections.map((c) => c.id)).toEqual(["docs"]);
  });
});
