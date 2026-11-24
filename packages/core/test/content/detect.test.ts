import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, describe, expect, it } from "vitest";

import { analyzeAstroConfig, detectSite } from "../../src/content/index";
import { ASTRO, HUGO, PLAIN } from "./helpers";

describe("detectSite on an Astro site", async () => {
  const model = await detectSite(ASTRO);
  const byId = (id: string) => model.collections.find((collection) => collection.id === id)!;

  it("reads framework, package manager, commands, media and the deployed URL", () => {
    expect(model.framework).toEqual({ id: "astro", name: "Astro", version: "5.2.0" });
    expect(model.packageManager).toBe("pnpm");
    expect(model.dev).toEqual({ command: "pnpm run dev", port: 4400 });
    expect(model.build).toEqual({ command: "pnpm run build", outDir: "dist" });
    expect(model.media.dir).toBe("public/images");
    expect(model.media.publicPath).toBe("/images");
    expect(model.urls.production).toBe("https://harbor-lantern.example");
    expect(model.installed).toBe(false);
    expect(model.notes).toContain("Read 4 collections from src/content.config.ts.");
  });

  it("finds every collection from the content config plus src/data files", () => {
    expect(model.collections.map((collection) => [collection.id, collection.kind, collection.path, collection.count])).toEqual([
      ["blog", "entries", "src/content/blog", 3],
      ["pages", "entries", "src/content/pages", 3],
      ["guides", "entries", "src/content/pages/guides", 2],
      ["authors", "data", "src/data/authors.json", 1],
      ["navigation", "data", "src/data/navigation.yaml", 1],
    ]);
  });

  it("recovers zod types and lets the corpus refine them", () => {
    const blog = byId("blog");
    const field = (key: string) => blog.fields.find((candidate) => candidate.key === key)!;

    expect(field("title")).toMatchObject({ type: "string", required: true, source: "schema" });
    expect(field("pubDate")).toMatchObject({ type: "date", required: true });
    expect(field("cover")).toMatchObject({ type: "image", required: false });
    expect(field("author")).toMatchObject({ type: "reference", collection: "authors" });
    expect(field("tags")).toMatchObject({ type: "tags", default: [] });
    expect(field("tags").options).toEqual(expect.arrayContaining(["news", "harbour", "weather"]));
    expect(field("status")).toMatchObject({ type: "select", options: ["draft", "review", "live"], default: "draft", required: false });
    expect(field("seo").fields?.map((inner) => [inner.key, inner.type, inner.required])).toEqual([
      ["metaTitle", "string", false],
      ["noindex", "boolean", false],
    ]);
    expect(blog).toMatchObject({ titleField: "title", dateField: "pubDate", imageField: "cover", draftField: "draft", url: "/blog/{slug}/" });
  });

  it("turns a passthrough list of typed objects into a blocks field with examples", () => {
    const sections = byId("pages").fields.find((field) => field.key === "sections")!;

    expect(sections).toMatchObject({ type: "blocks", discriminator: "type", source: "schema" });
    expect(sections.blocks?.map((block) => [block.type, block.label, block.count])).toEqual([
      ["cta", "CTA", 4],
      ["feature-grid", "Feature grid", 2],
      ["hero", "Hero", 2],
    ]);
    const hero = sections.blocks!.find((block) => block.type === "hero")!;

    expect(hero.fields.map((field) => [field.key, field.type])).toEqual([
      ["heading", "string"],
      ["subheading", "string"],
      ["image", "image"],
    ]);
    // The most complete real instance is kept as the scaffold for "add section".
    expect(hero.example).toMatchObject({ type: "hero", heading: "Light for every boat" });
    // And each entry's own, with the entry it is on: what a new section may borrow where a blank wouldn't draw.
    expect(hero.samples?.length).toBe(2);
    expect(hero.samples?.[0]).toMatchObject({ path: expect.stringMatching(/\.md$/), title: expect.any(String), value: { type: "hero" } });
    expect(new Set(hero.samples?.map((sample) => sample.path)).size).toBe(2);
    const grid = sections.blocks!.find((block) => block.type === "feature-grid")!;

    expect(grid.fields.find((field) => field.key === "items")?.of?.fields?.map((field) => field.key)).toEqual(["label", "text"]);
  });

  it("maps routes and shares a folder between collections", () => {
    expect(byId("pages").url).toBe("/{slug}/");
    expect(byId("guides").url).toBe("/guides/{slug}/");
    expect(byId("guides").fields.find((field) => field.key === "level")?.options).toEqual(["intro", "advanced"]);
  });

  it("offers data files as data collections with fields", () => {
    expect(byId("authors").fields[0]).toMatchObject({ key: "items", type: "list" });
    expect(byId("authors").fields[0]?.of?.fields?.map((field) => field.key)).toEqual(["id", "name", "role"]);
    expect(byId("navigation").fields.map((field) => [field.key, field.type])).toEqual([
      ["links", "list"],
      ["footerNote", "string"],
    ]);
  });

  it("limits content-mode writes to content and media", () => {
    expect(model.writable.content).toEqual(expect.arrayContaining(["src/content/blog/**", "src/data/authors.json", "public/images/**"]));
    expect(model.writable.content.some((glob) => glob.startsWith("src/pages"))).toBe(false);
  });
});

describe("detectSite on other kinds of folder", () => {
  it("reads a Hugo site with no package.json", async () => {
    const model = await detectSite(HUGO);

    expect(model.framework.id).toBe("hugo");
    expect(model.packageManager).toBeNull();
    expect(model.dev).toEqual({ command: "hugo server", port: 1313 });
    expect(model.urls.production).toBe("https://field-notes.example");
    expect(model.collections.map((collection) => [collection.id, collection.path, collection.url, collection.count])).toEqual([
      ["pages", "content", "/{slug}/", 2],
      ["posts", "content/posts", "/posts/{slug}/", 3],
      ["menu", "data/menu.yaml", null, 1],
    ]);
    expect(model.collections[0]!.fields.find((field) => field.key === "date")?.type).toBe("date");
  });

  it("reads a plain folder of markdown with no framework and no package.json", async () => {
    const model = await detectSite(PLAIN);

    expect(model.framework.id).toBe("generic");
    expect(model.dev).toBeNull();
    expect(model.collections.map((collection) => [collection.id, collection.path, collection.url, collection.count])).toEqual([
      ["notes", "notes", null, 4],
      ["recipes", "recipes", null, 3],
    ]);
    expect(model.collections[1]!.fields.find((field) => field.key === "serves")?.type).toBe("number");
  });

  const scratch = mkdtempSync(join(tmpdir(), "content-detect-"));

  afterAll(() => rmSync(scratch, { recursive: true, force: true }));

  it("falls back to folders when the content config can't be read", async () => {
    const root = join(scratch, "odd-astro");

    mkdirSync(join(root, "src/content/notes"), { recursive: true });
    writeFileSync(join(root, "package.json"), JSON.stringify({ dependencies: { astro: "5.0.0" } }));
    writeFileSync(join(root, "src/content.config.ts"), "export const collections = buildCollections(import.meta.glob('./x/*'));\n");
    for (const name of ["a", "b"]) writeFileSync(join(root, `src/content/notes/${name}.md`), `---\ntitle: ${name}\n---\n`);
    const model = await detectSite(root);

    expect(model.collections.map((collection) => collection.id)).toEqual(["notes"]);
    expect(model.notes.some((note) => /builds `collections` with code/.test(note))).toBe(true);
  });

  it("saves new images in the public folder's own images folder when it has another name", async () => {
    const root = join(scratch, "imagery");

    mkdirSync(join(root, "public/imagery/team"), { recursive: true });
    mkdirSync(join(root, "public/fonts"), { recursive: true });
    mkdirSync(join(root, "public/icons"), { recursive: true });
    writeFileSync(join(root, "package.json"), JSON.stringify({ dependencies: { next: "16.0.0" } }));
    for (const name of ["hero.webp", "team/sam.jpg", "team/alex.jpg"]) writeFileSync(join(root, `public/imagery/${name}`), "");
    writeFileSync(join(root, "public/icons/logo.svg"), "<svg/>");
    writeFileSync(join(root, "public/fonts/body.woff2"), "");
    const model = await detectSite(root);

    expect(model.media.dir).toBe("public/imagery");
    expect(model.media.publicPath).toBe("/imagery");
    expect(model.media.roots).toEqual([
      { dir: "public/imagery", publicPath: "/imagery" },
      { dir: "public", publicPath: "/" },
    ]);
  });

  it("keeps <public>/images for new images when no folder in the public folder holds any", async () => {
    const root = join(scratch, "no-images");

    mkdirSync(join(root, "public/fonts"), { recursive: true });
    writeFileSync(join(root, "package.json"), JSON.stringify({ dependencies: { next: "16.0.0" } }));
    writeFileSync(join(root, "public/fonts/body.woff2"), "");
    const model = await detectSite(root);

    expect(model.media.dir).toBe("public/images");
    expect(model.media.publicPath).toBe("/images");
  });

  it("never throws on an empty folder", async () => {
    const root = join(scratch, "empty");

    mkdirSync(root);
    const model = await detectSite(root);

    expect(model.collections).toEqual([]);
    expect(model.notes.at(-1)).toMatch(/No content collections/);
  });
});

describe("analyzeAstroConfig (static, never executed)", () => {
  it("reads legacy collections, file loaders, consts, renamed exports and arrays of patterns", () => {
    const source = `
      import { defineCollection, z, reference } from "astro:content";
      import { glob, file } from "astro/loaders";
      // a comment with defineCollection( inside it
      const base = z.object({ title: z.string(), order: z.number().int().optional() });
      const docs = defineCollection({ type: "content", schema: base.extend({ draft: z.boolean().default(false) }) });
      const people = defineCollection({ loader: file("src/data/people.yaml") });
      const posts = defineCollection({
        loader: glob({ pattern: ["**/*.md", "!drafts/**"], base: new URL("./content/posts", import.meta.url) }),
        schema: ({ image }) => {
          return z.object({ hero: image(), related: z.array(reference("posts")).optional(), when: z.date() });
        },
      });
      const remote = defineCollection({ loader: fetchFromSomewhere({ url: \`https://\${host}/feed\` }) });
      const regex = /[a-z]+\\/(\\d+)/g;
      export const collections = { docs, people, articles: posts, remote };
    `;
    const analysis = analyzeAstroConfig(source);

    expect(analysis.collections.map((collection) => [collection.name, collection.loader.kind])).toEqual([
      ["docs", "legacy"],
      ["people", "file"],
      ["articles", "glob"],
      ["remote", "unknown"],
    ]);
    expect(analysis.collections[0]!.fields?.map((field) => [field.key, field.type, field.required, field.default])).toEqual([
      ["title", "string", true, undefined],
      ["order", "number", false, undefined],
      ["draft", "boolean", false, false],
    ]);
    expect(analysis.collections[2]!.loader).toEqual({ kind: "glob", base: "./content/posts", pattern: ["**/*.md", "!drafts/**"] });
    expect(analysis.collections[2]!.fields?.map((field) => [field.key, field.type, field.collection ?? null])).toEqual([
      ["hero", "image", null],
      ["related", "list", null],
      ["when", "date", null],
    ]);
    expect(analysis.collections[2]!.fields?.[1]?.of).toMatchObject({ type: "reference", collection: "posts" });
    expect(analysis.notes.some((note) => note.includes("custom loader"))).toBe(true);
  });

  it("reads a discriminated union of blocks, enums, unions of literals and helper wrappers", () => {
    const source = `
      import { defineCollection, z } from "astro:content";
      const hero = z.object({ type: z.literal("hero"), heading: z.string(), image: z.string().url().optional() });
      const quote = z.object({ type: z.literal("quote"), text: z.string(), by: z.string().describe("Who said it") });
      const tone = z.union([z.literal("warm"), z.literal("cool")]);
      const wrap = <T extends z.ZodTypeAny>(schema: T) => z.preprocess((v) => v, schema);
      const pages = defineCollection({
        loader: glob({ pattern: "*.md", base: "src/pages-content" }),
        schema: wrap(z.object({
          tone,
          when: z.string().datetime().nullish(),
          blocks: z.array(z.discriminatedUnion("type", [hero, quote])),
          meta: z.record(z.string(), z.string()).optional(),
        }).strict()),
      });
      export { pages as collections_pages };
      export const collections = { pages } satisfies Record<string, unknown>;
    `;
    const [pages] = analyzeAstroConfig(source).collections;
    const field = (key: string) => pages!.fields!.find((candidate) => candidate.key === key)!;

    expect(field("tone")).toMatchObject({ type: "select", options: ["warm", "cool"] });
    expect(field("when")).toMatchObject({ type: "datetime", required: false });
    expect(field("meta")).toMatchObject({ type: "json", required: false });
    expect(field("blocks")).toMatchObject({ type: "blocks", discriminator: "type" });
    expect(field("blocks").blocks?.map((block) => [block.type, block.label, block.fields.map((inner) => `${inner.key}:${inner.type}`)])).toEqual([
      ["hero", "Hero", ["heading:string", "image:url"]],
      ["quote", "Quote", ["text:string", "by:string"]],
    ]);
    expect(field("blocks").blocks?.[1]?.fields[1]?.description).toBe("Who said it");
  });

  it("reads zod 4's .meta(): a description, and examples the site declares", () => {
    const source = `
      import { defineCollection } from "astro:content";
      import { z } from "astro/zod";
      const film = z.object({ type: z.literal("film"), video: z.string().meta({ description: "File stem in public/video", examples: ["galley-demo"] }), title: z.string() });
      const pages = defineCollection({ schema: z.object({ sections: z.array(z.discriminatedUnion("type", [film])) }) });
      export const collections = { pages };
    `;
    const [pages] = analyzeAstroConfig(source).collections;
    const video = pages!.fields!.find((candidate) => candidate.key === "sections")!.blocks![0]!.fields.find((candidate) => candidate.key === "video")!;

    expect(video).toMatchObject({ type: "string", required: true, description: "File stem in public/video", examples: ["galley-demo"], examplesDeclared: true });
  });

  it("returns no collections (and a note) for configs it cannot read", () => {
    expect(analyzeAstroConfig("this is not javascript {{{ ").collections).toEqual([]);
    expect(analyzeAstroConfig("export default {}").notes[0]).toMatch(/does not export `collections`/);
  });
});
