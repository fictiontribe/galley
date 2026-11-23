import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterAll, describe, expect, it } from "vitest";

import { astroAdapter, detectWithAdapters } from "../../src/adapter/index";
import { detectSite, listEntries, mergeConfig } from "../../src/content/index";
import type { GalleyConfig, SiteModel } from "../../src/types";
import { cleanup, entries, site } from "./helpers";

afterAll(cleanup);

const STARTER = fileURLToPath(new URL("../../../../starters/astro-starter", import.meta.url));
const PKG = JSON.stringify({ name: "astro-test-site", scripts: { dev: "astro dev", build: "astro build" }, dependencies: { astro: "^5.4.0" } });
const byId = (model: SiteModel, id: string) => model.collections.find((collection) => collection.id === id)!;
const urls = (model: SiteModel) => Object.fromEntries(model.collections.map((collection) => [collection.id, collection.url]));

describe("astro.config.*", () => {
  it("reads srcDir, publicDir, outDir, base, site, trailingSlash and server.port", async () => {
    const root = site({
      "package.json": PKG,
      "astro.config.ts": `import { defineConfig } from "astro/config";
        export default defineConfig({
          srcDir: "./app",
          publicDir: "./static",
          outDir: "./build/site",
          base: "/docs/",
          site: "https://docs.lighthouse-keepers.org",
          trailingSlash: "never",
          server: { port: 4500, host: true },
        });`,
      "app/content.config.ts": `import { glob } from "astro/loaders";
        import { defineCollection, z } from "astro:content";
        export const collections = { guides: defineCollection({ loader: glob({ pattern: "**/*.md", base: "./app/content/guides" }), schema: z.object({ title: z.string() }) }) };`,
      "app/pages/guides/[...slug].astro": 'const guides = await getCollection("guides");',
      "static/images/logo.png": "",
      ...entries("app/content/guides"),
      ...entries("app/data-not-scanned"),
      "app/data/menu.json": '{ "items": [] }',
    });
    const model = await detectSite(root);

    expect(model.framework).toMatchObject({ id: "astro", version: "5.4.0" });
    // The pages live under the configured srcDir, and Astro is told its port with --port.
    expect(model.dev).toEqual({ command: "npm run dev", port: 4500, portArgs: ["--port", "{port}"] });
    expect(model.routesDir).toBe("app/pages");
    expect(model.build).toEqual({ command: "npm run build", outDir: "build/site" });
    expect(model.media).toEqual({ dir: "static/images", publicPath: "/images", roots: [{ dir: "static/images", publicPath: "/images" }, { dir: "static", publicPath: "/" }] });
    expect(model.urls).toEqual({ production: "https://docs.lighthouse-keepers.org" });
    expect(urls(model)).toEqual({ guides: "/docs/guides/{slug}", menu: null });
    expect(model.notes).toContain("Read 1 collection from app/content.config.ts.");
  });

  it("offers --port only to a plain `astro dev` that doesn't name a port, and never to a custom command", async () => {
    const pkg = (dev: string) => JSON.stringify({ name: "astro-test-site", scripts: { dev }, dependencies: { astro: "^5.4.0" } });
    const wrapped = await detectSite(site({ "package.json": pkg("concurrently 'astro dev' 'tailwind -w'"), "astro.config.mjs": "export default {};" }));
    const named = await detectSite(site({ "package.json": pkg("astro dev --port 4400"), "astro.config.mjs": "export default {};" }));
    const plainRoot = site({ "package.json": pkg("astro dev --host"), "astro.config.mjs": "export default {};" });
    const plain = await detectSite(plainRoot);

    expect(wrapped.dev).toEqual({ command: "npm run dev", port: 4321 });
    expect(named.dev).toEqual({ command: "npm run dev", port: 4400 });
    expect(plain.dev).toEqual({ command: "npm run dev", port: 4321, portArgs: ["--port", "{port}"] });
    expect(mergeConfig(plain, { dev: { command: "npm run start:local" } }).dev).toEqual({ command: "npm run start:local", port: 4321 });
    expect(mergeConfig(plain, { dev: { port: 4500 } }).dev).toEqual({ command: "npm run dev", port: 4500, portArgs: ["--port", "{port}"] });
  });

  it("follows an imported JSON value and an environment fallback, and ignores a placeholder address", async () => {
    const imported = await detectSite(site({ "package.json": PKG, "astro.config.mjs": 'import site from "./src/data/site.json";\nexport default { site: site.url };', "src/data/site.json": '{ "url": "https://harbour-lights.org" }' }));
    const env = await detectSite(site({ "package.json": PKG, "astro.config.mjs": 'const site = process.env.SITE_URL || "https://harbour-lights.org";\nexport default defineConfig({ site, server: { port: Number(process.env.PORT) || 4600 } });' }));
    const placeholder = await detectSite(site({ "package.json": PKG, "astro.config.mjs": 'export default defineConfig({ site: "https://www.example.com" });' }));

    expect(imported.urls.production).toBe("https://harbour-lights.org");
    expect(env.urls.production).toBe("https://harbour-lights.org");
    expect(env.dev?.port).toBe(4600);
    expect(env.notes).toContain("astro.config.mjs takes the site address from SITE_URL when that is set; its fallback, https://harbour-lights.org, was used.");
    expect(env.notes).toContain("astro.config.mjs takes the dev server port from PORT when that is set; its fallback, 4600, was used.");
    expect(placeholder.urls).toEqual({});
    expect(placeholder.notes.some((note) => note.includes("is a placeholder, so no live site was set"))).toBe(true);
  });

  it("build.format \"file\" means addresses without a trailing slash", async () => {
    const model = await detectSite(site({
      "package.json": PKG,
      "astro.config.mjs": 'export default { build: { format: "file" } };',
      "src/content.config.ts": 'export const collections = { blog: defineCollection({ loader: glob({ pattern: "*.md", base: "src/content/blog" }) }) };',
      ...entries("src/content/blog"),
    }));

    expect(byId(model, "blog").url).toBe("/blog/{slug}");
  });
});

describe("the content config", () => {
  const config = (file: string, source: string, extra: Record<string, string> = {}) => site({ "package.json": PKG, [file]: source, ...extra });

  it("is found at content.config.mts and at the legacy content/config.ts", async () => {
    const modern = await detectSite(config("src/content.config.mts", 'export const collections = { notes: defineCollection({ loader: glob({ pattern: "**/*.md", base: "./src/content/notes" }) }) };', entries("src/content/notes")));
    const legacy = await detectSite(config("src/content/config.ts", `
      const notes = defineCollection({ type: "content", schema: z.object({ title: z.string() }) });
      const people = defineCollection({ type: "data", schema: z.object({ name: z.string() }) });
      export const collections = { notes, people };`, { ...entries("src/content/notes"), "src/content/people/ana.yaml": "name: Ana\n", "src/content/people/ben.yaml": "name: Ben\n" }));

    expect(modern.collections.map((collection) => [collection.id, collection.count])).toEqual([["notes", 2]]);
    expect(legacy.collections.map((collection) => [collection.id, collection.path, collection.format, collection.count, collection.url])).toEqual([
      ["notes", "src/content/notes", "markdown", 2, "/notes/{slug}/"],
      ["people", "src/content/people", "yaml", 2, null],
    ]);
  });

  it("reads a glob base given as a string, a new URL(…, import.meta.url), or left out", async () => {
    const root = config("src/content.config.ts", `
      export const collections = {
        plain: defineCollection({ loader: glob({ pattern: "*.md", base: "src/content/plain" }) }),
        url: defineCollection({ loader: glob({ pattern: "*.md", base: new URL("./content/url", import.meta.url) }) }),
        rooted: defineCollection({ loader: glob({ pattern: "docs/**/*.md" }) }),
      };`, { ...entries("src/content/plain"), ...entries("src/content/url"), ...entries("docs") });
    const model = await detectSite(root);

    expect(model.collections.map((collection) => [collection.id, collection.path, collection.pattern, collection.count])).toEqual([
      ["plain", "src/content/plain", "*.md", 2],
      ["url", "src/content/url", "*.md", 2],
      ["rooted", ".", "docs/**/*.md", 2],
    ]);
  });

  it("reads schemas inline, hoisted, behind ({ image }) =>, in function helpers, and imported from another file", async () => {
    const root = config("src/content.config.ts", `
      import { defineCollection, z } from "astro:content";
      import { glob } from "astro/loaders";
      import { seo } from "./schemas/seo";
      const hoisted = z.object({ title: z.string(), seo });
      function withDates(shape) { return z.object({ ...shape, published: z.coerce.date() }); }
      export const collections = {
        inline: defineCollection({ loader: glob({ pattern: "*.md", base: "src/content/inline" }), schema: z.object({ title: z.string(), rank: z.number().optional() }) }),
        hoisted: defineCollection({ loader: glob({ pattern: "*.md", base: "src/content/hoisted" }), schema: hoisted }),
        images: defineCollection({ loader: glob({ pattern: "*.md", base: "src/content/images" }), schema: ({ image }) => z.object({ cover: image() }) }),
        helper: defineCollection({ loader: glob({ pattern: "*.md", base: "src/content/helper" }), schema: withDates({ title: z.string() }) }),
      };`, {
      "src/schemas/seo.ts": 'import { z } from "astro:content";\nconst robots = z.enum(["index", "noindex"]);\nexport const seo = z.object({ metaTitle: z.string().optional(), robots: robots.default("index") });\n',
      ...entries("src/content/inline"), ...entries("src/content/hoisted"), ...entries("src/content/images"), ...entries("src/content/helper"),
    });
    const model = await detectSite(root);
    const keys = (id: string) => byId(model, id).fields.map((field) => `${field.key}:${field.type}:${field.source}`);

    expect(keys("inline")).toEqual(["title:string:schema", "rank:number:schema"]);
    expect(keys("hoisted")).toEqual(["title:string:schema", "seo:object:schema"]);
    expect(byId(model, "hoisted").fields[1]?.fields?.map((field) => [field.key, field.type, field.options ?? null, field.default ?? null])).toEqual([
      ["metaTitle", "string", null, null],
      ["robots", "select", ["index", "noindex"], "index"],
    ]);
    expect(keys("images")).toEqual(["cover:image:schema", "title:string:inferred"]);
    expect(keys("helper")).toEqual(["title:string:schema", "published:date:schema"]);
  });

  it("reads a z.union that wraps a z.discriminatedUnion as one set of block types", async () => {
    const root = config("src/content.config.ts", `
      const hero = z.object({ type: z.literal("hero"), heading: z.string(), tone: z.enum(["light", "dark"]).default("light") });
      const quote = z.object({ type: z.literal("quote"), text: z.string() });
      const known = z.discriminatedUnion("type", [hero, quote]);
      const unknown = z.looseObject({ type: z.string() }).superRefine(() => {});
      export const collections = { pages: defineCollection({ loader: glob({ pattern: "*.md", base: "src/content/pages" }), schema: z.object({ sections: z.array(z.union([known, unknown])).default([]) }) }) };`, {
      "src/content/pages/a.md": "---\nsections:\n  - type: hero\n    heading: Hi\n  - type: quote\n    text: So.\n---\n",
      "src/content/pages/b.md": "---\nsections:\n  - type: hero\n    heading: Again\n    tone: dark\n---\n",
    });
    const sections = byId(await detectSite(root), "pages").fields.find((field) => field.key === "sections")!;

    expect(sections).toMatchObject({ type: "blocks", discriminator: "type", source: "schema", required: false });
    expect(sections.blocks?.map((block) => [block.type, block.count, block.fields.map((field) => `${field.key}:${field.type}`)])).toEqual([
      ["hero", 2, ["heading:string", "tone:select"]],
      ["quote", 1, ["text:string"]],
    ]);
    expect(sections.blocks?.[0]?.fields[1]).toMatchObject({ options: ["light", "dark"], default: "light", required: false });
  });

  it("a file() loader over records keyed by id lets the files speak, a list keeps the item schema", async () => {
    const root = config("src/content.config.ts", `
      export const collections = {
        keyed: defineCollection({ loader: file("src/data/keyed.json"), schema: z.object({ name: z.string() }) }),
        listed: defineCollection({ loader: file("src/data/listed.json"), schema: z.object({ name: z.string() }) }),
      };`, { "src/data/keyed.json": '{ "ana": { "name": "Ana" }, "ben": { "name": "Ben" } }', "src/data/listed.json": '[{ "id": "ana", "name": "Ana" }]' });
    const model = await detectSite(root);

    expect(byId(model, "keyed").fields.map((field) => `${field.key}:${field.type}`)).toEqual(["ana:object", "ben:object"]);
    expect(byId(model, "listed").fields.map((field) => `${field.key}:${field.type}`)).toEqual(["items:list"]);
  });

  it("notes a generateId it cannot follow", async () => {
    const model = await detectSite(config("src/content.config.ts", 'export const collections = { blog: defineCollection({ loader: glob({ pattern: "*.md", base: "src/content/blog", generateId: ({ entry }) => entry.toUpperCase() }) }) };', entries("src/content/blog")));

    expect(model.notes).toContain("src/content.config.ts: The “blog” collection names its entries with its own code (generateId), so their page addresses may differ from their file names.");
  });
});

describe("URL patterns from src/pages", () => {
  const configFor = (ids: string[]) =>
    `export const collections = { ${ids.map((id) => `"${id}": defineCollection({ loader: glob({ pattern: "**/*.md", base: "src/content/${id}" }) })`).join(", ")} };`;

  it("rest params, a collection at the site root, getEntry with a param, and endpoints or listings that do not count", async () => {
    const root = site({
      "package.json": PKG,
      "src/content.config.ts": configFor(["pages", "posts", "docs", "authors"]),
      "src/pages/[...slug].astro": 'const pages = await getCollection("pages"); const posts = await getCollection("posts");',
      "src/pages/journal/[slug].astro": 'const post = await getEntry("posts", Astro.params.slug); const author = await getEntry("authors", post.data.author);',
      "src/pages/journal/[...page].astro": 'export async function getStaticPaths({ paginate }) { return paginate(await getCollection("posts")); }',
      "src/pages/journal/[slug].json.ts": 'export const GET = async () => getCollection("posts");',
      "src/pages/handbook/[...path].astro": 'const docs = await getCollection("docs");',
      ...entries("src/content/pages"), ...entries("src/content/posts"), ...entries("src/content/docs"), ...entries("src/content/authors"),
    });
    const model = await detectSite(root);

    expect(urls(model)).toEqual({ pages: "/{slug}/", posts: "/journal/{slug}/", docs: "/handbook/{slug}/", authors: null });
    expect(model.notes).toContain("No page in src/pages shows an entry of “Authors”, so it has no pages of its own.");
  });

  it("a route in a folder named after a collection is that collection's, whatever else it looks up", async () => {
    const root = site({
      "package.json": PKG,
      "src/content.config.ts": configFor(["blog", "team"]),
      // Posts come from a helper; the only literal read is the author lookup.
      "src/pages/blog/[slug].astro": 'import { posts } from "../../lib/posts"; const member = (await getCollection("team")).find(() => true);',
      ...entries("src/content/blog"), ...entries("src/content/team"),
    });

    expect(urls(await detectSite(root))).toEqual({ blog: "/blog/{slug}/", team: null });
  });

  it("keeps nested (i18n-style) folders in the slug, and a sub-folder collection follows its parent's route", async () => {
    const root = site({
      "package.json": PKG,
      "src/content.config.ts": `export const collections = {
        blog: defineCollection({ loader: glob({ pattern: "**/*.md", base: "src/content/blog" }) }),
        pages: defineCollection({ loader: glob({ pattern: "**/*.md", base: "src/content/pages" }) }),
        guides: defineCollection({ loader: glob({ pattern: "**/*.md", base: "src/content/pages/guides" }) }),
      };`,
      "src/pages/blog/[...slug].astro": 'getCollection("blog")',
      "src/pages/[...slug].astro": 'getCollection("pages")',
      "src/content/blog/en/harbour.md": "---\ntitle: Harbour\n---\n",
      "src/content/blog/fr/port.md": "---\ntitle: Port\n---\n",
      ...entries("src/content/pages"), ...entries("src/content/pages/guides"),
    });
    const model = await detectSite(root);
    const blog = await listEntries(root, model, "blog");

    expect(urls(model)).toEqual({ blog: "/blog/{slug}/", pages: "/{slug}/", guides: "/guides/{slug}/" });
    expect(blog.items.map((entry) => [entry.slug, entry.url])).toEqual([
      ["en/harbour", "/blog/en/harbour/"],
      ["fr/port", "/blog/fr/port/"],
    ]);
  });

  it("guesses /<id>/{slug}/ only when the routes cannot say", async () => {
    const root = site({
      "package.json": PKG,
      "src/content.config.ts": configFor(["notes"]),
      "src/pages/[...slug].astro": 'import { allPages } from "../lib/pages"; const pages = await allPages();',
      ...entries("src/content/notes"),
    });

    expect(urls(await detectSite(root))).toEqual({ notes: "/notes/{slug}/" });
  });
});

describe("the bundled starter", () => {
  it("reads every section type from the schema, and the team has no pages", async () => {
    const run = await detectWithAdapters(STARTER, { builtins: false, adapters: [astroAdapter] });
    const model = run.model;
    const sections = byId(model, "pages").fields.find((field) => field.key === "sections")!;
    const hero = sections.blocks?.find((block) => block.type === "hero");

    expect(run.adapter).toBe(astroAdapter);
    // Every section type the starter's schema declares (z.literal("…") on its `type`), in its order — read from the
    // schema itself, so a starter that gains a section type doesn't need this list kept by hand.
    const declared = [...readFileSync(join(STARTER, "src/content.config.ts"), "utf8").matchAll(/type:\s*z\.literal\("([^"]+)"\)/g)].map((match) => match[1]);

    expect(declared.length).toBeGreaterThan(10);
    expect(sections.blocks?.map((block) => block.type)).toEqual(declared);
    expect(hero?.fields.find((field) => field.key === "tone")).toMatchObject({ type: "select", options: ["default", "muted", "inverse", "accent"], default: "default", source: "schema" });
    expect(hero?.example).toMatchObject({ type: "hero" });
    expect(sections.blocks?.find((block) => block.type === "team")?.fields.find((field) => field.key === "members")).toMatchObject({ type: "list", of: { type: "reference", collection: "team" } });
    // Pages and posts have routes; the routes read alone also guess an address for every other entry collection, and
    // the starter's galley.config.json says which have none (team, authors) — read together, only the real routes remain.
    const config = JSON.parse(readFileSync(join(STARTER, "galley.config.json"), "utf8")) as GalleyConfig;
    const routed = Object.entries(urls(mergeConfig(model, config))).filter(([, url]) => url !== null);

    expect(Object.fromEntries(routed)).toEqual({ pages: "/{slug}/", blog: "/blog/{slug}/" });
    expect(urls(mergeConfig(model, config))).toMatchObject({ team: null, authors: null, navigation: null, site: null });
  });
});

describe("Starlight", () => {
  it("reads docsLoader() and i18nLoader(), and serves the docs from the site root", async () => {
    const root = site({
      "package.json": JSON.stringify({ scripts: { dev: "astro dev" }, dependencies: { astro: "^5.6.0", "@astrojs/starlight": "^0.34.0" } }),
      "astro.config.mjs": 'import starlight from "@astrojs/starlight";\nexport default defineConfig({ site: "https://handbook.lighthouse-keepers.org", integrations: [starlight({ title: "Handbook" })] });',
      "src/content.config.ts": `import { defineCollection } from "astro:content";
        import { docsLoader, i18nLoader } from "@astrojs/starlight/loaders";
        import { docsSchema, i18nSchema } from "@astrojs/starlight/schema";
        export const collections = {
          docs: defineCollection({ loader: docsLoader(), schema: docsSchema() }),
          i18n: defineCollection({ loader: i18nLoader(), schema: i18nSchema() }),
        };`,
      "src/content/docs/index.mdx": "---\ntitle: Welcome\n---\n",
      "src/content/docs/guides/lamps.md": "---\ntitle: Trimming the lamps\ndescription: Weekly.\n---\n",
      "src/content/i18n/fr.json": '{ "search.label": "Chercher" }',
    });
    const model = await detectSite(root);
    const docs = await listEntries(root, model, "docs");

    expect(model.collections.map((collection) => [collection.id, collection.path, collection.count, collection.url])).toEqual([
      ["docs", "src/content/docs", 2, "/{slug}/"],
      ["i18n", "src/content/i18n", 1, null],
    ]);
    expect(docs.items.map((entry) => entry.url)).toEqual(["/guides/lamps/", "/"]);
    expect(model.notes.some((note) => note.includes("custom loader"))).toBe(false);
  });

  it("a fileURLToPath(new URL(…)) base reads like the URL itself", async () => {
    const model = await detectSite(site({
      "package.json": PKG,
      "src/content.config.ts": 'import { fileURLToPath } from "node:url";\nexport const collections = { notes: defineCollection({ loader: glob({ pattern: "*.md", base: fileURLToPath(new URL("./content/notes", import.meta.url)) }) }) };',
      ...entries("src/content/notes"),
    }));

    expect(byId(model, "notes")).toMatchObject({ path: "src/content/notes", count: 2 });
  });
});
