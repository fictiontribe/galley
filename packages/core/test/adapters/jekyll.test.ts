import { afterAll, describe, expect, it } from "vitest";

import { checkAdapter } from "../../../adapter-kit/src/index";
import { detectWithAdapters, jekyllAdapter } from "../../src/adapter/index";
import { detectSite } from "../../src/content/index";
import { cleanup, entries, site } from "../adapter/helpers";

afterAll(cleanup);

const urls = (collections: Array<{ id: string; url: string | null }>) =>
  Object.fromEntries(collections.map((collection) => [collection.id, collection.url]));

describe("jekyllAdapter detection", () => {
  it("detects _config.yml with _posts, _drafts, _layouts, or Gemfile, and ignores unrelated _config.yml", async () => {
    const withGem = await detectWithAdapters(site({ "_config.yml": "title: Blog\n", Gemfile: 'gem "jekyll", "~> 4.3"\n' }));
    const withPosts = await detectWithAdapters(site({ "_config.yml": "title: Blog\n", ...entries("_posts") }));
    const withDrafts = await detectWithAdapters(site({ "_config.yaml": "title: Blog\n", ...entries("_drafts") }));
    const withLayouts = await detectWithAdapters(site({ "_config.yml": "title: Blog\n", "_layouts/default.html": "" }));
    const customSource = await detectWithAdapters(site({ "_config.yml": "source: docs\n", ...entries("docs/_posts") }));
    const alone = await detectWithAdapters(site({ "_config.yml": "title: Not Jekyll\n" }));

    expect(withGem.adapter.id).toBe("jekyll");
    expect(withGem.match.confidence).toBe(0.9);
    expect(withPosts.adapter.id).toBe("jekyll");
    expect(withPosts.match.confidence).toBe(0.8);
    expect(withDrafts.adapter.id).toBe("jekyll");
    expect(withLayouts.adapter.id).toBe("jekyll");
    expect(customSource.adapter.id).toBe("jekyll");
    expect(alone.adapter.id).toBe("generic");
  });
});

describe("jekyllAdapter config reading", () => {
  it("reads custom source, destination, collections_dir, collections (output true/false & custom permalink), _drafts, exclude, and _data", async () => {
    const root = site({
      "_config.yml": `
        url: https://kitchen-notes.org
        baseurl: /handbook
        source: src
        destination: build-site
        collections_dir: collections
        data_dir: _data
        layouts_dir: _templates
        includes_dir: _partials
        exclude:
          - scratch
        collections:
          recipes:
            output: true
            permalink: /recipes/:name/
          guides:
            output: true
          authors:
            output: false
      `,
      Gemfile: 'gem "jekyll"\n',
      "src/_templates/default.md": "---\ntitle: Ignored layout\n---\n",
      "src/_templates/post.md": "---\ntitle: Ignored layout 2\n---\n",
      "src/_partials/nav.md": "---\ntitle: Ignored partial\n---\n",
      "src/_partials/foot.md": "---\ntitle: Ignored partial 2\n---\n",
      "src/scratch/a.md": "---\ntitle: Excluded 1\n---\n",
      "src/scratch/b.md": "---\ntitle: Excluded 2\n---\n",
      "src/index.md": "---\ntitle: Home\n---\nWelcome.\n",
      "src/about.md": "---\ntitle: About\n---\nAbout.\n",
      "src/collections/_posts/2026-05-01-sourdough.md": "---\ntitle: Sourdough\n---\nPost 1.\n",
      "src/collections/_posts/2026-05-02-rye.md": "---\ntitle: Rye\n---\nPost 2.\n",
      "src/collections/_drafts/upcoming.md": "---\ntitle: Upcoming\n---\nDraft.\n",
      ...entries("src/collections/_recipes"),
      ...entries("src/collections/_guides"),
      ...entries("src/collections/_authors"),
      "src/_data/navigation.yml": "items:\n  - title: Home\n",
      "src/_data/hours.json": '{"open": "8am"}\n',
    });

    const model = await detectSite(root);

    expect(model.framework.id).toBe("jekyll");
    expect(model.urls.production).toBe("https://kitchen-notes.org/handbook");
    expect(model.dev).toEqual({ command: "bundle exec jekyll serve", port: 4000 });
    expect(model.build).toEqual({ command: "bundle exec jekyll build", outDir: "build-site" });
    expect(model.collections.some((collection) => collection.path.includes("scratch") || collection.path.includes("_templates") || collection.path.includes("_partials"))).toBe(false);
    expect(urls(model.collections)).toEqual({
      posts: null,
      drafts: null,
      recipes: "/handbook/recipes/{slug}/",
      guides: "/handbook/guides/{slug}/",
      authors: null,
      pages: "/handbook/{slug}/",
      hours: null,
      navigation: null,
    });
    expect(model.notes.some((note) => note.includes("date-based"))).toBe(true);

    const report = await checkAdapter(jekyllAdapter, root, {
      collections: [
        { id: "posts", minEntries: 2, url: null },
        { id: "drafts", minEntries: 1, url: null },
        { id: "recipes", minEntries: 2, url: "/handbook/recipes/{slug}/" },
        { id: "guides", minEntries: 2, url: "/handbook/guides/{slug}/" },
        { id: "authors", minEntries: 2, url: null },
        { id: "pages", minEntries: 2, url: "/handbook/{slug}/" },
        { id: "navigation", url: null },
        { id: "hours", url: null },
      ],
      dev: { command: "bundle exec jekyll serve", port: 4000 },
    });

    expect(report.checks.filter((check) => check.status === "fail")).toEqual([]);
    expect(report.ok).toBe(true);
  });

  it("maps _posts to /{slug}/ or /blog/{slug}/ when _config.yml sets a slug-only permalink, and handles array collections", async () => {
    const rootTitle = site({
      "_config.yml": `
        url: https://notes.org
        permalink: /:title/
        collections:
          - snippets
      `,
      "_posts/2026-01-01-first-note.md": "---\ntitle: First Note\n---\nOne.\n",
      "_posts/2026-01-02-second-note.md": "---\ntitle: Second Note\n---\nTwo.\n",
      ...entries("_snippets"),
      "_data/site.yaml": "title: Notes\n",
    });

    const modelTitle = await detectSite(rootTitle);

    expect(modelTitle.urls.production).toBe("https://notes.org");
    expect(urls(modelTitle.collections)).toEqual({
      posts: "/{slug}/",
      snippets: null,
      site: null,
    });

    const rootBlog = site({
      "_config.yml": `
        permalink: /blog/:title:output_ext
      `,
      "_posts/2026-03-01-spring.md": "---\ntitle: Spring\n---\nSpring.\n",
      "_posts/2026-03-02-summer.md": "---\ntitle: Summer\n---\nSummer.\n",
      "about.md": "---\ntitle: About\n---\nAbout.\n",
      "contact.md": "---\ntitle: Contact\n---\nContact.\n",
    });

    const modelBlog = await detectSite(rootBlog);

    expect(urls(modelBlog.collections)).toEqual({
      posts: "/blog/{slug}/",
      pages: "/{slug}/",
    });

    const report = await checkAdapter(jekyllAdapter, rootBlog, {
      collections: [
        { id: "posts", minEntries: 2, url: "/blog/{slug}/" },
        { id: "pages", minEntries: 2, url: "/{slug}/" },
      ],
    });

    expect(report.checks.filter((check) => check.status === "fail")).toEqual([]);
    expect(report.ok).toBe(true);
  });

  it("keeps _posts route null when permalink uses date tokens explicitly", async () => {
    const root = site({
      "_config.yml": `
        permalink: /:year/:month/:day/:title/
      `,
      "_posts/2026-06-01-alpha.md": "---\ntitle: Alpha\n---\nAlpha.\n",
      "_posts/2026-06-02-beta.md": "---\ntitle: Beta\n---\nBeta.\n",
    });
    const model = await detectSite(root);

    expect(urls(model.collections)).toEqual({ posts: null });
    expect(model.notes.some((note) => note.includes("date-based"))).toBe(true);
  });
});
