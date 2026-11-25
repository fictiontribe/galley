/**
 * A secrets file is never content. The entry routes, the content search and
 * "where does this text live" don't ask whether a file may be shown, because
 * they can't reach one: an entry is a file of a collection, the index takes
 * content and template files, and neither takes a file whose name starts
 * with a dot. This holds them to that, with secrets files put where a
 * collection's files are.
 */
import { existsSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { cleanupAll, disposeAll, makeSite, openSite, sh } from "./helpers";

const SECRET = "TOKEN=never-content-4f1c";

afterAll(async () => {
  await disposeAll();
  cleanupAll();
});

describe("a secrets file among a collection's files", { timeout: 120_000 }, () => {
  it("is no entry, is in no listing of entries, and nothing it holds is found by a search or by asking where a text lives", async () => {
    const root = makeSite({});
    const placed = [".env", "src/content/pages/.env", "src/content/pages/.env.md", "src/content/pages/.envrc", "src/content/pages/.env-production.md", "src/pages/.env.astro"];

    for (const path of placed) writeFileSync(join(root, path), path.endsWith(".md") ? `---\ntitle: ${SECRET}\n---\n${SECRET}\n` : `${SECRET}\n`);
    const { site } = await openSite(root);

    for (const path of placed) await expect(site.readEntry(path), path).rejects.toMatchObject({ message: expect.stringMatching(/isn't part of any collection/) });
    const model = await site.model();

    for (const collection of model.collections) {
      const listed = await site.listEntries(collection.id, { limit: 500 });

      expect(JSON.stringify(listed), collection.id).not.toContain("never-content-4f1c");
      expect(listed.items.map((item) => item.path).filter((path) => /(^|\/)\.env/i.test(path)), collection.id).toEqual([]);
    }
    expect(await site.search("never-content-4f1c", { limit: 20 })).toEqual([]);
    for (const mode of ["content", "build"] as const) {
      const found = await site.resolveText({ urlPath: "/", text: SECRET }, { mode });

      expect(found.matches, mode).toEqual([]);
      expect(JSON.stringify(found), mode).not.toContain("never-content-4f1c");
    }
  });

  it("is no entry behind a link either: not listed, not searched, not found by its words, and not read for the list of changes", async () => {
    const root = makeSite({});

    writeFileSync(join(root, ".env"), `---\ntitle: ${SECRET}\n---\n${SECRET}\n`);
    mkdirSync(join(root, ".envs"), { recursive: true });
    writeFileSync(join(root, ".envs/production.md"), `---\ntitle: ${SECRET}\n---\n${SECRET}\n`);
    mkdirSync(join(root, "shared"), { recursive: true });
    writeFileSync(join(root, "shared/from-a-linked-folder.md"), "---\ntitle: From a linked folder\n---\nOrdinary words-7c1e.\n");
    // A link named like an entry that leads to a secrets file; a linked folder that is a secrets folder; a template
    // file that is such a link; and, beside them, an ordinary linked entry and an ordinary linked folder of content.
    symlinkSync("../../../.env", join(root, "src/content/pages/notes.md"));
    symlinkSync("../../../.envs", join(root, "src/content/pages/keys"));
    symlinkSync("../../.env", join(root, "src/pages/leak.astro"));
    symlinkSync("about.md", join(root, "src/content/pages/about-again.md"));
    symlinkSync("../../../shared", join(root, "src/content/pages/shared"));
    sh(root, "add", "-A");
    sh(root, "commit", "-q", "-m", "Links");
    // And one that is a waiting change, not yet published.
    symlinkSync("../../../.env", join(root, "src/content/pages/waiting-notes.md"));
    const { site } = await openSite(root);
    const pages = (await site.listEntries("pages", { limit: 500 })).items.map((item) => item.path);

    expect(pages.filter((path) => /notes\.md$|\/keys\//.test(path))).toEqual([]);
    expect(pages).toEqual(expect.arrayContaining(["src/content/pages/about-again.md", "src/content/pages/shared/from-a-linked-folder.md"]));
    expect(JSON.stringify(await site.listEntries("pages", { limit: 500 }))).not.toContain("never-content-4f1c");
    expect(await site.search("never-content-4f1c", { limit: 20 })).toEqual([]);
    expect((await site.search("words-7c1e", { limit: 20 })).map((hit) => hit.path)).toEqual(["src/content/pages/shared/from-a-linked-folder.md"]);
    for (const mode of ["content", "build"] as const) {
      const found = await site.resolveText({ urlPath: "/", text: SECRET }, { mode });

      expect(JSON.stringify(found), mode).not.toContain("never-content-4f1c");
    }
    for (const path of ["src/content/pages/notes.md", "src/content/pages/keys/production.md", "src/content/pages/waiting-notes.md"]) await expect(site.readEntry(path), path).rejects.toMatchObject({ code: expect.stringMatching(/forbidden|not-found/) });
    // The waiting link is among the changes by its name, and nothing of what it leads to is.
    const changes = await site.changes();

    expect(changes.files.map((file) => file.path)).toContain("src/content/pages/waiting-notes.md");
    expect(JSON.stringify(changes)).not.toContain("never-content-4f1c");
  });

  it("is no entry when the settings name it as a collection, a collection's pattern takes it in, or a template is one", async () => {
    const root = makeSite({});
    const settingsFile = join(root, "galley.config.json");
    const settings = JSON.parse(readFileSync(settingsFile, "utf8")) as { collections?: unknown[]; templates?: unknown[] };

    writeFileSync(join(root, ".env.json"), `${JSON.stringify({ token: "never-content-4f1c" })}\n`);
    writeFileSync(join(root, ".envrc.yaml"), "token: never-content-4f1c\n");
    mkdirSync(join(root, "notes"), { recursive: true });
    writeFileSync(join(root, "notes/.env.md"), `---\ntitle: ${SECRET}\n---\n${SECRET}\n`);
    writeFileSync(join(root, "notes/plain.md"), "---\ntitle: A plain note\n---\nNothing secret.\n");
    writeFileSync(join(root, ".env"), `${SECRET}\n`);
    writeFileSync(
      settingsFile,
      `${JSON.stringify(
        {
          ...settings,
          collections: [
            ...(settings.collections ?? []),
            { id: "keys", label: "Keys", kind: "data", path: ".env.json", format: "json" },
            { id: "more-keys", label: "More keys", kind: "data", path: ".envrc.yaml", format: "yaml" },
            { id: "notes", label: "Notes", kind: "entries", path: "notes", pattern: "{*.md,.env*.md}", format: "markdown", body: true },
          ],
          templates: [...(settings.templates ?? []), { id: "from-secrets", label: "From secrets", collection: "notes", file: ".env" }],
        },
        null,
        2
      )}\n`
    );
    sh(root, "add", "-A");
    sh(root, "commit", "-q", "-m", "Settings that name secrets files");
    const { site } = await openSite(root);

    // The settings were taken as written: the three collections are there.
    expect((await site.model()).collections.map((collection) => collection.id)).toEqual(expect.arrayContaining(["keys", "more-keys", "notes"]));
    for (const path of [".env.json", ".envrc.yaml", "notes/.env.md"]) await expect(site.readEntry(path), path).rejects.toMatchObject({ message: expect.stringMatching(/isn't part of any collection/) });
    for (const id of ["keys", "more-keys", "notes"]) {
      const listed = await site.listEntries(id, { limit: 100 }).catch((error: unknown) => ({ items: [], error: String(error) }));

      expect(JSON.stringify(listed), id).not.toContain("never-content-4f1c");
    }
    // The plain note beside it is content as it always was.
    expect((await site.listEntries("notes", { limit: 100 })).items.map((item) => item.path)).toEqual(["notes/plain.md"]);
    expect(await site.search("never-content-4f1c", { limit: 20 })).toEqual([]);
    expect((await site.resolveText({ urlPath: "/", text: SECRET }, { mode: "build" })).matches).toEqual([]);
    // And a new entry is not made from a secrets file named as a template.
    await expect(site.createEntry({ collection: "notes", slug: "from-secrets", data: {}, template: "from-secrets" }, { origin: "user" })).rejects.toMatchObject({ code: "forbidden" });
    expect(existsSync(join(root, "notes/from-secrets.md"))).toBe(false);
  });
});
