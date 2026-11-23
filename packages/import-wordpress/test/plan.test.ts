import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { loadSiteModel } from "@galley/core/content";
import type { Collection, Field, SiteModel } from "@galley/core/types";
import { planImport } from "../src/plan";
import { readWxr } from "../src/source/wxr";
import type { WordPressSite } from "../src/types";
import { FIXTURES, STARTER, WP_AUTHORS } from "./helpers";

/** The starter credits posts to its authors collection; these are the WordPress writers once they are in it. */
const people = { entries: { authors: WP_AUTHORS }, mediaPaths: [] };

let wp: WordPressSite;
let starter: SiteModel;

beforeAll(async () => {
  wp = await readWxr(join(FIXTURES, "quillfield.wxr"));
  starter = await loadSiteModel(STARTER);
});

function f(key: string, type: Field["type"], required = false, extra: Partial<Field> = {}): Field {
  return { key, label: key[0]!.toUpperCase() + key.slice(1), type, required, source: "schema", ...extra };
}

function c(id: string, fields: Field[], extra: Partial<Collection> = {}): Collection {
  return { id, label: id[0]!.toUpperCase() + id.slice(1), singular: id.replace(/s$/, ""), kind: "entries", path: `content/${id}`, pattern: "**/*.md", format: "markdown", body: true, url: `/${id}/{slug}/`, fields, create: true, count: 0, source: "schema", ...extra };
}

function model(collections: Collection[]): SiteModel {
  return {
    name: "Synthetic",
    framework: { id: "astro", name: "Astro" },
    packageManager: "npm",
    installed: true,
    dev: null,
    build: null,
    collections,
    media: { dir: "public/media", publicPath: "/media", roots: [{ dir: "public/media", publicPath: "/media" }] },
    urls: {},
    publish: { branch: "main", mode: "commit", remote: null, push: false },
    ai: { instructions: [], allowBuild: true },
    writable: { content: [], build: ["**/*"] },
    notes: [],
  };
}

describe("planning against the real starter", () => {
  it("chooses the journal for posts and pages for pages, and maps fields it has", () => {
    const plan = planImport(wp, starter, { context: { entries: {}, mediaPaths: [] } });

    expect(plan.questions).toEqual([]);
    expect(plan.posts?.collection).toBe("blog");
    expect(plan.pages?.collection).toBe("pages");
    expect(plan.pages?.content).toEqual({ kind: "body" });
    expect(Object.fromEntries(plan.posts!.fields.map((m) => [m.field, m.from]))).toMatchObject({
      title: "the title",
      date: "the publication date",
      author: "the author",
      tags: "the tags",
      image: "the featured image",
      imageAlt: "the featured image's alt text",
      draft: "whether it was published",
    });
    // No SEO title field on the starter: kept out, and said so.
    expect(plan.posts!.unmapped).toContain("SEO titles (the page title is used instead)");
  });

  it("fills only real fields, with meaning: SEO description, merged categories and tags, local date", () => {
    const plan = planImport(wp, starter, { context: people });
    const kiln = plan.items.find((item) => item.sourceId === 101)!;

    expect(kiln.data).toEqual({
      title: "Opening the new kiln room",
      description: "Our new kiln room is open: what changed, and how firing works from April.",
      date: "2024-03-05",
      author: "ana-whitcombe",
      tags: ["News", "kiln", "studio"],
      image: "https://old.example.org/wp-content/uploads/2024/03/kiln-room.png",
      imageAlt: "The kiln room with its new kiln",
      draft: false,
    });
    expect(kiln.path).toBe("src/content/blog/opening-the-new-kiln-room.md");
    expect(kiln.newUrl).toBe("/blog/opening-the-new-kiln-room/");
    // "Uncategorized" never becomes a tag.
    expect(plan.items.find((item) => item.sourceId === 103)!.data.tags).toEqual(["News", "studio"]);
  });

  it("keeps drafts as drafts, and skips what would publish something private", () => {
    const plan = planImport(wp, starter, { context: people });
    const draft = plan.items.find((item) => item.sourceId === 104)!;

    expect(draft.data.draft).toBe(true);
    expect(draft.slug).toBe("notes-for-the-summer-open-studio");
    const reasons = Object.fromEntries(plan.skipped.map((s) => [s.sourceId, s.reason]));

    expect(reasons[307]).toMatch(/isn't published on WordPress \(it's private\), and Pages has no draft setting/);
    expect(reasons[106]).toMatch(/password-protected/);
    expect(reasons[105]).toMatch(/needs an image, and this one has none/);
  });

  it("fills a required field from --default instead of holding the post back", () => {
    const plan = planImport(wp, starter, { defaults: { blog: { image: "/images/share.png" } }, context: people });
    const holiday = plan.items.find((item) => item.sourceId === 105)!;

    expect(holiday.data.image).toBe("/images/share.png");
    expect(plan.skipped.find((s) => s.sourceId === 105)).toBeUndefined();
  });

  it("asks who to credit when the writers aren't on the site yet, with the first person as the likely answer", () => {
    const team = { entries: { authors: [{ slug: "nell-okafor", title: "Nell Okafor" }, { slug: "tomas-reyes", title: "Tomas Reyes" }] }, mediaPaths: [] };
    const open = planImport(wp, starter, { context: team });
    const asked = open.questions.find((q) => q.id === "default:blog.author")!;

    expect(asked.question).toMatch(/WordPress names Ana Whitcombe and Sam Okoro as authors/);
    expect(asked.options.map((o) => o.value)).toEqual(["nell-okafor", "tomas-reyes"]);
    expect(asked.default).toBe("nell-okafor");
    // Planned with the likely answer meanwhile, so the counts are already right.
    expect(open.items.find((item) => item.sourceId === 101)!.data.author).toBe("nell-okafor");
    const answered = planImport(wp, starter, { context: team, defaults: { blog: { author: "tomas-reyes" } } });

    expect(answered.questions.some((q) => q.id === "default:blog.author")).toBe(false);
    expect(answered.items.find((item) => item.sourceId === 101)!.data.author).toBe("tomas-reyes");
  });

  it("preserves slugs and page hierarchy, rewrites links between imported items, and plans redirects", () => {
    const plan = planImport(wp, starter, { context: people });
    const kilnRoom = plan.items.find((item) => item.sourceId === 303)!;

    expect(kilnRoom.slug).toBe("visiting/kiln-room");
    expect(kilnRoom.newUrl).toBe("/visiting/kiln-room/");
    const kiln = plan.items.find((item) => item.sourceId === 101)!;

    expect(kiln.body).toContain("[glaze notes](/blog/glaze-notes/)");
    expect(kiln.externalLinks).toEqual(["https://old.example.org/shop/"]);
    expect(plan.redirects).toContainEqual({ from: "/2024/03/glaze-notes/", to: "/blog/glaze-notes/", title: "Glaze notes: three recipes we keep coming back to" });
    // Pages keep their addresses: no redirect needed.
    expect(plan.redirects.some((r) => r.from === "/opening-hours/")).toBe(false);
  });

  it("prepares rebuild briefs for page-builder pages against the starter's section types", () => {
    const plan = planImport(wp, starter);
    const classes = plan.rebuilds.find((r) => r.title === "Classes")!;

    expect(classes.builder).toBe("elementor");
    expect(classes.suggestions.map((s) => s.blockType)).toEqual(["hero", "features", "testimonial", "faq", "pricing", "logos", "contact"]);
    expect(classes.brief).toMatch(/Rebuild the page “Classes” \(\/classes\/\)/);
    expect(plan.rebuilds.find((r) => r.title === "Commissions")?.builder).toBe("divi");
    expect(plan.offeredTypes).toEqual([{ slug: "course", name: "course", count: 1 }]);
  });

  it("reports what has no equivalent on a static site", () => {
    const plan = planImport(wp, starter);

    expect(plan.features.map((feature) => feature.feature).sort()).toEqual(["comments", "forms"]);
    expect(plan.notImported.map((entry) => entry.what)).toEqual(expect.arrayContaining(["Comments", "User accounts and passwords", "The theme, menus and widgets"]));
  });
});

describe("planning against a site with different field names", () => {
  const people = c("people", [f("name", "string", true)], { url: null });
  const articles = c("articles", [
    f("headline", "string", true),
    f("summary", "text"),
    f("publishedAt", "datetime", true),
    f("updatedAt", "datetime"),
    f("byline", "reference", false, { collection: "people" }),
    f("keywords", "tags"),
    f("category", "select", false, { options: ["News", "Guides"] }),
    f("heroImage", "object", false, { fields: [f("src", "image", true), f("alt", "string")] }),
    f("status", "select", true, { options: ["draft", "published"] }),
    f("seo", "object", false, { fields: [f("title", "string"), f("description", "string")] }),
  ]);
  const sitePages = c(
    "sitePages",
    [
      f("title", "string", true),
      f("blocks", "blocks", false, {
        discriminator: "kind",
        blocks: [
          { type: "markdownSection", label: "Text", fields: [f("kind", "string", true), f("content", "markdown", true)], count: 1 },
          { type: "banner", label: "Banner", fields: [f("kind", "string", true), f("title", "string", true), f("button", "object", false, { fields: [f("text", "string"), f("url", "url")] })], count: 1 },
        ],
      }),
    ],
    { body: false, url: "/{slug}/", path: "content/site-pages" }
  );

  it("maps by meaning, not by name", () => {
    const plan = planImport(wp, model([people, articles, sitePages]), { context: { entries: { people: [{ slug: "sam-okoro", title: "Sam Okoro" }] } } });

    expect(plan.questions).toEqual([]);
    expect(plan.posts?.collection).toBe("articles");
    const glaze = plan.items.find((item) => item.sourceId === 102)!;

    expect(glaze.data).toEqual({
      headline: "Glaze notes: three recipes we keep coming back to",
      seo: { description: "Celadon, tenmoku and a reliable clear: the three glazes we use most, with firing notes." },
      summary: "Three glazes do most of the work in this studio.",
      publishedAt: "2024-03-20T09:30:00Z",
      updatedAt: "2024-04-02T12:00:00Z",
      byline: "sam-okoro",
      keywords: ["glaze"],
      heroImage: { src: "https://old.example.org/wp-content/uploads/2024/03/glaze-tiles.png", alt: "Test tiles in three glazes" },
      status: "published",
    });
    // Category isn't one of the select's choices: left out, and said so.
    expect(glaze.notes.join(" ")).toMatch(/Beginners\) aren't among the choices for Category/);
    expect(plan.items.find((item) => item.sourceId === 101)!.data.category).toBe("News");
    // An author who isn't in the people collection is left empty rather than invented.
    expect(plan.items.find((item) => item.sourceId === 101)!.data.byline).toBeUndefined();
    expect(plan.items.find((item) => item.sourceId === 104)!.data.status).toBe("draft");
  });

  it("puts page text into a prose section when pages are built from sections", () => {
    const plan = planImport(wp, model([people, articles, sitePages]));

    expect(plan.pages?.collection).toBe("sitePages");
    expect(plan.pages?.content).toEqual({ kind: "section", field: "blocks", blockType: "markdownSection", textField: "content", discriminator: "kind" });
    const hours = plan.items.find((item) => item.sourceId === 301)!;

    expect(hours.body).toBe("");
    expect(hours.data.blocks).toEqual([{ kind: "markdownSection", content: expect.stringContaining("We're open Tuesday to Saturday.") }]);
    // With only a banner and a text section, most of the Classes page has no close match.
    const classes = plan.rebuilds.find((r) => r.title === "Classes")!;

    // The banner fits the opening section but has nowhere for its paragraph: a lower confidence, and it says why.
    expect(classes.suggestions[0]).toMatchObject({ blockType: "banner", confidence: "medium", content: { title: "Make something with your hands", button: { text: "Book a class", url: "/opening-hours/" } } });
    expect(classes.suggestions[0]!.reason).toMatch(/no place for its text/);
    expect(classes.suggestions.find((s) => s.section === 3)).toMatchObject({ blockType: null, confidence: "none" });
    expect(classes.suggestions.find((s) => s.section === 3)!.reason).toMatch(/No close match/);
  });

  it("asks when two collections could take posts, and when none can", () => {
    const news = c("news", [f("title", "string", true), f("date", "date", true)]);
    const ambiguous = planImport(wp, model([articles, news, sitePages]));

    expect(ambiguous.questions.map((q) => q.id)).toEqual(["posts-collection"]);
    expect(ambiguous.questions[0]!.options.map((o) => o.value)).toEqual(["articles", "news"]);
    // The likely answer is offered first: the first one named like a blog.
    expect(ambiguous.questions[0]!.default).toBe("articles");
    expect(ambiguous.items.every((item) => item.kind === "page")).toBe(true);
    const answered = planImport(wp, model([articles, news, sitePages]), { postsCollection: "news" });

    expect(answered.questions).toEqual([]);
    expect(answered.posts?.collection).toBe("news");
    const none = planImport(wp, model([sitePages]));

    expect(none.questions[0]!.question).toMatch(/No collection on this site looks like a blog/);
  });
});
