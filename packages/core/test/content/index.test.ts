import { describe, expect, it } from "vitest";

import { buildContentIndex, detectSite } from "../../src/content/index";
import { ASTRO } from "./helpers";

const model = await detectSite(ASTRO);
const index = await buildContentIndex(ASTRO, model);

describe("entryForUrl and routeExists", () => {
  it("maps URLs to entries in any common spelling", () => {
    expect(index.entryForUrl("/")?.path).toBe("src/content/pages/index.md");
    expect(index.entryForUrl("/about")?.path).toBe("src/content/pages/about.md");
    expect(index.entryForUrl("/about/index.html")?.path).toBe("src/content/pages/about.md");
    expect(index.entryForUrl("/ABOUT/?ref=x#top")?.path).toBe("src/content/pages/about.md");
    expect(index.entryForUrl("/blog/night-watch/")?.collection).toBe("blog");
    expect(index.entryForUrl("/nowhere/")).toBeNull();
  });

  it("knows entry pages, code pages and public files — and not much else", () => {
    expect(index.routeExists("/about/")).toBe(true);
    expect(index.routeExists("/contact/")).toBe(true);
    expect(index.routeExists("/blog/first-light/")).toBe(true);
    expect(index.routeExists("/images/hero.png")).toBe(true);
    // The catch-all route only renders the pages collection, so unknown slugs don't exist.
    expect(index.routeExists("/blog/never-written/")).toBe(false);
    expect(index.routeExists("/give/")).toBe(false);
  });

  it("indexes entries, data files and source templates", () => {
    expect(index.size).toBeGreaterThanOrEqual(12);
  });
});

describe("search", () => {
  it("finds text in fields and bodies, best matches first", () => {
    const hits = index.search("lantern");

    expect(hits.length).toBeGreaterThan(2);
    expect(hits.every((hit) => hit.excerpt.toLowerCase().includes("lantern"))).toBe(true);
    expect(hits[0]?.title).toBe("Harbor Lantern");
  });

  it("matches all words when the phrase is not contiguous", () => {
    const hits = index.search("flask bring");

    expect(hits.map((hit) => [hit.path, hit.location.kind])).toEqual([["src/content/blog/first-light.md", "body"]]);
  });

  it("filters by collection and limits", () => {
    expect(index.search("learn more", { collection: "pages" }).every((hit) => hit.collection === "pages")).toBe(true);
    expect(index.search("learn more", { limit: 2 })).toHaveLength(2);
    expect(index.search("a")).toEqual([]);
  });

  it("labels field hits the way the form does", () => {
    const [hit] = index.search("Teach knots");

    expect(hit?.location).toEqual({ kind: "field", field: ["sections", 1, "items", 1, "label"], label: "Sections › 2 (Feature grid) › Items › 2 › Label" });
  });
});

describe("resolve (click-to-edit) never guesses", () => {
  it("declines text that is too short or has no words", () => {
    expect(index.resolve({ urlPath: "/", text: "A" })).toMatchObject({ status: "none", reason: expect.stringMatching(/too short/) });
    expect(index.resolve({ urlPath: "/", text: " — " })).toMatchObject({ status: "none" });
  });

  it("finds text unique to the page's own entry", () => {
    const result = index.resolve({ urlPath: "/about/", text: "A small light with a long history" });

    expect(result.status).toBe("unique");
    expect(result.matches[0]).toMatchObject({ path: "src/content/pages/about.md", plain: true, editable: true, location: { kind: "field", field: ["sections", 0, "heading"] } });
  });

  it("uses whitespace-collapsed text (a folded value shown on one line)", () => {
    const result = index.resolve({ urlPath: "/", text: "Since the old lighthouse closed,  volunteers keep a lantern burning\n on the north pier every night of the year." });

    expect(result).toMatchObject({ status: "unique", matches: [{ plain: true, location: { field: ["sections", 0, "subheading"] } }] });
  });

  it("resolves repeated text on a page by occurrence when the counts line up", () => {
    const second = index.resolve({ urlPath: "/about/", text: "Learn more", occurrence: 1, total: 2 });

    expect(second).toMatchObject({ status: "unique", matches: [{ location: { field: ["sections", 2, "label"] } }] });
    const first = index.resolve({ urlPath: "/about/", text: "Learn more", occurrence: 0, total: 2 });

    expect(first.matches[0]?.location).toMatchObject({ field: ["sections", 1, "label"] });
  });

  it("is ambiguous when the counts don't line up or aren't given", () => {
    const mismatch = index.resolve({ urlPath: "/about/", text: "Learn more", occurrence: 0, total: 3 });

    expect(mismatch.status).toBe("ambiguous");
    expect(mismatch.reason).toMatch(/shows this text 3 times, but its content holds it 2 times/);
    expect(index.resolve({ urlPath: "/about/", text: "Learn more" }).status).toBe("ambiguous");
  });

  it("is ambiguous when identical text lives in several files and none is the page's", () => {
    const result = index.resolve({ urlPath: "/support-us/", text: "Learn more" });

    expect(result.status).toBe("ambiguous");
    expect(new Set(result.matches.map((match) => match.path)).size).toBeGreaterThan(2);
  });

  it("matches inline markdown against its visible form, marking it not plain", () => {
    const bold = index.resolve({ urlPath: "/blog/first-light/", text: "We lit the lantern for the first time this winter. Everyone came down to the pier." });

    expect(bold).toMatchObject({ status: "unique", matches: [{ plain: false, location: { kind: "body", block: "body.1" } }] });
    expect(bold.matches[0]?.value).toBe("We lit the lantern for the first time this winter. **Everyone** came down to the pier.");
    const link = index.resolve({ urlPath: "/blog/first-light/", text: "The tide table matters more than the weather" });

    expect(link).toMatchObject({ status: "unique", matches: [{ plain: false, value: "The [tide table](/guides/tides/) matters more than the weather" }] });
  });

  it("gives body offsets that address the text inside the body", async () => {
    const result = index.resolve({ urlPath: "/blog/first-light/", text: "What we learned" });
    const location = result.matches[0]!.location;

    expect(location.kind).toBe("body");
    if (location.kind !== "body") return;
    const { readEntry } = await import("../../src/content/index");
    const entry = await readEntry(ASTRO, model, "src/content/blog/first-light.md");

    expect(entry.body!.slice(location.start, location.end)).toBe("What we learned");
    expect(result.matches[0]?.plain).toBe(true);
  });

  it("finds text that only exists in a source template, editable only in build mode", () => {
    const content = index.resolve({ urlPath: "/contact/", text: "We answer every letter within a week." });

    expect(content).toMatchObject({ status: "unique", matches: [{ path: "src/pages/contact.astro", editable: false, location: { kind: "source", line: 6 } }] });
    expect(index.resolve({ urlPath: "/contact/", text: "We answer every letter within a week." }, { mode: "build" }).matches[0]?.editable).toBe(true);
    expect(index.resolve({ urlPath: "/contact/", text: "Write to the keepers" }).matches[0]).toMatchObject({ path: "src/pages/contact.astro", location: { kind: "source", line: 2 } });
  });

  it("decodes HTML entities and folds smart quotes", () => {
    const entity = index.resolve({ urlPath: "/", text: "Kept alight by neighbours & friends." });

    expect(entity).toMatchObject({ status: "unique", matches: [{ path: "src/components/Footer.astro", plain: false }] });
    const curly = index.resolve({ urlPath: "/pricing/", text: "Ten litres keeps the lantern’s flame going for a month." });

    expect(curly).toMatchObject({ status: "unique", matches: [{ path: "src/content/pages/pricing.md", plain: false }] });
  });

  it("falls back to ignoring capitals (CSS text-transform), never plain", () => {
    const result = index.resolve({ urlPath: "/", text: "LIGHT FOR EVERY BOAT" });

    expect(result).toMatchObject({ status: "unique", matches: [{ plain: false, location: { field: ["sections", 0, "heading"] } }] });
  });

  it("finds data-file strings shown on every page", () => {
    expect(index.resolve({ urlPath: "/about/", text: "Lit by volunteers since 1898" })).toMatchObject({ status: "unique", matches: [{ path: "src/data/navigation.yaml", collection: "navigation" }] });
  });

  it("says none for text that isn't in any file", () => {
    expect(index.resolve({ urlPath: "/", text: "Nobody ever wrote this" })).toMatchObject({ status: "none", matches: [], reason: expect.stringMatching(/isn't in any content file/) });
  });
});

describe("update", () => {
  it("re-indexes one file from text and removes deleted files", async () => {
    const local = await buildContentIndex(ASTRO, model);
    const path = "src/content/pages/visit.md";

    local.update(path, "---\ntitle: Visit us\nintro: |\n  First paragraph here.\n\n  Second paragraph here.\n---\n");
    expect(local.entryForUrl("/visit/")?.title).toBe("Visit us");
    // One paragraph of a longer field: found, but not retypable in place.
    expect(local.resolve({ urlPath: "/visit/", text: "Second paragraph here." })).toMatchObject({ status: "unique", matches: [{ plain: false, location: { field: ["intro"] } }] });
    local.update(path, null);
    expect(local.entryForUrl("/visit/")).toBeNull();
    expect(local.resolve({ urlPath: "/visit/", text: "Second paragraph here." }).status).toBe("none");
  });

  it("calls text found in too many places none rather than listing them all", async () => {
    const local = await buildContentIndex(ASTRO, model);

    for (let i = 0; i < 60; i += 1) local.update(`src/content/blog/repeat-${i}.md`, "---\ntitle: Repeat\n---\n\nRead on\n");
    expect(local.resolve({ urlPath: "/about/", text: "Read on" })).toMatchObject({ status: "none", reason: expect.stringMatching(/too many/) });
  });
});

describe("a site laid out its own way", () => {
  it("reads routes from the folder the adapter reports, not src/pages, and leaves the build output out", async () => {
    const { site, cleanup } = await import("../adapter/helpers");

    try {
      const root = site({
        "package.json": JSON.stringify({ name: "own-layout", scripts: { dev: "astro dev", build: "astro build" }, dependencies: { astro: "^7.0.0" } }),
        "astro.config.mjs": 'export default { srcDir: "./web", outDir: "./public-site" };',
        "web/content.config.ts": `import { glob } from "astro/loaders";
          import { defineCollection, z } from "astro:content";
          export const collections = { pages: defineCollection({ loader: glob({ pattern: "**/*.md", base: "./web/content/pages" }), schema: z.object({ title: z.string() }) }) };`,
        "web/content/pages/about.md": "---\ntitle: About the keepers\n---\nWe keep the light.\n",
        "web/content/pages/history.md": "---\ntitle: History\n---\nSince 1888.\n",
        "web/pages/[...slug].astro": 'const pages = await getCollection("pages");',
        "web/pages/visit.astro": "<h1>Plan your visit to the lighthouse</h1>",
        // A stray src/pages from another tool must not be read as this site's routes.
        "src/pages/stray.astro": "<h1>Not this site's page</h1>",
        "public-site/visit/index.html": "<h1>Plan your visit to the lighthouse</h1>",
      });
      const model = await detectSite(root);
      const own = await buildContentIndex(root, model);

      expect(model.routesDir).toBe("web/pages");
      expect(own.routeExists("/visit/")).toBe(true);
      expect(own.routeExists("/stray/")).toBe(false);
      expect(own.routeExists("/about/")).toBe(true);
      // The template text is found once — in the page's source, not again in the build output.
      expect(own.resolve({ urlPath: "/visit/", text: "Plan your visit to the lighthouse" }, { mode: "build" })).toMatchObject({
        status: "unique",
        matches: [{ path: "web/pages/visit.astro" }],
      });
    } finally {
      cleanup();
    }
  });

  it("treats an empty page path as no page given, and \"/\" as the home page", async () => {
    const { site, cleanup } = await import("../adapter/helpers");

    try {
      const root = site({
        "package.json": JSON.stringify({ name: "shared-words", dependencies: { astro: "^7.0.0" } }),
        "src/content.config.ts": `import { glob } from "astro/loaders";
          import { defineCollection, z } from "astro:content";
          export const collections = { pages: defineCollection({ loader: glob({ pattern: "**/*.md", base: "./src/content/pages" }), schema: z.object({ title: z.string() }) }) };`,
        "src/pages/[...slug].astro": 'const pages = await getCollection("pages");',
        "src/content/pages/index.md": "---\ntitle: Home\nheading: Welcome aboard\n---\n",
        "src/content/pages/crew.md": "---\ntitle: Crew\nheading: Welcome aboard\n---\n",
      });
      const shared = await buildContentIndex(root, await detectSite(root));

      expect(shared.resolve({ urlPath: "/", text: "Welcome aboard" })).toMatchObject({ status: "unique", matches: [{ path: "src/content/pages/index.md" }] });
      // No page given: neither page is favoured, so the person is asked.
      expect(shared.resolve({ urlPath: "", text: "Welcome aboard" })).toMatchObject({ status: "ambiguous" });
      expect(shared.resolve({ urlPath: "", text: "Welcome aboard" }).matches).toHaveLength(2);
    } finally {
      cleanup();
    }
  });
});
