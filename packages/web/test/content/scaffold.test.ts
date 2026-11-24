import { describe, expect, it } from "vitest";
import type { BlockType, Field } from "@galley/core/types";
import { blockScaffold, borrowedNote, needsValue, newSection } from "@/features/content/form/scaffold";

const f = (key: string, type: Field["type"], required = true, extra: Partial<Field> = {}): Field => ({ key, label: key[0]!.toUpperCase() + key.slice(1), type, required, source: "schema", ...extra });

/** A film section like the marketing site's: words, a video named by its file stem, a choice, chapters. */
const film: BlockType = {
  type: "film",
  label: "Film",
  count: 1,
  fields: [
    f("heading", "string"),
    f("text", "text"),
    f("video", "string"),
    f("captions", "string"),
    f("layout", "select", false, { options: ["side", "wide"], default: "side" }),
    f("poster", "image"),
    f("transcript", "url", false),
    f("download", "url"),
    f("link", "url"),
    f("author", "reference", true, { collection: "team" }),
    f("published", "date"),
    f("seconds", "number"),
    f("note", "string", false),
  ],
  example: { type: "film", heading: "See it", text: "One minute.", video: "galley-demo", captions: "English", poster: "/screens/demo.webp", download: "/files/demo.pdf", link: "/pricing/", author: "misha", published: "2026-01-02", seconds: 60 },
  samples: [
    { path: "src/content/pages/index.md", title: "Home", value: { type: "film", heading: "Home film", video: "home-film", captions: "English", poster: "/screens/home.webp", download: "/files/home.pdf", link: "/docs/", author: "ana", published: "2026-03-04", seconds: 30 } },
    { path: "src/content/pages/tour.md", title: "Tour", value: { type: "film", heading: "Tour film", video: "tour-film", captions: "English", poster: "/screens/tour.webp", download: "/files/tour.pdf", link: "/tour/", author: "lee", published: "2026-05-06", seconds: 45 } },
  ],
};

describe("what a new section starts with", () => {
  it("leaves words and links blank, and optional fields out", () => {
    const { value } = newSection(film, "type", { entryPath: "src/content/pages/about.md", noun: "page" });
    expect(value).toMatchObject({ type: "film", heading: "", text: "", captions: "", link: "" });
    expect(value).not.toHaveProperty("note");
    expect(value).not.toHaveProperty("transcript");
    // The schema's default fills `layout` when the page is drawn; the file doesn't gain it.
    expect(value).not.toHaveProperty("layout");
  });

  it("borrows what can't draw blank — a named video, a picture, a file, a reference, a date — from the nearest real section, and says where from", () => {
    const { value, borrowed } = newSection(film, "type", { entryPath: "src/content/pages/about.md", noun: "page" });
    expect(value).toMatchObject({ video: "home-film", poster: "/screens/home.webp", download: "/files/home.pdf", author: "ana", published: "2026-03-04" });
    // A number is a setting: it keeps the example's, as before.
    expect(value.seconds).toBe(60);
    expect(borrowed.map((item) => item.path.join("."))).toEqual(["video", "poster", "download", "author", "published"]);
    expect(borrowed.every((item) => item.from.kind === "entry" && item.from.title === "Home" && item.from.noun === "page")).toBe(true);
  });

  it("asks this page first, nearest section first, and never its own stale sample", () => {
    const siblings = [
      { type: "hero", heading: "Hi" },
      { type: "film", heading: "Far", video: "far-film", poster: "/far.webp" },
      { type: "cards" },
      { type: "film", heading: "Near", video: "near-film", poster: "/near.webp" },
    ];
    const here = newSection(film, "type", { siblings, index: 4, entryPath: "src/content/pages/index.md", noun: "page" });
    expect(here.value).toMatchObject({ video: "near-film", poster: "/near.webp" });
    expect(here.borrowed.find((item) => item.path[0] === "video")?.from).toEqual({ kind: "page" });
    // Only what this page lacks comes from elsewhere — and not from this entry's own sample (its live copy is `siblings`).
    expect(here.value.download).toBe("/files/tour.pdf");
    expect(here.borrowed.find((item) => item.path[0] === "download")?.from).toEqual({ kind: "entry", title: "Tour", noun: "page" });
  });

  it("then this collection, then the same section type anywhere on the site", () => {
    const lonely: BlockType = { ...film, samples: [] };
    const { value, borrowed } = newSection(lonely, "type", {
      entryPath: "src/content/pages/about.md",
      elsewhere: [{ noun: "post", samples: [{ path: "src/content/blog/launch.md", title: "Launch notes", value: { type: "film", video: "launch-film" } }] }],
    });
    expect(value.video).toBe("launch-film");
    expect(borrowed[0]?.from).toEqual({ kind: "entry", title: "Launch notes", noun: "post" });
  });

  it("prefers what the site declares: a default, then its own example, over anything borrowed", () => {
    const declared: BlockType = {
      ...film,
      fields: film.fields.map((field) =>
        field.key === "video" ? { ...field, examples: ["sample-film"], examplesDeclared: true } : field.key === "poster" ? { ...field, default: "/screens/placeholder.webp" } : field,
      ),
    };
    const { value, borrowed } = newSection(declared, "type", { entryPath: "x.md" });
    expect(value.video).toBe("sample-film");
    expect(value.poster).toBe("/screens/placeholder.webp");
    expect(borrowed.find((item) => item.path[0] === "video")?.from).toEqual({ kind: "declared" });
    // A default needs no news; it's the site's own starting value.
    expect(borrowed.some((item) => item.path[0] === "poster")).toBe(false);
    // Corpus examples (read from the files) are not declarations.
    const read: BlockType = { ...film, samples: [], fields: film.fields.map((field) => (field.key === "video" ? { ...field, examples: ["home-film"] } : field)) };
    expect(newSection(read, "type").value.video).toBe("");
    // A section example declared in galley.config.json counts as the site's own.
    expect(newSection({ ...film, samples: [], exampleDeclared: true }, "type").value.video).toBe("galley-demo");
  });

  it("leaves out an optional group that would hold nothing but blanks, and keeps one with a setting in it", () => {
    const split: BlockType = {
      type: "split",
      label: "Text and picture",
      count: 1,
      fields: [f("heading", "string"), f("cta", "object", false, { fields: [f("label", "string"), f("href", "url")] }), f("media", "object", false, { fields: [f("side", "select", true, { options: ["left", "right"] }), f("caption", "string", false)] })],
      example: { type: "split", heading: "H", cta: { label: "Go", href: "/go/" }, media: { side: "left", caption: "c" } },
    };
    expect(newSection(split, "type").value).toEqual({ type: "split", heading: "", media: { side: "left" } });
  });

  it("starts a list with as many items as the schema asks for, and a number at its least", () => {
    const marquee: BlockType = { type: "marquee", label: "Marquee", count: 0, fields: [f("items", "tags", true, { min: 2 }), f("speed", "number", true, { min: 1 })] };
    expect(newSection(marquee, "type").value).toEqual({ type: "marquee", items: ["", ""], speed: 1 });
    const chapters: BlockType = {
      type: "chapters",
      label: "Chapters",
      count: 1,
      fields: [f("heading", "string"), f("items", "list", true, { min: 2, max: 4, of: f("item", "object", true, { fields: [f("heading", "string"), f("image", "image")] }) })],
      example: { type: "chapters", heading: "Making", items: [{ heading: "Cut", image: "/a.jpg" }, { heading: "Sew", image: "/b.jpg" }, { heading: "Press", image: "/c.jpg" }] },
    };
    // Each item borrows its own picture: the first from the first, the second from the second.
    const { value } = newSection(chapters, "type", { siblings: [chapters.example!], index: 1 });
    expect(value).toEqual({ type: "chapters", heading: "", items: [{ heading: "", image: "/a.jpg" }, { heading: "", image: "/b.jpg" }] });
  });

  it("brings the settings beside a borrowed value from the same section, so they agree", () => {
    const split: BlockType = {
      type: "split",
      label: "Split",
      count: 2,
      fields: [f("heading", "string"), f("visual", "object", true, { fields: [f("kind", "select", false, { options: ["screen", "file"] }), f("src", "image"), f("alt", "string")] })],
      example: { type: "split", heading: "A", visual: { kind: "screen", src: "/screens/a.webp", alt: "A" } },
    };
    const { value } = newSection(split, "type", { siblings: [{ type: "split", heading: "B", visual: { kind: "file", src: "/llms.txt", alt: "B" } }], index: 1 });
    expect(value.visual).toEqual({ kind: "file", src: "/llms.txt", alt: "" });
  });

  it("stays blank when there is nothing to borrow", () => {
    const { value, borrowed } = newSection({ ...film, samples: [], example: { type: "film" } }, "type");
    expect(value).toMatchObject({ video: "", poster: "", author: "", published: "" });
    expect(borrowed).toEqual([]);
    expect(blockScaffold({ ...film, samples: [], example: { type: "film" } }, "type")).toEqual(value);
  });

  it("reaches required pictures inside lists and objects", () => {
    const tabs: BlockType = {
      type: "tabs",
      label: "Tabbed captures",
      count: 1,
      fields: [f("heading", "string"), f("tabs", "list", true, { of: f("item", "object", true, { fields: [f("label", "string"), f("visual", "object", true, { fields: [f("src", "image"), f("alt", "string")] })] }) })],
      example: { type: "tabs", heading: "Jobs", tabs: [{ label: "One", visual: { src: "/one.webp", alt: "One" } }, { label: "Two", visual: { src: "/two.webp", alt: "Two" } }] },
      samples: [{ path: "a.md", title: "Home", value: { type: "tabs", tabs: [{ label: "x", visual: { src: "", alt: "" } }, { label: "y", visual: { src: "/home-two.webp", alt: "y" } }] } }],
    };
    const { value, borrowed } = newSection(tabs, "type", { entryPath: "b.md" });
    expect(value).toEqual({ type: "tabs", heading: "", tabs: [{ label: "", visual: { src: "/home-two.webp", alt: "" } }] });
    expect(borrowed).toEqual([{ path: ["tabs", 0, "visual", "src"], label: "Src", from: { kind: "entry", title: "Home", noun: "page" } }]);
  });

  it("tells a name of a thing from words", () => {
    const video = f("video", "string");
    expect(needsValue(video, ["galley-demo", "video/tour"])).toBe(true);
    expect(needsValue(video, ["English"])).toBe(false);
    expect(needsValue(video, ["galley-demo", "A film about Galley"])).toBe(false);
    expect(needsValue(video, [])).toBe(false);
    expect(needsValue(f("href", "url"), ["/pricing/", "https://example.com/"])).toBe(false);
    expect(needsValue(f("file", "url"), ["/files/guide.pdf"])).toBe(true);
    expect(needsValue(f("poster", "image"), [])).toBe(true);
    expect(needsValue(f("poster", "image", false), [])).toBe(false);
    expect(needsValue(f("body", "markdown"), ["one", "two"])).toBe(false);
  });

  it("says once, plainly, what was borrowed and that it's theirs to change", () => {
    expect(borrowedNote("Film", [{ path: ["video"], label: "Video", from: { kind: "entry", title: "Home", noun: "page" } }])).toBe(
      "The new Film section starts with the video from the “Home” page. Change it in the form.",
    );
    expect(
      borrowedNote("Film", [
        { path: ["video"], label: "Video", from: { kind: "page" } },
        { path: ["poster"], label: "Poster", from: { kind: "page" } },
        { path: ["download"], label: "Download", from: { kind: "declared" } },
      ]),
    ).toBe("The new Film section starts with the video and the poster from another Film section on this page and the download from the site’s own example. Change them in the form.");
    expect(borrowedNote("Film", [])).toBeNull();
  });
});
