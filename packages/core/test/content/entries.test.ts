import { authorOf } from "../../src/content/entries/entries";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, describe, expect, it } from "vitest";

import { buildEntry, collectionForPath, detectSite, entryUrl, hashContent, listEntries, normalizeSlug, pathForSlug, readEntry, slugForPath } from "../../src/content/index";
import { GalleyError } from "../../src/errors";
import type { ChangeStatus } from "../../src/types";
import { ASTRO } from "./helpers";

const model = await detectSite(ASTRO);
const collection = (id: string) => model.collections.find((candidate) => candidate.id === id)!;

describe("paths, slugs and URLs", () => {
  it("gives a shared folder's files to the most specific collection", () => {
    expect(collectionForPath(model, "src/content/pages/about.md")?.id).toBe("pages");
    expect(collectionForPath(model, "src/content/pages/guides/tides.md")?.id).toBe("guides");
    expect(collectionForPath(model, "./src/content/blog/storm-notes.mdx")?.id).toBe("blog");
    expect(collectionForPath(model, "src/data/authors.json")?.id).toBe("authors");
    expect(collectionForPath(model, "src/pages/contact.astro")).toBeNull();
    expect(collectionForPath(model, "src/content/blog/notes.txt")).toBeNull();
  });

  it("maps slugs to paths and back", () => {
    const pages = collection("pages");

    expect(slugForPath(pages, "src/content/pages/index.md")).toBe("index");
    expect(slugForPath(pages, "src/content/pages/team/index.md")).toBe("team");
    expect(slugForPath(collection("blog"), "src/content/blog/2026/launch.mdx")).toBe("2026/launch");
    expect(pathForSlug(pages, "join-us")).toBe("src/content/pages/join-us.md");
    expect(pathForSlug(collection("blog"), "2026/launch")).toBe("src/content/blog/2026/launch.md");
    expect(pathForSlug(collection("authors"), "anything")).toBe("src/data/authors.json");
  });

  it("builds URLs from the collection's pattern; the pages index is the home page", () => {
    expect(entryUrl(model, collection("pages"), "index")).toBe("/");
    expect(entryUrl(model, collection("pages"), "about")).toBe("/about/");
    expect(entryUrl(model, collection("blog"), "first-light")).toBe("/blog/first-light/");
    expect(entryUrl(model, collection("authors"), "x")).toBeNull();
  });

  it("normalises slugs to lowercase hyphenated words and keeps nesting", () => {
    expect(normalizeSlug("  Café Menu & Prices! ")).toBe("cafe-menu-and-prices");
    expect(normalizeSlug("Guides/Getting Started")).toBe("guides/getting-started");
    expect(normalizeSlug("What’s new")).toBe("whats-new");
    expect(() => normalizeSlug("!!!")).toThrow(GalleyError);
  });

  it("hashes content to 16 hex characters", () => {
    expect(hashContent("abc")).toMatch(/^[0-9a-f]{16}$/);
    expect(hashContent("abc")).toBe(hashContent(new TextEncoder().encode("abc")));
  });
});

describe("listEntries", () => {
  it("lists a collection newest first by default", async () => {
    const list = await listEntries(ASTRO, model, "blog");

    expect(list.total).toBe(3);
    expect(list.items.map((item) => [item.slug, item.date, item.draft ?? null])).toEqual([
      ["storm-notes", "2026-03-20", true],
      ["night-watch", "2026-02-03T19:30:00Z", null],
      ["first-light", "2026-01-12", null],
    ]);
    expect(list.items[2]).toMatchObject({ title: "First light over the harbour", titleSource: "field", image: "/images/hero.png", url: "/blog/first-light/", status: "clean" });
  });

  it("names each entry's author, showing a referenced author by name", async () => {
    const list = await listEntries(ASTRO, model, "blog");
    const bySlug = Object.fromEntries(list.items.map((item) => [item.slug, item.author ?? null]));

    // `author: reference("authors")` into a file() collection of { id, name } records.
    expect(bySlug["first-light"]).toBe("Ana Brook");
    expect(bySlug["night-watch"]).toBe("Ben Marsh");
    // Pages have no author-like field.
    expect((await listEntries(ASTRO, model, "pages")).items.every((item) => item.author === undefined)).toBe(true);
  });

  it("reads author, authors or byline — a string, the first of a list, or a name on an object", () => {
    const collection = model.collections.find((c) => c.id === "pages")!;

    expect(authorOf(collection, { author: "Nell Okafor" })).toBe("Nell Okafor");
    expect(authorOf(collection, { authors: ["Ana", "Ben"] })).toBe("Ana");
    expect(authorOf(collection, { Byline: "The keepers" })).toBe("The keepers");
    expect(authorOf(collection, { author: { name: "Ana Brook", url: "/team/ana/" } })).toBe("Ana Brook");
    expect(authorOf(collection, { authors: [{ name: "Ben Marsh" }] })).toBe("Ben Marsh");
    expect(authorOf(collection, { author: "" })).toBeUndefined();
    expect(authorOf(collection, { title: "No author here" })).toBeUndefined();
    // Not a reference field: the stored text is shown as it is, never looked up.
    expect(authorOf(collection, { author: "ana" }, () => "Ana Brook")).toBe("ana");
  });

  it("searches, filters by status, sorts and pages", async () => {
    const statusOf = (path: string): ChangeStatus => (path.endsWith("night-watch.md") ? "modified" : "clean");

    expect((await listEntries(ASTRO, model, "blog", { search: "ROTA" })).items.map((item) => item.slug)).toEqual(["night-watch"]);
    expect((await listEntries(ASTRO, model, "blog", { status: "modified" }, statusOf)).items.map((item) => item.slug)).toEqual(["night-watch"]);
    const byTitle = await listEntries(ASTRO, model, "blog", { sort: "title", order: "asc", offset: 1, limit: 1 });

    expect(byTitle).toMatchObject({ total: 3, items: [{ slug: "storm-notes" }] });
  });

  it("excludes files a more specific collection owns", async () => {
    expect((await listEntries(ASTRO, model, "pages")).items.map((item) => item.slug).sort()).toEqual(["about", "index", "pricing"]);
  });

  it("throws not-found for an unknown collection", async () => {
    await expect(listEntries(ASTRO, model, "nope")).rejects.toMatchObject({ code: "not-found" });
  });
});

describe("readEntry and buildEntry", () => {
  it("reads an entry with its data, body, hash and fields", async () => {
    const entry = await readEntry(ASTRO, model, "src/content/blog/first-light.md");

    expect(entry).toMatchObject({ collection: "blog", slug: "first-light", format: "markdown", url: "/blog/first-light/" });
    expect(entry.data.tags).toEqual(["news", "harbour"]);
    expect(entry.body?.startsWith("\n# First light")).toBe(true);
    expect(entry.hash).toBe(hashContent(entry.raw));
    expect(entry.fields.map((field) => field.key)).toContain("seo");
  });

  it("reads data files and presents a top-level list as items", async () => {
    const authors = await readEntry(ASTRO, model, "src/data/authors.json");

    expect(authors).toMatchObject({ title: "Authors", titleSource: "filename", body: null, url: null });
    expect(authors.data.items).toHaveLength(2);
  });

  it("falls back to the first heading, then the filename, for a title", () => {
    const pages = { ...model, collections: model.collections.map((c) => (c.id === "pages" ? { ...c, titleField: "headline" } : c)) };

    expect(buildEntry(pages, "src/content/pages/x.md", "---\n---\n\n## Hello there\n", { mtimeMs: 1 })).toMatchObject({ title: "Hello there", titleSource: "heading" });
    expect(buildEntry(pages, "src/content/pages/join-us.md", "---\n---\nText\n", { mtimeMs: 1 })).toMatchObject({ title: "Join us", titleSource: "filename" });
  });

  it("adds fields for keys the schema doesn't know, and warns about them", () => {
    const entry = buildEntry(model, "src/content/blog/x.md", "---\ntitle: X\npubDate: 2026-01-01\nauthor: ana\nmood: sunny\n---\n", { mtimeMs: 1 }, "added");

    expect(entry.status).toBe("added");
    expect(entry.fields.find((field) => field.key === "mood")).toMatchObject({ type: "string", source: "inferred", required: false });
    expect(entry.issues).toEqual([expect.objectContaining({ severity: "warning", code: "unknown-field", field: ["mood"] })]);
  });

  it("reports parse errors as issues rather than throwing", () => {
    expect(buildEntry(model, "src/content/blog/x.md", "---\ntitle: [\n---\n", { mtimeMs: 1 }).issues[0]).toMatchObject({ severity: "error", code: "parse" });
  });

  it("throws plain-words errors for missing files and files outside collections", async () => {
    await expect(readEntry(ASTRO, model, "src/content/blog/gone.md")).rejects.toMatchObject({ code: "not-found", message: expect.stringMatching(/no longer exists/) });
    expect(() => buildEntry(model, "README.md", "", { mtimeMs: 0 })).toThrow(/isn't part of any collection/);
  });
});

describe("listing performance", () => {
  const root = mkdtempSync(join(tmpdir(), "content-perf-"));

  afterAll(() => rmSync(root, { recursive: true, force: true }));

  it("lists 1,000 entries quickly once warm (parses are cached by mtime and size)", async () => {
    mkdirSync(join(root, "posts"), { recursive: true });
    for (let i = 0; i < 1000; i += 1) {
      writeFileSync(join(root, "posts", `post-${String(i).padStart(4, "0")}.md`), `---\ntitle: Post ${i}\ndate: 2026-01-${String((i % 28) + 1).padStart(2, "0")}\ntags: [a, b]\nsections:\n  - type: hero\n    heading: Hello ${i}\n---\n\nBody ${i}.\n`);
    }
    const site = await detectSite(root);

    expect(site.collections[0]).toMatchObject({ id: "posts", count: 1000 });
    await listEntries(root, site, "posts");
    const started = performance.now();
    const list = await listEntries(root, site, "posts", { limit: 50 });
    const elapsed = performance.now() - started;

    expect(list.total).toBe(1000);
    expect(elapsed).toBeLessThan(500);
  });
});
