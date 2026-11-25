/**
 * The content-code guard wired through the real write surface. A site with an
 * Astro Markdown collection and an MDX one is opened through the facade, and
 * writeFile / updateEntry / createEntry are driven as the roles reach them.
 * This proves the service calls the guard on every write path, and that it
 * asks the account's level (the table test proves the guard's decisions).
 */
import { afterEach, describe, expect, it } from "vitest";
import { withCaller } from "../../src/install/caller";
import { GalleyError } from "../../src/errors";
import { cleanupAll, disposeAll, openSite, sh, tempDir, writeTree } from "./helpers";

afterEach(async () => {
  await disposeAll();
  cleanupAll();
});

const CONFIG = JSON.stringify(
  {
    name: "Docs",
    framework: "astro",
    ai: { allowBuild: true },
    collections: [
      { id: "pages", path: "src/content/pages", format: "markdown", pattern: "**/*.md" },
      { id: "docs", path: "src/content/docs", format: "mdx", pattern: "**/*.mdx" },
    ],
  },
  null,
  2
);

function fixture(): string {
  const root = tempDir("content-code-site-");

  writeTree(root, {
    "galley.config.json": `${CONFIG}\n`,
    "src/content/pages/about.md": "---\ntitle: About\n---\n\nAbout us.\n",
    "src/content/docs/intro.mdx": "---\ntitle: Intro\n---\n\nPlain prose.\n",
  });
  sh(root, "init", "-q", "-b", "main");
  sh(root, "add", "-A");
  sh(root, "commit", "-q", "-m", "First version");
  return root;
}

const as = <T>(role: "owner" | "contributor", run: () => Promise<T>): Promise<T> => withCaller({ accountId: `${role}-1`, role }, run);
const asPage = <T>(role: "owner" | "contributor", run: () => Promise<T>): Promise<T> => withCaller({ accountId: `${role}-1`, role, viaPreview: true }, run);

async function refusalOf(promise: Promise<unknown>): Promise<string | null> {
  try {
    await promise;
    return null;
  } catch (error) {
    if (error instanceof GalleyError && (error.code === "forbidden" || error.code === "invalid")) return error.message;
    throw error;
  }
}

describe("the content-code guard through the write surface", { timeout: 120_000 }, () => {
  it("lets a contributor write Astro Markdown and media, and refuses MDX and site source via writeFile", async () => {
    const { site } = await openSite(fixture());
    const content = { origin: "user" as const, mode: "content" as const };

    await as("contributor", async () => {
      // Astro Markdown is inert: a contributor may add and edit it.
      expect(await refusalOf(site.writeFile("src/content/pages/new.md", "---\ntitle: New\n---\n\nHello.\n", content))).toBeNull();
      // Media beside an entry is fine.
      expect(await refusalOf(site.writeFile("src/content/pages/photo.png", new Uint8Array([1, 2, 3]), content))).toBeNull();
      // MDX is guarded whole, even prose: refused for a contributor.
      expect(await refusalOf(site.writeFile("src/content/docs/new.mdx", "---\nt: x\n---\n\nJust words.\n", content))).toMatch(/build mode/);
      // A file the site is built from is refused wherever it is — the allowlist covers paths outside every collection.
      expect(await refusalOf(site.writeFile("src/layouts/Base.astro", "x", content))).toMatch(/build mode/);
      expect(await refusalOf(site.writeFile("galley.config.json", "{}", content))).toMatch(/build mode/);
      expect(await refusalOf(site.writeFile("src/content/pages/evil.js", "x", content))).toMatch(/build mode/);
    });
  });

  it("guards updateEntry and createEntry by the account's level, MDX included", async () => {
    const { site } = await openSite(fixture());

    await as("contributor", async () => {
      // Editing an MDX entry is refused for a contributor: updateEntry applies nothing and says why.
      const edit = await site.updateEntry("src/content/docs/intro.mdx", [{ op: "set", path: ["title"], value: "Changed" }], { origin: "user" });

      expect(edit.applied).toBe(0);
      expect(edit.refused[0]?.reason).toMatch(/build mode/);
      // Creating an MDX entry is refused (createEntry throws).
      expect(await refusalOf(site.createEntry({ collection: "docs", slug: "new", data: { title: "New" }, body: "Prose." }, { origin: "user" }))).toMatch(/build mode/);
      // Creating a Markdown entry is allowed.
      expect(await refusalOf(site.createEntry({ collection: "pages", slug: "fresh", data: { title: "Fresh" }, body: "Prose." }, { origin: "user" }))).toBeNull();
    });
  });

  it("lets an owner in a content conversation edit MDX — the one question is the level, not the mode", async () => {
    const { site } = await openSite(fixture());
    const content = { origin: "user" as const, mode: "content" as const };

    expect(await as("owner", () => refusalOf(site.writeFile("src/content/docs/owner.mdx", "---\nt: x\n---\n\n{code()}\n", content)))).toBeNull();
    expect(await as("contributor", () => refusalOf(site.writeFile("src/content/docs/c.mdx", "---\nt: x\n---\n\n{code()}\n", content)))).toMatch(/build mode/);
  });

  it("holds a save the previewed page asked for to the allowlist, even for an owner in edit mode", async () => {
    const { site } = await openSite(fixture());
    const content = { origin: "user" as const, mode: "content" as const };

    // A page-initiated (marked) save as the owner: Markdown is accepted...
    expect(await asPage("owner", () => refusalOf(site.writeFile("src/content/pages/from-page.md", "---\ntitle: P\n---\n\nHello.\n", content)))).toBeNull();
    // ...but MDX is refused, though the same owner may write it unmarked.
    expect(await asPage("owner", () => refusalOf(site.writeFile("src/content/docs/from-page.mdx", "---\nt: x\n---\n\n{code()}\n", content)))).toMatch(/build mode/);
  });
});
