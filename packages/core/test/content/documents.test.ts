import { describe, expect, it } from "vitest";

import { formatForPath, parseDocument, serializeEntry } from "../../src/content/index";
import type { Collection } from "../../src/types";

describe("formatForPath", () => {
  it("maps extensions to formats", () => {
    expect(["a.md", "b.MDX", "c.json", "d.yml", "e.yaml", "f.toml", "g.astro", "h"].map(formatForPath)).toEqual(["markdown", "mdx", "json", "yaml", "yaml", "toml", null, null]);
  });
});

describe("parseDocument", () => {
  it("splits YAML front matter and body with exact offsets", () => {
    const raw = "---\ntitle: Hi\ndate: 2026-01-02\n---\n\nBody\n";
    const doc = parseDocument(raw, "markdown");

    expect(doc.data).toEqual({ title: "Hi", date: "2026-01-02" });
    expect(doc.body).toBe("\nBody\n");
    expect(doc.frontMatter).toEqual({ syntax: "yaml", start: 4, end: 31, text: "title: Hi\ndate: 2026-01-02\n" });
    expect(raw.slice(doc.bodyStart)).toBe(doc.body);
    expect(doc.errors).toEqual([]);
  });

  it("keeps ISO dates as strings", () => {
    expect(parseDocument("---\nat: 2026-01-02T10:00:00Z\n---\n", "markdown").data.at).toBe("2026-01-02T10:00:00Z");
  });

  it("reads TOML front matter, normalising dates", () => {
    const doc = parseDocument('+++\ntitle = "Hi"\ndate = 2025-11-02\n+++\nBody\n', "markdown");

    expect(doc.data).toEqual({ title: "Hi", date: "2025-11-02" });
    expect(doc.frontMatter?.syntax).toBe("toml");
    expect(doc.body).toBe("Body\n");
  });

  it("reads JSON front matter", () => {
    const doc = parseDocument('{\n  "title": "Hi"\n}\nBody\n', "markdown");

    expect(doc.data).toEqual({ title: "Hi" });
    expect(doc.body).toBe("Body\n");
  });

  it("handles a BOM, CRLF, empty front matter and no front matter", () => {
    expect(parseDocument("﻿---\r\ntitle: Hi\r\n---\r\nBody\r\n", "markdown")).toMatchObject({ data: { title: "Hi" }, body: "Body\r\n" });
    expect(parseDocument("---\n---\nBody\n", "markdown")).toMatchObject({ data: {}, body: "Body\n", errors: [] });
    expect(parseDocument("Just text\n", "markdown")).toMatchObject({ data: {}, body: "Just text\n", bodyStart: 0 });
  });

  it("reports parse problems instead of throwing", () => {
    const doc = parseDocument("---\ntitle: [oops\n---\n", "markdown");

    expect(doc.errors[0]).toMatch(/fields at the top of the file could not be read/);
    expect(parseDocument("{ broken", "json").errors).toHaveLength(1);
    expect(parseDocument("---\njust a string\n---\n", "markdown").errors[0]).toMatch(/single value/);
  });

  it("presents a top-level list as items", () => {
    expect(parseDocument("- a\n- b\n", "yaml")).toMatchObject({ data: { items: ["a", "b"] }, rootList: true, body: null });
    expect(parseDocument('[{"id":1}]', "json").data).toEqual({ items: [{ id: 1 }] });
  });
});

describe("serializeEntry", () => {
  const collection: Collection = {
    id: "pages",
    label: "Pages",
    singular: "page",
    kind: "entries",
    path: "src/content/pages",
    format: "markdown",
    body: true,
    url: "/{slug}/",
    count: 0,
    create: true,
    source: "inferred",
    fields: [
      { key: "title", label: "Title", type: "string", required: true, source: "inferred" },
      {
        key: "sections",
        label: "Sections",
        type: "blocks",
        required: false,
        source: "inferred",
        discriminator: "type",
        blocks: [{ type: "hero", label: "Hero", count: 1, fields: [{ key: "heading", label: "Heading", type: "string", required: true, source: "inferred" }, { key: "image", label: "Image", type: "image", required: false, source: "inferred" }] }],
      },
    ],
  };

  it("orders keys by the collection's fields, discriminator first in blocks", () => {
    const text = serializeEntry(collection, { extra: 1, sections: [{ image: "/a.png", heading: "Hi", type: "hero" }], title: "New page" }, "Hello there.");

    expect(text).toBe("---\ntitle: New page\nsections:\n  - type: hero\n    heading: Hi\n    image: /a.png\nextra: 1\n---\n\nHello there.\n");
    expect(parseDocument(text, "markdown").data.title).toBe("New page");
  });

  it("writes JSON and YAML data files", () => {
    expect(serializeEntry({ ...collection, format: "json" }, { b: 1, title: "x" })).toBe('{\n  "title": "x",\n  "b": 1\n}\n');
    expect(serializeEntry({ ...collection, format: "yaml" }, { title: "x" })).toBe("title: x\n");
    expect(serializeEntry(collection, {})).toBe("---\n---\n");
  });
});
