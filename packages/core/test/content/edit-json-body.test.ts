import { describe, expect, it } from "vitest";

import { applyEdits, enumerateBodyBlocks } from "../../src/content/index";
import { changedLines } from "./helpers";

const JSON_FILE = `{
    "title": "Harbour",
    "links": [
        { "label": "About", "href": "/about/" },
        { "label": "Blog", "href": "/blog/" }
    ],
    "count": 2,
    "tags": ["a", "b"]
}
`;

describe("JSON edits", () => {
  it("returns the input exactly with no ops or a same-value set", () => {
    expect(applyEdits(JSON_FILE, "json", []).content).toBe(JSON_FILE);
    expect(applyEdits(JSON_FILE, "json", [{ op: "set", path: ["title"], value: "Harbour" }])).toEqual({ content: JSON_FILE, applied: 0, refused: [] });
  });

  it("splices a scalar in place", () => {
    const result = applyEdits(JSON_FILE, "json", [{ op: "set", path: ["links", 1, "label"], value: "Notes \"and\" news" }]);

    expect(changedLines(JSON_FILE, result.content)).toEqual({
      removed: ['        { "label": "Blog", "href": "/blog/" }'],
      added: ['        { "label": "Notes \\"and\\" news", "href": "/blog/" }'],
    });
  });

  it("adds a key with the file's own indentation", () => {
    const result = applyEdits(JSON_FILE, "json", [{ op: "set", path: ["subtitle"], value: "By the pier" }]);

    expect(changedLines(JSON_FILE, result.content)).toEqual({ removed: ['    "tags": ["a", "b"]'], added: ['    "tags": ["a", "b"],', '    "subtitle": "By the pier"'] });
  });

  it("creates nested objects", () => {
    const result = applyEdits(JSON_FILE, "json", [{ op: "set", path: ["seo", "title"], value: "x" }]);

    expect(JSON.parse(result.content).seo).toEqual({ title: "x" });
    expect(result.content.endsWith("}\n")).toBe(true);
  });

  it("unsets, inserts, removes and moves", () => {
    const unset = applyEdits(JSON_FILE, "json", [{ op: "unset", path: ["count"] }]);

    expect(changedLines(JSON_FILE, unset.content)).toEqual({ removed: ['    "count": 2,'], added: [] });
    const insert = applyEdits(JSON_FILE, "json", [{ op: "insert", path: ["tags"], index: 1, value: "z" }]);

    expect(changedLines(JSON_FILE, insert.content).added).toEqual(['    "tags": ["a", "z", "b"]']);
    const remove = applyEdits(JSON_FILE, "json", [{ op: "remove", path: ["links"], index: 0 }]);

    expect(JSON.parse(remove.content).links).toEqual([{ label: "Blog", href: "/blog/" }]);
    const move = applyEdits(JSON_FILE, "json", [{ op: "move", path: ["links"], from: 1, to: 0 }]);

    expect(JSON.parse(move.content).links.map((link: { label: string }) => link.label)).toEqual(["Blog", "About"]);
    expect(move.content).toContain('{ "label": "Blog", "href": "/blog/" },\n        { "label": "About", "href": "/about/" }');
  });

  it("keeps tab indentation and a missing trailing newline", () => {
    const raw = '{\n\t"a": 1\n}';
    const result = applyEdits(raw, "json", [{ op: "set", path: ["b"], value: [1, 2] }]);

    expect(result.content).toBe('{\n\t"a": 1,\n\t"b": [\n\t\t1,\n\t\t2\n\t]\n}');
  });

  it("addresses a top-level array through `items`", () => {
    const raw = '[\n  { "name": "Ana" }\n]\n';
    const result = applyEdits(raw, "json", [{ op: "insert", path: ["items"], index: 1, value: { name: "Ben" } }]);

    expect(JSON.parse(result.content)).toEqual([{ name: "Ana" }, { name: "Ben" }]);
    expect(result.content).toBe('[\n  { "name": "Ana" },\n  {\n    "name": "Ben"\n  }\n]\n');
  });

  it("refuses edits to invalid JSON", () => {
    expect(applyEdits("{ nope", "json", [{ op: "set", path: ["a"], value: 1 }]).refused[0]?.reason).toMatch(/formatting mistake/);
  });

  it("edits JSON front matter in markdown", () => {
    const raw = '{\n  "title": "Old"\n}\n\nBody\n';

    expect(applyEdits(raw, "markdown", [{ op: "set", path: ["title"], value: "New" }]).content).toBe('{\n  "title": "New"\n}\n\nBody\n');
  });
});

const BODY_DOC = `---
title: Post
---

# Big title

A paragraph with **bold** and a [link](/about/).

Plain words only,
wrapped over two lines.

- first item
- second item
  continued
1. ordered

\`\`\`md
# not a heading

- not a list
\`\`\`

> A quote

| a | b |
|---|---|
| 1 | 2 |

<div class="note">Raw HTML</div>

---

Setext title
============
`;

describe("body blocks", () => {
  const body = BODY_DOC.slice(BODY_DOC.indexOf("---\n", 4) + 4);
  const blocks = enumerateBodyBlocks(body);

  it("finds every block kind without splitting fenced code", () => {
    expect(blocks.map((block) => block.kind)).toEqual(["heading", "paragraph", "paragraph", "list-item", "list-item", "list-item", "code", "quote", "table", "html", "rule", "heading"]);
    expect(blocks.find((block) => block.kind === "code")!.raw).toContain("# not a heading");
  });

  it("gives offsets relative to the body", () => {
    for (const block of blocks) expect(body.slice(block.start, block.end)).toBe(block.raw);
  });

  it("strips heading markers and list bullets", () => {
    expect(blocks[0]).toMatchObject({ kind: "heading", level: 1, text: "Big title", raw: "# Big title", inline: true });
    expect(body.slice(blocks[0]!.contentStart, blocks[0]!.contentEnd)).toBe("Big title");
    expect(blocks[3]).toMatchObject({ kind: "list-item", raw: "first item", key: "body.3.0" });
    expect(blocks[4]).toMatchObject({ raw: "second item\n  continued", text: "second item continued", key: "body.3.1" });
    expect(blocks[11]).toMatchObject({ kind: "heading", level: 1, text: "Setext title" });
  });

  it("marks only markup-free prose as retypable in place", () => {
    expect(blocks[1]).toMatchObject({ text: "A paragraph with bold and a link.", inline: false });
    expect(blocks[2]).toMatchObject({ text: "Plain words only, wrapped over two lines.", inline: true });
    expect(blocks.find((block) => block.kind === "html")!.inline).toBe(false);
  });

  it("treats MDX import/export and JSX as their own locked html blocks", () => {
    const mdx = 'import Card from "./Card.astro";\nexport const meta = { a: 1 };\n\nText here.\n\n<Card title="x">\n  Inside\n</Card>\n';
    const found = enumerateBodyBlocks(mdx);

    expect(found.map((block) => [block.kind, block.inline])).toEqual([
      ["html", false],
      ["paragraph", true],
      ["html", false],
    ]);
  });

  it("handles CRLF bodies", () => {
    const found = enumerateBodyBlocks("# Hi\r\n\r\nText\r\n");

    expect(found.map((block) => block.raw)).toEqual(["# Hi", "Text"]);
  });
});

describe("body edits", () => {
  it("replaces the body, keeping the blank line after the front matter and the final newline", () => {
    const raw = "---\ntitle: x\n---\n\nOld body.\n";
    const result = applyEdits(raw, "markdown", [{ op: "body", value: "New body." }]);

    expect(result.content).toBe("---\ntitle: x\n---\n\nNew body.\n");
    expect(applyEdits(raw, "markdown", [{ op: "body", value: "Old body." }]).applied).toBe(0);
  });

  it("replaces text inside the body and refuses when absent or ambiguous", () => {
    const raw = "---\ntitle: Learn more\n---\n\nLearn more here. Learn more there.\n";

    expect(applyEdits(raw, "markdown", [{ op: "body-replace", find: "more here", replace: "more now" }]).content).toBe("---\ntitle: Learn more\n---\n\nLearn more now. Learn more there.\n");
    expect(applyEdits(raw, "markdown", [{ op: "body-replace", find: "Learn more", replace: "x" }]).refused[0]?.reason).toMatch(/appears 2 times/);
    expect(applyEdits(raw, "markdown", [{ op: "body-replace", find: "missing", replace: "x" }]).refused[0]?.reason).toMatch(/isn't in the main text/);
    expect(applyEdits(raw, "markdown", [{ op: "body-replace", find: "Learn more", replace: "See", all: true }]).content).toBe("---\ntitle: Learn more\n---\n\nSee here. See there.\n");
  });

  it("refuses body ops on data files", () => {
    expect(applyEdits("{}\n", "json", [{ op: "body", value: "x" }]).refused[0]?.reason).toMatch(/no main text/);
  });

  it("replaces the whole file with raw", () => {
    expect(applyEdits("a", "markdown", [{ op: "raw", value: "b" }])).toEqual({ content: "b", applied: 1, refused: [] });
    expect(applyEdits("a", "markdown", [{ op: "raw", value: "a" }]).applied).toBe(0);
  });
});
