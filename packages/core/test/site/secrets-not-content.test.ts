/**
 * A secrets file is never content. The entry routes, the content search and
 * "where does this text live" don't ask whether a file may be shown, because
 * they can't reach one: an entry is a file of a collection, the index takes
 * content and template files, and neither takes a file whose name starts
 * with a dot. This holds them to that, with secrets files put where a
 * collection's files are.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
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
