/**
 * Golden files for HTML → Markdown. Each case is one small, named file in
 * test/golden: `<case>.html` in, `<case>.md` out. Files starting with "raw-"
 * are database content as an export file carries it; "rendered-" files are
 * what the REST API returns. Regenerate with UPDATE_GOLDEN=1 and read every
 * diff before committing it — the expected files are the specification.
 */
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { convertHtml, type ConvertResult } from "../src/convert/html";
import type { WordPressMedia } from "../src/types";

const DIR = fileURLToPath(new URL("./golden", import.meta.url));
const SITE = "https://old.example.org";

export const GOLDEN_MEDIA: WordPressMedia[] = [
  { id: 203, url: `${SITE}/wp-content/uploads/2024/04/bowl.png`, sizes: [], title: "Bowl", alt: "A speckled bowl", caption: "Speckled bowl", mime: "image/png" },
  { id: 204, url: `${SITE}/wp-content/uploads/2024/04/mugs.png`, sizes: [], title: "Mugs", alt: "Four mugs in a row", caption: "", mime: "image/png" },
];

function convert(name: string, html: string): ConvertResult {
  return convertHtml(html, {
    siteUrl: SITE,
    form: name.startsWith("raw-") ? "raw" : "rendered",
    reusable: { 150: "<!-- wp:paragraph -->\n<p>Studio hours change in August.</p>\n<!-- /wp:paragraph -->" },
    mediaById: (id) => GOLDEN_MEDIA.find((media) => media.id === id),
    attachments: () => [],
    resolveLink: (url) => (new URL(url).pathname === "/2024/03/glaze-notes/" ? "/blog/glaze-notes/" : new URL(url).pathname === "/classes/" ? "/classes/" : null),
  });
}

const cases = readdirSync(DIR)
  .filter((file) => file.endsWith(".html"))
  .map((file) => file.replace(/\.html$/, ""))
  .sort();

describe("HTML → Markdown golden files", () => {
  for (const name of cases) {
    it(name, () => {
      const html = readFileSync(join(DIR, `${name}.html`), "utf8");
      const result = convert(name, html);
      const expectedPath = join(DIR, `${name}.md`);

      if (process.env.UPDATE_GOLDEN) writeFileSync(expectedPath, `${result.markdown}\n`);
      expect(`${result.markdown}\n`).toBe(readFileSync(expectedPath, "utf8"));
    });
  }
});

describe("what conversion reports", () => {
  const read = (name: string) => convert(name, readFileSync(join(DIR, `${name}.html`), "utf8"));

  it("counts every embed it keeps", () => {
    expect(read("raw-embed-kept").embeds).toBe(2);
    expect(read("rendered-embed").embeds).toBe(1);
    expect(read("raw-iframe-kept").embeds).toBe(1);
    expect(read("raw-video-audio").embeds).toBe(2);
  });

  it("lists unknown shortcodes, once per use, and leaves prose brackets alone", () => {
    expect(read("raw-unknown-shortcode").shortcodes).toEqual(["newsletter_signup", "members_only"]);
  });

  it("finds leftover shortcodes in rendered text only — not in styles, attributes or code", () => {
    expect(read("rendered-text-shortcodes").shortcodes).toEqual(["mailing_list"]);
  });

  it("returns the teaser before <!--more-->", () => {
    expect(read("raw-more-tag").teaser).toBe("We open the doors to the kiln room this weekend.");
  });

  it("collects media on the old site, files it links to, and links it couldn't resolve", () => {
    const links = read("rendered-links");

    expect(links.files).toEqual([`${SITE}/wp-content/uploads/2024/03/price-list.pdf`]);
    expect(links.unresolvedLinks).toEqual([`${SITE}/shop/`]);
    expect(links.media.map((m) => m.url)).toEqual([`${SITE}/wp-content/uploads/2024/04/bowl-150x150.png`]);
    expect(read("rendered-lazy-images").media.map((m) => m.url)).toEqual([`${SITE}/wp-content/uploads/2024/04/mugs-768x512.png`, "https://i0.wp.com/old.example.org/wp-content/uploads/2024/04/bowl.png?resize=640%2C427&ssl=1"]);
  });

  it("notes dynamic blocks, missing reusable blocks, forms and removed scripts", () => {
    const dynamic = read("raw-dynamic-reusable");

    expect(dynamic.dynamicBlocks).toEqual(["latest-posts"]);
    expect(dynamic.missingReusable).toEqual([999]);
    const form = read("rendered-form");

    expect(form.forms).toBe(1);
    expect(form.scriptsRemoved).toBe(1);
  });
});
