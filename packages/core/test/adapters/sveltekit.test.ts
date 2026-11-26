import { afterAll, describe, expect, it } from "vitest";

import { detectWithAdapters, sveltekitAdapter } from "../../src/adapter/index";
import { detectSite } from "../../src/content/index";
import type { SiteModel } from "../../src/types";
import { cleanup, entries, site } from "../adapter/helpers";

afterAll(cleanup);

const PKG = JSON.stringify({
  name: "harbour-sveltekit",
  scripts: { dev: "vite dev", build: "vite build" },
  devDependencies: { "@sveltejs/kit": "^2.18.0", svelte: "^5.20.0" },
});
const urls = (model: SiteModel) => Object.fromEntries(model.collections.map((collection) => [collection.id, collection.url]));

describe("sveltekitAdapter", () => {
  it("scores package + config, package only, config only, and refuses unrelated sites", async () => {
    const both = await detectWithAdapters(site({ "package.json": PKG, "svelte.config.js": "export default {};" }));
    const pkgOnly = await detectWithAdapters(site({ "package.json": PKG }));
    const configOnly = await detectWithAdapters(site({ "svelte.config.mjs": "export default {};" }));
    const foreign = await detectWithAdapters(site({ "package.json": JSON.stringify({ dependencies: { express: "^4.0.0" } }), ...entries("notes") }), {
      adapters: [sveltekitAdapter],
      builtins: false,
    });

    expect(both.adapter.id).toBe("sveltekit");
    expect(both.match).toEqual({ confidence: 0.95, version: "2.18.0" });
    expect(pkgOnly.match).toEqual({ confidence: 0.9, version: "2.18.0" });
    expect(configOnly.match).toEqual({ confidence: 0.8 });
    expect(foreign.candidates[0]?.match).toBeNull();
  });

  it("reads kit.files.assets, kit.files.routes, kit.paths.base, adapter-static pages, and vite.config server.port", async () => {
    const root = site({
      "package.json": PKG,
      "svelte.config.js": `
        import adapter from "@sveltejs/adapter-static";
        const config = {
          kit: {
            adapter: adapter({ pages: "public-out", assets: "public-out" }),
            files: {
              assets: "public-assets",
              routes: "src/pages",
            },
            paths: {
              base: "/portal",
            },
          },
        };
        export default config;
      `,
      "vite.config.ts": `
        import { sveltekit } from "@sveltejs/kit/vite";
        import { defineConfig } from "vite";
        export default defineConfig({
          plugins: [sveltekit()],
          server: { port: 5180 },
        });
      `,
      "public-assets/images/logo.png": "",
      "src/pages/+page.svelte": "<h1>Hi</h1>",
      ...entries("src/content/posts"),
      "src/lib/data/menu.json": '{ "items": [] }\n',
    });
    const model = await detectSite(root);

    expect(model.framework).toEqual({ id: "sveltekit", name: "SvelteKit", version: "2.18.0" });
    expect(model.dev).toEqual({ command: "npm run dev", port: 5180 });
    expect(model.build).toEqual({ command: "npm run build", outDir: "public-out" });
    expect(model.media.dir).toBe("public-assets/images");
    expect(model.routesDir).toBe("src/pages");
    expect(urls(model)).toEqual({
      posts: "/portal/posts/{slug}/",
      menu: null,
    });
  });

  it("supports mdsvex extensions (.svx) in content collections and +page.svx route pages", async () => {
    const root = site({
      "package.json": JSON.stringify({
        name: "harbour-mdsvex",
        scripts: { dev: "vite dev", build: "vite build" },
        devDependencies: { "@sveltejs/kit": "^2.18.0", mdsvex: "^0.12.0" },
      }),
      "svelte.config.js": `
        import { mdsvex } from "mdsvex";
        export default {
          extensions: [".svelte", ".svx", ".md"],
          preprocess: [mdsvex({ extensions: [".svx", ".md"] })],
          kit: {},
        };
      `,
      "src/posts/first.svx": "---\ntitle: First SVX\n---\nHello world.\n",
      "src/posts/second.svx": "---\ntitle: Second SVX\n---\nAnother post.\n",
      "src/routes/+page.svx": "---\ntitle: Home\n---\nWelcome.\n",
      "src/routes/about/+page.md": "---\ntitle: About\n---\nAbout us.\n",
    });
    const model = await detectSite(root);

    expect(model.collections.map((c) => [c.id, c.path, c.count, c.url])).toEqual([
      ["posts", "src/posts", 2, "/posts/{slug}/"],
      ["pages", "src/routes", 2, null],
    ]);
    expect(model.notes.some((n) => n.includes("Markdown route page"))).toBe(true);
  });

  it("survives malformed svelte.config.js and vite.config.ts cleanly", async () => {
    const root = site({
      "package.json": PKG,
      "svelte.config.js": "export default { kit: { files: { assets: '../escape' {{{ broken",
      "vite.config.ts": "not valid js {{{",
      ...entries("content/posts"),
    });
    const model = await detectSite(root);

    expect(model.framework.id).toBe("sveltekit");
    expect(model.dev?.port).toBe(5173);
    expect(model.build?.outDir).toBe("build");
    expect(model.collections.map((c) => c.id)).toEqual(["posts"]);
  });
});
