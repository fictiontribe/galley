/**
 * The content-code guard (src/site/content-code.ts) as a decision table. Each
 * row is (framework + collections, path) and what an account below build-mode
 * level — a contributor — may do. The judge is gone: a file is inert or it is
 * not, by framework and lower-cased extension, and the guard is an allowlist,
 * so a path outside every collection (the site's own config and source) is
 * refused too.
 *
 * The account's level is the only question: an owner or editor, and nobody
 * (local and desktop, where there is no caller), may write every row. The
 * table asserts that at the end.
 */
import { describe, expect, it } from "vitest";
import { withCaller } from "../../src/install/caller";
import { contentWriteRefusal, layoutRefusal } from "../../src/site/content-code";
import type { Collection, SiteModel } from "../../src/types";

const collection = (over: Partial<Collection>): Collection =>
  ({ id: "c", label: "C", singular: "c", kind: "entries", path: "src/content/c", format: "markdown", body: true, url: null, fields: [], create: true, count: 0, source: "inferred", ...over }) as Collection;

const model = (over: Partial<SiteModel>): SiteModel =>
  ({
    framework: { id: "astro", name: "Astro" },
    dev: { command: "" },
    build: null,
    media: { dir: "public", publicPath: "/", roots: [{ dir: "public", publicPath: "/" }] },
    collections: [],
    redirects: null,
    templates: [],
    ...over,
  }) as unknown as SiteModel;

/** An Astro site with a Markdown and an MDX collection, a data collection, and the default media root. */
const astro = model({
  collections: [
    collection({ id: "pages", path: "src/content/pages", format: "markdown", pattern: "**/*.md" }),
    collection({ id: "docs", path: "src/content/docs", format: "mdx", pattern: "**/*.mdx" }),
    collection({ id: "both", path: "src/content/both", format: "markdown", pattern: "**/*.{md,mdx}" }),
    collection({ id: "loose", path: "src/content/loose", format: "markdown" }), // no pattern: default admits md, mdx, markdown
    collection({ id: "site", kind: "data", path: "src/data/site.json", format: "json" }),
  ],
  redirects: { file: "src/data/redirects.json" } as SiteModel["redirects"],
});

const hugo = model({ framework: { id: "hugo", name: "Hugo" }, collections: [collection({ id: "posts", path: "content/posts", pattern: "**/*.{md,mdx,markdown}" })] });

const genericStatic = model({ framework: { id: "generic", name: "Static site" }, dev: { command: "" } as SiteModel["dev"], build: null, collections: [collection({ id: "root", path: ".", pattern: "**/*.{md,mdx,markdown}" })] });

const genericBuilt = model({ framework: { id: "generic", name: "Static site" }, build: { command: "node build.mjs", outDir: "dist" }, collections: [collection({ id: "root", path: ".", pattern: "**/*.{md,mdx,markdown}" })] });

const asContributor = (run: () => unknown) => withCaller({ accountId: "c", role: "contributor" }, run);

interface Row {
  name: string;
  site: SiteModel;
  path: string;
  allowed: boolean;
}

const TABLE: Row[] = [
  // Astro: Markdown inert, MDX guarded, decided per file even in a mixed or pattern-less collection.
  { name: "astro .md entry", site: astro, path: "src/content/pages/post.md", allowed: true },
  { name: "astro .mdx entry", site: astro, path: "src/content/docs/post.mdx", allowed: false },
  { name: "astro .md in a {md,mdx} collection", site: astro, path: "src/content/both/post.md", allowed: true },
  { name: "astro .mdx in a {md,mdx} collection", site: astro, path: "src/content/both/post.mdx", allowed: false },
  { name: "astro .mdx in a pattern-less markdown collection", site: astro, path: "src/content/loose/post.mdx", allowed: false },
  { name: "astro .md in a pattern-less markdown collection", site: astro, path: "src/content/loose/post.md", allowed: true },
  { name: "astro data file", site: astro, path: "src/data/site.json", allowed: true },
  { name: "astro media beside an entry", site: astro, path: "src/content/pages/photo.png", allowed: true },
  { name: "astro media under the media root", site: astro, path: "public/hero.jpg", allowed: true },
  { name: "astro non-media under the media root", site: astro, path: "public/evil.js", allowed: false },
  { name: "astro the redirects list", site: astro, path: "src/data/redirects.json", allowed: true },
  { name: "astro a layout (site source)", site: astro, path: "src/layouts/Base.astro", allowed: false },
  { name: "astro an upper-case extension", site: astro, path: "src/content/pages/README.MD", allowed: false },
  { name: "astro a name the pattern excludes", site: astro, path: "src/content/pages/data.txt", allowed: false },
  // Hugo and every other detected framework: content guarded whole, whatever the pattern admits.
  { name: "hugo .md entry", site: hugo, path: "content/posts/post.md", allowed: false },
  { name: "hugo .mdx entry", site: hugo, path: "content/posts/post.mdx", allowed: false },
  { name: "hugo media beside an entry", site: hugo, path: "content/posts/photo.png", allowed: true },
  // generic: Markdown inert only when nothing runs over it.
  { name: "generic .md at the root, no command", site: genericStatic, path: "index.md", allowed: true },
  { name: "generic .md at the root, with a build command", site: genericBuilt, path: "index.md", allowed: false },
  { name: "generic a config file at the root (the ** hole)", site: genericStatic, path: "galley.config.json", allowed: false },
  { name: "generic package.json at the root", site: genericStatic, path: "package.json", allowed: false },
  { name: "generic a script at the root", site: genericStatic, path: "build.mjs", allowed: false },
  { name: "generic media at the root", site: genericStatic, path: "logo.svg", allowed: true },
];

describe("the content-code allowlist, for an account below build level", () => {
  for (const row of TABLE) {
    it(`${row.allowed ? "lets a contributor write" : "refuses a contributor"}: ${row.name}`, () => {
      const refusal = asContributor(() => contentWriteRefusal(row.path, row.site));

      if (row.allowed) expect(refusal, row.name).toBeNull();
      else expect(refusal, row.name).toMatch(/build mode/);
    });
  }
});

describe("the content-code guard, by level only", () => {
  it("lets an owner, an editor and nobody write every row — the one question is the account's level", () => {
    for (const row of TABLE) {
      expect(withCaller({ accountId: "o", role: "owner" }, () => contentWriteRefusal(row.path, row.site)), `owner ${row.name}`).toBeNull();
      expect(withCaller({ accountId: "e", role: "editor" }, () => contentWriteRefusal(row.path, row.site)), `editor ${row.name}`).toBeNull();
      // Nobody: local and desktop, where there is no caller, are unaffected.
      expect(contentWriteRefusal(row.path, row.site), `nobody ${row.name}`).toBeNull();
    }
  });

  it("does not look at the conversation's mode or whether the site allows build mode", () => {
    // A guarded entry on a site with build mode off: an owner (build level) still may; a contributor still may not.
    const buildOff = model({ ...astro, ai: { allowBuild: false } as SiteModel["ai"] });

    expect(withCaller({ accountId: "o", role: "owner" }, () => contentWriteRefusal("src/content/docs/post.mdx", buildOff))).toBeNull();
    expect(asContributor(() => contentWriteRefusal("src/content/docs/post.mdx", buildOff))).toMatch(/build mode/);
  });
});

describe("a write marked as the previewed page's (an overlay message) is held to the allowlist, whoever is signed in", () => {
  // The page shares the overlay's origin, so a script a contributor put in the content could ask the app to save as an
  // owner who is editing on the preview. Such a save (click to edit, Arrange) is marked; the server holds it to the
  // allowlist whoever is signed in, build level included, and the result still waits in Proof.
  const markedOwner = (path: string, site: SiteModel) => withCaller({ accountId: "o", role: "owner", viaPreview: true }, () => contentWriteRefusal(path, site));

  it("lets a marked save write only what a contributor could, even for an owner", () => {
    // Astro Markdown: allowed, as for a contributor.
    expect(markedOwner("src/content/pages/post.md", astro)).toBeNull();
    // MDX: refused, though the owner could write it from the app's own interface.
    expect(markedOwner("src/content/docs/post.mdx", astro)).toMatch(/build mode/);
    // A detected framework's content (a template collection): refused.
    expect(markedOwner("content/posts/post.md", hugo)).toMatch(/build mode/);
    // The site's own source: refused.
    expect(markedOwner("src/layouts/Base.astro", astro)).toMatch(/build mode/);
  });

  it("leaves an unmarked owner save at the owner's level", () => {
    expect(withCaller({ accountId: "o", role: "owner" }, () => contentWriteRefusal("src/content/docs/post.mdx", astro))).toBeNull();
  });
});

describe("an owner's `plain` declaration makes a collection's Markdown inert on any framework", () => {
  const hugoPlain = model({ framework: { id: "hugo", name: "Hugo" }, collections: [collection({ id: "posts", path: "content/posts", pattern: "**/*.{md,mdx,markdown}", plain: true })] });
  // A generic site that runs a build command (the fallback, guarded by default), with and without the declaration.
  const builtGuarded = model({ framework: { id: "generic", name: "Static site" }, build: { command: "node build.mjs", outDir: "dist" }, collections: [collection({ id: "root", path: ".", pattern: "**/*.{md,mdx,markdown}" })] });
  const builtPlain = model({ framework: { id: "generic", name: "Static site" }, build: { command: "node build.mjs", outDir: "dist" }, collections: [collection({ id: "root", path: ".", pattern: "**/*.{md,mdx,markdown}", plain: true })] });

  it("lets a contributor write the collection's Markdown, but never its MDX", () => {
    expect(asContributor(() => contentWriteRefusal("content/posts/post.md", hugoPlain))).toBeNull();
    expect(asContributor(() => contentWriteRefusal("content/posts/post.mdx", hugoPlain))).toMatch(/build mode/);
  });

  it("flips a guarded generic+command collection: declared plain, its Markdown is writable; undeclared, it is refused", () => {
    expect(asContributor(() => contentWriteRefusal("index.md", builtPlain))).toBeNull();
    expect(asContributor(() => contentWriteRefusal("index.md", builtGuarded))).toMatch(/build mode/);
  });
});

describe("a .mdoc (Markdoc) entry is guarded, though the document parser reads it as Markdown", () => {
  // The parser reads .mdoc as Markdown, but the extension is not one of the inert Markdown extensions, and Markdoc runs
  // its own tags — so below build level it is guarded, even in a collection whose pattern admits it.
  const astroMarkdoc = model({ collections: [collection({ id: "kb", path: "src/content/kb", format: "markdown", pattern: "**/*.{md,mdoc}" })] });

  it("refuses a contributor a .mdoc on Astro, but allows the same collection's .md", () => {
    expect(asContributor(() => contentWriteRefusal("src/content/kb/page.md", astroMarkdoc))).toBeNull();
    expect(asContributor(() => contentWriteRefusal("src/content/kb/page.mdoc", astroMarkdoc))).toMatch(/build mode/);
  });

  it("stays guarded even when the collection is declared plain (plain is Markdown only)", () => {
    const plainMarkdoc = model({ framework: { id: "hugo", name: "Hugo" }, collections: [collection({ id: "kb", path: "content/kb", format: "markdown", pattern: "**/*.{md,mdoc}", plain: true })] });

    expect(asContributor(() => contentWriteRefusal("content/kb/page.md", plainMarkdoc))).toBeNull();
    expect(asContributor(() => contentWriteRefusal("content/kb/page.mdoc", plainMarkdoc))).toMatch(/build mode/);
  });
});

describe("a file the build runs as a module is build level on Astro", () => {
  const astroYaml = model({ collections: [collection({ id: "nav", kind: "data", path: "src/data/nav.yaml", format: "yaml" })] });
  const astroNoExt = model({ collections: [collection({ id: "nav", kind: "data", path: "src/data/nav", format: "yaml" })] });
  const hugoYaml = model({ framework: { id: "hugo", name: "Hugo" }, collections: [collection({ id: "nav", kind: "data", path: "data/nav.yaml", format: "yaml" })] });

  it("refuses a contributor a yaml/toml/extensionless file on Astro (Vite runs it), but a framework that reads it as data does not", () => {
    expect(asContributor(() => contentWriteRefusal("src/data/nav.yaml", astroYaml))).toMatch(/build mode/);
    expect(asContributor(() => contentWriteRefusal("src/data/nav", astroNoExt))).toMatch(/build mode/);
    expect(asContributor(() => contentWriteRefusal("data/nav.yaml", hugoYaml))).toBeNull();
    // JSON stays writable on Astro — it is parsed as JSON, not run.
    expect(asContributor(() => contentWriteRefusal("src/data/site.json", astro))).toBeNull();
  });
});

describe("the layout guard on Astro (ruling 4ii)", () => {
  const withLayout = "---\ntitle: T\nlayout: ../../layouts/Base.astro\n---\nBody.\n";
  const noLayout = "---\ntitle: T\n---\nBody.\n";
  const other = "---\ntitle: T\nlayout: ../../layouts/Other.astro\n---\nBody.\n";

  it("refuses a contributor adding or changing a Markdown entry's layout, and lets them keep or remove it", () => {
    expect(asContributor(() => layoutRefusal(noLayout, withLayout, "markdown"))).toMatch(/build mode/);
    expect(asContributor(() => layoutRefusal(withLayout, other, "markdown"))).toMatch(/build mode/);
    // Editing prose while keeping the layout, or removing it, is fine.
    expect(asContributor(() => layoutRefusal(withLayout, withLayout.replace("Body.", "New body."), "markdown"))).toBeNull();
    expect(asContributor(() => layoutRefusal(withLayout, noLayout, "markdown"))).toBeNull();
  });

  it("does not restrict an owner, or nobody (local)", () => {
    expect(withCaller({ accountId: "o", role: "owner" }, () => layoutRefusal(noLayout, withLayout, "markdown"))).toBeNull();
    expect(layoutRefusal(noLayout, withLayout, "markdown")).toBeNull();
  });
});
