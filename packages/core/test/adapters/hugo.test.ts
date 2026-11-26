import { fileURLToPath } from "node:url";

import { afterAll, describe, expect, it } from "vitest";

import { checkAdapter } from "../../../adapter-kit/src/index";
import { detectWithAdapters, hugoAdapter } from "../../src/adapter/index";
import { detectSite } from "../../src/content/index";
import { cleanup, entries, site } from "../adapter/helpers";

afterAll(cleanup);

const HUGO_FIXTURE = fileURLToPath(new URL("../fixtures/hugo-site", import.meta.url));
const urls = (collections: Array<{ id: string; url: string | null }>) =>
  Object.fromEntries(collections.map((collection) => [collection.id, collection.url]));

describe("hugoAdapter detection", () => {
  it("scores hugo.toml with dirs/go.mod (0.95), hugo.toml alone (0.85), split config (0.85), and legacy config.toml + content (0.7)", async () => {
    const withDirs = await detectWithAdapters(site({ "hugo.toml": 'title = "T"\n', "layouts/index.html": "" }));
    const withGoMod = await detectWithAdapters(site({ "hugo.yaml": "title: T\n", "go.mod": "module example.com/site\nrequire github.com/gohugoio/hugo-mod v0.1.0\n" }));
    const bareHugo = await detectWithAdapters(site({ "hugo.json": '{"title":"T"}' }));
    const split = await detectWithAdapters(site({ "config/_default/hugo.toml": 'title = "T"\n' }));
    const legacy = await detectWithAdapters(site({ "config.toml": 'title = "T"\n', ...entries("content/posts") }));
    const randomConfig = await detectWithAdapters(site({ "config.toml": 'name = "tool"\n' }));

    expect(withDirs.adapter.id).toBe("hugo");
    expect(withDirs.match.confidence).toBe(0.95);
    expect(withGoMod.adapter.id).toBe("hugo");
    expect(withGoMod.match.confidence).toBe(0.95);
    expect(bareHugo.adapter.id).toBe("hugo");
    expect(bareHugo.match.confidence).toBe(0.85);
    expect(split.adapter.id).toBe("hugo");
    expect(split.match.confidence).toBe(0.85);
    expect(legacy.adapter.id).toBe("hugo");
    expect(legacy.match.confidence).toBe(0.7);
    expect(randomConfig.adapter.id).toBe("generic");
  });
});

describe("hugoAdapter config reading", () => {
  it("reads hugo.toml, custom dirs, multiple staticDirs, uglyURLs, and [permalinks] (slug-based & date-based)", async () => {
    const root = site({
      "hugo.toml": `
        baseURL = "https://field-guide.org/"
        contentDir = "docs-content"
        publishDir = "dist-hugo"
        staticDir = ["static", "shared-static"]
        dataDir = "site-data"
        archetypeDir = "blueprints"
        uglyURLs = true

        [permalinks]
          posts = "/blog/:slug/"
          guides = "/:sections/:filename/"
          news = "/:year/:month/:day/:slug/"
      `,
      "layouts/_default/single.html": "",
      "static/images/cover.png": "",
      "shared-static/logo.svg": "<svg/>",
      "blueprints/default.md": "---\ntitle: Blueprint 1\n---\n",
      "blueprints/post.md": "---\ntitle: Blueprint 2\n---\n",
      "site-data/nav.yaml": "links:\n  - label: Home\n",
      "docs-content/_index.md": "---\ntitle: Home\n---\nWelcome.\n",
      "docs-content/about.md": "---\ntitle: About\n---\nAbout.\n",
      ...entries("docs-content/posts"),
      ...entries("docs-content/guides"),
      ...entries("docs-content/news"),
      ...entries("docs-content/notes"),
    });

    const model = await detectSite(root);

    expect(model.framework.id).toBe("hugo");
    expect(model.urls.production).toBe("https://field-guide.org");
    expect(model.build).toEqual({ command: "hugo", outDir: "dist-hugo" });
    expect(model.dev).toEqual({ command: "hugo server", port: 1313 });
    expect(model.media.dir).toBe("static/images");
    expect(model.media.roots).toEqual([
      { dir: "static/images", publicPath: "/images" },
      { dir: "static", publicPath: "/" },
      { dir: "shared-static", publicPath: "/" },
    ]);
    // archetypeDir ("blueprints") must not appear as a content collection.
    expect(model.collections.some((collection) => collection.path.startsWith("blueprints"))).toBe(false);
    expect(urls(model.collections)).toEqual({
      pages: "/{slug}",
      posts: "/blog/{slug}",
      guides: "/guides/{slug}",
      news: null,
      notes: "/notes/{slug}",
      nav: null,
    });
    expect(model.notes.some((note) => note.includes("date tokens"))).toBe(true);

    const report = await checkAdapter(hugoAdapter, root, {
      collections: [
        { id: "pages", minEntries: 2, url: "/{slug}" },
        { id: "posts", minEntries: 2, url: "/blog/{slug}" },
        { id: "guides", minEntries: 2, url: "/guides/{slug}" },
        { id: "news", minEntries: 2, url: null },
        { id: "notes", minEntries: 2, url: "/notes/{slug}" },
        { id: "nav", url: null },
      ],
      dev: { command: "hugo server", port: 1313 },
    });

    expect(report.checks.filter((check) => check.status === "fail")).toEqual([]);
    expect(report.ok).toBe(true);
  });

  it("merges config/_default/ split config with multilingual contentDirs and permalinks", async () => {
    const root = site({
      "config/_default/hugo.yaml": `
        baseURL: https://multilingual.org/
        defaultContentLanguage: en
        publishDir: build-out
      `,
      "config/_default/permalinks.yaml": `
        page:
          posts: /journal/:contentbasename/
      `,
      "config/_default/languages.yaml": `
        en:
          weight: 1
          contentDir: content/en
        fr:
          weight: 2
          contentDir: content/fr
          permalinks:
            posts: /articles/:slug/
      `,
      "content/en/_index.md": "---\ntitle: Home\n---\nEN home.\n",
      "content/en/about.md": "---\ntitle: About\n---\nEN about.\n",
      ...entries("content/en/posts"),
      "content/fr/_index.md": "---\ntitle: Accueil\n---\nFR home.\n",
      "content/fr/a-propos.md": "---\ntitle: A propos\n---\nFR about.\n",
      ...entries("content/fr/posts"),
      "data/site.json": '{"name": "Multi"}\n',
    });

    const model = await detectSite(root);

    expect(model.framework.id).toBe("hugo");
    expect(model.urls.production).toBe("https://multilingual.org");
    expect(model.build).toEqual({ command: "hugo", outDir: "build-out" });
    expect(urls(model.collections)).toEqual({
      pages: "/{slug}/",
      posts: "/journal/{slug}/",
      "content-fr": "/fr/{slug}/",
      "content-fr-posts": "/fr/articles/{slug}/",
      site: null,
    });

    const report = await checkAdapter(hugoAdapter, root, {
      collections: [
        { id: "pages", minEntries: 2, url: "/{slug}/" },
        { id: "posts", minEntries: 2, url: "/journal/{slug}/" },
        { id: "content-fr", minEntries: 2, url: "/fr/{slug}/" },
        { id: "content-fr-posts", minEntries: 2, url: "/fr/articles/{slug}/" },
        { id: "site", url: null },
      ],
    });

    expect(report.checks.filter((check) => check.status === "fail")).toEqual([]);
    expect(report.ok).toBe(true);
  });

  it("passes checkAdapter on the core hugo-site fixture", async () => {
    const report = await checkAdapter(hugoAdapter, HUGO_FIXTURE, {
      collections: [
        { id: "pages", minEntries: 2, url: "/{slug}/" },
        { id: "posts", minEntries: 3, url: "/posts/{slug}/" },
        { id: "menu", url: null },
      ],
      dev: { command: "hugo server", port: 1313 },
    });

    expect(report.checks.filter((check) => check.status === "fail")).toEqual([]);
    expect(report.ok).toBe(true);
  });
});
