import { mkdtempSync, rmSync, writeFileSync, cpSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, describe, expect, it } from "vitest";

import { configJsonSchema, detectSite, inferFields, loadSiteModel, mergeConfig, readConfig, serializeConfig, validateConfig } from "../../src/content/index";
import { GalleyError } from "../../src/errors";
import type { JsonValue } from "../../src/types";
import { PLAIN } from "./helpers";

const items = (count: number, make: (index: number) => { [key: string]: JsonValue }) => Array.from({ length: count }, (_, index) => make(index));

describe("inference", () => {
  it("types values only when every value agrees", () => {
    const fields = inferFields([
      { when: "2026-01-02", at: "2026-01-02T10:00:00Z", hero: "/images/a.webp", link: "https://example.org", colour: "#1a2b3c", n: 3, on: true, mixed: "/about/" },
      { when: "2026-02-03", at: "2026-02-03", hero: "/images/b.png", link: "/contact/", colour: "#fff", n: 4.5, on: false, mixed: "not a link" },
    ]);
    const type = (key: string) => fields.find((field) => field.key === key)?.type;

    expect(type("when")).toBe("date");
    expect(type("at")).toBe("datetime");
    expect(type("hero")).toBe("image");
    expect(type("link")).toBe("url");
    expect(type("colour")).toBe("color");
    expect(type("n")).toBe("number");
    expect(type("on")).toBe("boolean");
    expect(type("mixed")).toBe("string");
  });

  it("recognises images by the media path even without an extension", () => {
    expect(inferFields([{ pic: "/media/abc123" }], { mediaPublicPaths: ["/media"] })[0]?.type).toBe("image");
  });

  it("tells long text and markdown apart from one-line strings", () => {
    const fields = inferFields([{ body: "Two\nlines", md: "Some **bold** words", one: "short" }]);

    expect(fields.map((field) => field.type)).toEqual(["text", "markdown", "string"]);
  });

  it("marks a field required only at 95% presence", () => {
    const required = inferFields(items(20, (i): { [key: string]: JsonValue } => (i === 0 ? {} : { title: `T${i}` })));
    const notRequired = inferFields(items(20, (i): { [key: string]: JsonValue } => (i < 2 ? {} : { title: `T${i}` })));

    expect(required[0]?.required).toBe(true);
    expect(notRequired[0]?.required).toBe(false);
  });

  it("only offers a select on strong evidence: ≤ 8 values across ≥ 12 files", () => {
    const strong = inferFields(items(12, (i) => ({ theme: ["light", "dark"][i % 2]! })));
    const tooFewFiles = inferFields(items(11, (i) => ({ theme: ["light", "dark"][i % 2]! })));
    const tooManyValues = inferFields(items(20, (i) => ({ theme: `t${i % 9}` })));

    expect(strong[0]).toMatchObject({ type: "select", options: ["dark", "light"] });
    expect(tooFewFiles[0]?.type).toBe("string");
    expect(tooManyValues[0]?.type).toBe("string");
  });

  it("turns lists of short strings into tags with corpus suggestions", () => {
    const [tags] = inferFields([{ tags: ["a", "b"] }, { tags: ["a"] }]);

    expect(tags).toMatchObject({ type: "tags", options: ["a", "b"] });
  });

  it("detects blocks by their discriminator and keeps the most complete example", () => {
    const [sections] = inferFields([
      { sections: [{ _component: "sections/hero-banner", heading: "Hi" }, { _component: "sections/quote", text: "Q", by: "A" }] },
      { sections: [{ _component: "sections/hero-banner", heading: "Hello", image: "/a.png", cta: { label: "Go" } }] },
    ]);

    expect(sections).toMatchObject({ type: "blocks", discriminator: "_component" });
    expect(sections!.blocks?.map((block) => [block.type, block.label, block.count])).toEqual([
      ["sections/hero-banner", "Hero banner", 2],
      ["sections/quote", "Quote", 1],
    ]);
    expect(sections!.blocks?.[0]?.example).toEqual({ _component: "sections/hero-banner", heading: "Hello", image: "/a.png", cta: { label: "Go" } });
    expect(sections!.blocks?.[0]?.fields.map((field) => [field.key, field.type, field.required])).toEqual([
      ["heading", "string", true],
      ["image", "image", false],
      ["cta", "object", false],
    ]);
  });

  it("keeps a list of objects without a discriminator as a list of objects", () => {
    const [links] = inferFields([{ links: [{ label: "A", href: "/a/" }] }]);

    expect(links).toMatchObject({ type: "list", of: { type: "object" } });
  });

  it("gives up to three real examples", () => {
    const [title] = inferFields(items(5, (i) => ({ title: `Post ${i}` })));

    expect(title?.examples).toEqual(["Post 0", "Post 1", "Post 2"]);
  });
});

describe("galley.config.json", () => {
  const scratch = mkdtempSync(join(tmpdir(), "content-config-"));

  afterAll(() => rmSync(scratch, { recursive: true, force: true }));

  it("validates with readable messages", () => {
    expect(validateConfig({ collections: [{ id: "blog", format: "docx" }] })).toEqual({ ok: false, errors: [expect.stringMatching(/^collections\[0\]\.format: must be one of "markdown"/)] });
    expect(validateConfig({ colections: [] })).toEqual({ ok: false, errors: [expect.stringMatching(/“colections” is not a setting/)] });
    expect(validateConfig({ urls: { production: "not a url" } })).toEqual({ ok: false, errors: ["urls.production: should be a valid web address (https://…)."] });
    expect(validateConfig({ collections: [{ id: "pages", fields: [{ key: "hero", fields: [{ key: "title", type: "string" }] }] }] }).ok).toBe(true);
  });

  it("serialises with $schema first and a trailing newline", () => {
    const text = serializeConfig({ name: "Site", $schema: undefined });

    expect(text.startsWith('{\n  "$schema": "')).toBe(true);
    expect(text.endsWith("}\n")).toBe(true);
    expect(JSON.parse(text).name).toBe("Site");
  });

  it("emits a JSON Schema for editors", () => {
    const schema = configJsonSchema() as { properties: Record<string, unknown>; $id: string };

    expect(Object.keys(schema.properties)).toEqual(expect.arrayContaining(["collections", "media", "publish", "writable", "templates"]));
    expect(schema.$id).toBe("https://galley.fictiontribe.com/schema/galley.config.json");
    // Section pictures and templates are part of what editors autocomplete.
    expect(JSON.stringify(schema)).toContain('"thumbnail"');
    expect(validateConfig({ templates: [{ id: "landing", label: "Landing", collection: "pages", file: "t/landing.md", thumbnail: "t/landing.webp" }] }).ok).toBe(true);
    expect(validateConfig({ templates: [{ id: "landing", label: "Landing", collection: "pages" }] })).toMatchObject({ ok: false });
    expect(validateConfig({ collections: [{ id: "pages", fields: [{ key: "sections", blocks: [{ type: "hero", thumbnail: "galley/sections/hero.webp" }] }] }] }).ok).toBe(true);
  });

  it("reads, and throws a plain-words GalleyError for a bad file", async () => {
    const root = join(scratch, "bad");

    cpSync(PLAIN, root, { recursive: true });
    expect(await readConfig(root)).toBeNull();
    writeFileSync(join(root, "galley.config.json"), "{ nope");
    await expect(readConfig(root)).rejects.toThrow(GalleyError);
    await expect(readConfig(root)).rejects.toMatchObject({ code: "invalid", message: expect.stringMatching(/not valid JSON/) });
    writeFileSync(join(root, "galley.config.json"), JSON.stringify({ dev: { port: "x" } }));
    await expect(readConfig(root)).rejects.toMatchObject({ message: expect.stringMatching(/dev\.port: should be a number/) });
    const model = await loadSiteModel(root);

    expect(model.notes.at(-1)).toMatch(/ignored until it is fixed/);
  });

  it("merges over detection: config beats schema beats inference", async () => {
    const detected = await detectSite(PLAIN);
    const merged = mergeConfig(detected, {
      name: "Notebook",
      urls: { production: "https://notes.example" },
      collections: [
        { id: "notes", label: "Journal", url: "/notes/{slug}/", fields: [{ key: "mood", type: "select", options: ["calm", "busy"] }, { key: "rating", type: "number" }] },
        { id: "nopath" },
      ],
    });
    const notes = merged.collections.find((collection) => collection.id === "notes")!;

    expect(merged.name).toBe("Notebook");
    expect(merged.urls.production).toBe("https://notes.example");
    expect(notes).toMatchObject({ label: "Journal", url: "/notes/{slug}/", source: "config", count: 4 });
    expect(notes.fields.map((field) => [field.key, field.type, field.source])).toEqual([
      ["title", "string", "inferred"],
      ["mood", "select", "config"],
      ["rating", "number", "config"],
    ]);
    expect(merged.notes.some((note) => note.includes("“nopath”"))).toBe(true);
    expect(mergeConfig(detected, null)).toBe(detected);
  });

  it("adds a collection the config points at and reads its files", async () => {
    const root = join(scratch, "added");

    cpSync(PLAIN, root, { recursive: true });
    writeFileSync(join(root, "galley.config.json"), serializeConfig({ collections: [{ id: "archive", path: "notes/archive", label: "Archive" }] }));
    const model = await loadSiteModel(root);
    const archive = model.collections.find((collection) => collection.id === "archive")!;

    expect(archive).toMatchObject({ path: "notes/archive", count: 1, kind: "entries", source: "config", titleField: "title" });
    // The more specific folder now owns its file, so the parent collection has one fewer.
    expect(model.collections.find((collection) => collection.id === "notes")!.count).toBe(3);
    expect(model.writable.content).toContain("notes/archive/**");
  });
});
