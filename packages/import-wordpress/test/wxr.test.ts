import { createWriteStream, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ImportError } from "../src/errors";
import { readWxr } from "../src/source/wxr";
import { FIXTURES, tempDir } from "./helpers";

const FILE = join(FIXTURES, "quillfield.wxr");

describe("reading an export file", () => {
  it("reads the site, posts, pages and the content types it doesn't import", async () => {
    const wp = await readWxr(FILE);

    expect(wp.source).toEqual({ kind: "file", input: FILE, authenticated: false });
    expect(wp.siteUrl).toBe("https://old.example.org");
    expect(wp.title).toBe("Quillfield Pottery");
    expect(wp.items.filter((item) => item.type === "post").map((item) => item.id).sort()).toEqual([101, 102, 103, 104, 105, 106]);
    expect(wp.items.filter((item) => item.type === "page").map((item) => item.id).sort()).toEqual([301, 302, 303, 304, 305, 306, 307]);
    // Custom types are offered, not read; menus and other plumbing aren't even offered.
    expect(wp.items.some((item) => item.type === "course" || item.type === "nav_menu_item")).toBe(false);
    expect(wp.postTypes).toEqual([{ slug: "course", name: "course", count: 1 }]);
    expect(wp.reusableBlocks[150]).toContain("Studio hours change in August.");
  });

  it("keeps statuses, dates, authors, terms and parents", async () => {
    const wp = await readWxr(FILE);
    const byId = (id: number) => wp.items.find((item) => item.id === id)!;

    expect(byId(104).status).toBe("draft");
    expect(byId(104).date).toBe("2024-05-01T08:00:00");
    expect(byId(103).date).toBe("2024-04-12T15:00:00Z");
    expect(byId(103).dateLocal).toBe("2024-04-12T16:00:00");
    expect(byId(307).status).toBe("private");
    expect(byId(106).passwordProtected).toBe(true);
    expect(byId(303).parentId).toBe(302);
    expect(wp.authors.find((author) => author.id === byId(102).authorId)?.name).toBe("Sam Okoro");
    const beginners = wp.terms.find((term) => term.slug === "beginners")!;

    expect(wp.terms.find((term) => term.id === beginners.parentId)?.slug).toBe("workshops");
    expect(byId(101).categoryIds).toEqual([11]);
    expect(byId(101).tagIds).toEqual([21, 22]);
    expect(byId(101).primaryCategoryId).toBe(11);
    // Only approved comments are counted.
    expect(byId(101).commentCount).toBe(2);
    expect(wp.commentCount).toBe(2);
  });

  it("reads SEO plugin fields, filling their templates", async () => {
    const wp = await readWxr(FILE);
    const byId = (id: number) => wp.items.find((item) => item.id === id)!;

    expect(byId(101).seo).toEqual({ title: "Opening the new kiln room", description: "Our new kiln room is open: what changed, and how firing works from April.", plugin: "yoast" });
    expect(byId(102).seo).toMatchObject({ title: "Glaze notes: three recipes we keep coming back to", plugin: "rank-math" });
    expect(byId(103).seo).toEqual({ description: "What we made, broke and learned in the spring term.", plugin: "aioseo" });
    expect(byId(303).seo.canonical).toBe("https://old.example.org/visiting/");
  });

  it("marks page-builder pages and keeps Elementor's own layout data", async () => {
    const wp = await readWxr(FILE);
    const classes = wp.items.find((item) => item.id === 304)!;

    expect(classes.builder?.name).toBe("elementor");
    expect(JSON.parse(String(classes.builder?.data))).toHaveLength(7);
    expect(wp.items.find((item) => item.id === 305)!.builder?.name).toBe("divi");
    expect(classes.featuredMediaId).toBeUndefined();
    expect(wp.items.find((item) => item.id === 101)!.featuredMediaId).toBe(201);
  });

  it("reads the media library with alt text and generated sizes", async () => {
    const wp = await readWxr(FILE);
    const kiln = wp.media.find((media) => media.id === 201)!;

    expect(kiln).toMatchObject({ url: "https://old.example.org/wp-content/uploads/2024/03/kiln-room.png", alt: "The kiln room with its new kiln", mime: "image/png", parentId: 101 });
    expect(kiln.sizes).toEqual(["https://old.example.org/wp-content/uploads/2024/03/kiln-room-300x200.png"]);
    expect(wp.media.find((media) => media.id === 206)!.mime).toBe("application/pdf");
  });

  it("applies --only, --limit and --since while reading", async () => {
    const posts = await readWxr(FILE, { only: ["posts"], limit: 2 });

    expect(posts.items.map((item) => item.id)).toEqual([106, 105]);
    const since = await readWxr(FILE, { since: "2024-04-01" });

    expect(since.items.map((item) => item.id).sort()).toEqual([102, 103, 104, 105, 106]);
    const course = await readWxr(FILE, { only: ["pages"], types: ["course"] });

    expect(course.items.map((item) => item.type).sort()).toEqual(["course", "page", "page", "page", "page", "page", "page", "page"]);
  });

  it("says plainly when the file is missing or isn't an export", async () => {
    await expect(readWxr(join(tempDir("none-"), "nope.xml"))).rejects.toMatchObject({ reason: "file" });
    const other = join(tempDir("rss-"), "feed.xml");

    writeFileSync(other, '<?xml version="1.0"?><feed><title>Not WordPress</title></feed>');
    const error = await readWxr(other).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ImportError);
    expect((error as ImportError).message).toMatch(/isn't a WordPress export/);
  });

  it("survives characters XML forbids and undefined entities", async () => {
    const file = join(tempDir("bad-"), "bad.xml");

    writeFileSync(
      file,
      `<?xml version="1.0"?><rss xmlns:wp="http://wordpress.org/export/1.2/" xmlns:content="http://purl.org/rss/1.0/modules/content/"><channel><title>Bad &nbsp; site</title><link>https://x.example</link><wp:base_site_url>https://x.example</wp:base_site_url>
<item><title>Has \u0001 a control char</title><link>https://x.example/a/</link><content:encoded><![CDATA[<p>Body</p>]]></content:encoded><wp:post_id>1</wp:post_id><wp:post_name>a</wp:post_name><wp:status>publish</wp:status><wp:post_type>post</wp:post_type><wp:post_date>2024-01-01 00:00:00</wp:post_date></item></channel></rss>`
    );
    const wp = await readWxr(file);

    expect(wp.items.map((item) => item.title)).toEqual(["Has  a control char"]);
    expect(wp.notes.join(" ")).toMatch(/formatting problem/);
  });

  it("streams a large export without holding it all in memory", async () => {
    const file = join(tempDir("big-"), "big.xml");
    const stream = createWriteStream(file);
    const body = `<p>${"Clay and glaze and fire. ".repeat(400)}</p>`;

    stream.write(`<?xml version="1.0"?><rss xmlns:wp="http://wordpress.org/export/1.2/" xmlns:content="http://purl.org/rss/1.0/modules/content/" xmlns:dc="http://purl.org/dc/elements/1.1/"><channel><title>Big</title><link>https://big.example</link><wp:base_site_url>https://big.example</wp:base_site_url>\n`);
    for (let i = 1; i <= 4000; i += 1) {
      // Every item also carries a large meta value nobody imports (page-builder CSS).
      stream.write(`<item><title>Post ${i}</title><link>https://big.example/p${i}/</link><content:encoded><![CDATA[${body}]]></content:encoded><wp:post_id>${i}</wp:post_id><wp:post_name>p${i}</wp:post_name><wp:status>publish</wp:status><wp:post_type>post</wp:post_type><wp:post_date>2024-01-01 00:00:${String(i % 60).padStart(2, "0")}</wp:post_date><wp:postmeta><wp:meta_key>_elementor_css</wp:meta_key><wp:meta_value><![CDATA[${"x".repeat(4000)}]]></wp:meta_value></wp:postmeta></item>\n`);
    }
    stream.write("</channel></rss>\n");
    await new Promise<void>((resolve) => stream.end(resolve));
    global.gc?.();
    const before = process.memoryUsage().heapUsed;
    const wp = await readWxr(file, { only: ["posts"], limit: 10 });
    const grown = process.memoryUsage().heapUsed - before;

    expect(wp.items).toHaveLength(10);
    // About 56 MB of XML went through; only a handful of items were kept.
    expect(grown).toBeLessThan(80 * 1024 * 1024);
  }, 60_000);
});
