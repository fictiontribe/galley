import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterAll, describe, expect, it } from "vitest";

import { astroAdapter, docusaurusAdapter, hugoAdapter, nextAdapter, nuxtAdapter, sveltekitAdapter } from "@galley/core/adapter";
import { CHECKS, checkAdapter, conventionAdapter, defineAdapter, formatReport, type AdapterReport, type GalleyAdapter } from "../src/index";

const CORE_FIXTURES = fileURLToPath(new URL("../../core/test/fixtures/", import.meta.url));
const STARTER = fileURLToPath(new URL("../../../starters/astro-starter", import.meta.url));
const made: string[] = [];

afterAll(() => {
  for (const dir of made) rmSync(dir, { recursive: true, force: true });
});

function fixture(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), "kit-fixture-"));

  made.push(root);
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  }
  return root;
}

const status = (report: AdapterReport, id: string) => report.checks.find((check) => check.id === id);
const failed = (report: AdapterReport) => report.checks.filter((check) => check.status === "fail").map((check) => check.id);

/** A tidy little site of an invented framework, "quay", and a correct adapter for it. */
const QUAY_SITE = {
  "quay.toml": 'title = "Quay"\n',
  "package.json": JSON.stringify({ scripts: { dev: "quay serve --port 7000", build: "quay build" }, dependencies: { quay: "^1.2.0" } }),
  "content/posts/a.md": "---\ntitle: A\n---\nA.\n",
  "content/posts/b.md": "---\ntitle: B\n---\nB.\n",
  "data/menu.json": '{ "links": [] }\n',
};
const quay = conventionAdapter({ id: "quay", name: "Quay", packages: ["quay"], files: ["quay.toml"], build: { outDir: "out" }, contentDirs: ["content"], dataDirs: ["data"] });

describe("checkAdapter on a correct adapter", () => {
  it("passes every check and reports the model", async () => {
    const report = await checkAdapter(quay, fixture(QUAY_SITE), { collections: [{ id: "posts", minEntries: 2, url: "/posts/{slug}/", fields: ["title"] }], dev: { command: "npm run dev", port: 7000 } });

    expect(failed(report)).toEqual([]);
    expect(report.ok).toBe(true);
    expect(report.checks.map((check) => check.id)).toEqual(CHECKS.map((check) => check.id));
    expect(report.model.framework.id).toBe("quay");
    expect(formatReport(report)).toMatch(/All 18 checks passed\.$/);
  });

  it("leaves the expectations check out when there are none", async () => {
    const report = await checkAdapter(quay, fixture(QUAY_SITE));

    expect(report.checks.some((check) => check.id === "expectations")).toBe(false);
  });
});

describe("checkAdapter catches the mistakes adapters make", () => {
  it("claiming every site", async () => {
    const greedy = defineAdapter({ id: "greedy", name: "Greedy", detect: () => ({ confidence: 0.9 }) });
    const report = await checkAdapter(greedy, fixture(QUAY_SITE));

    expect(status(report, "detect-foreign")).toMatchObject({ status: "fail", detail: expect.stringMatching(/claimed a plain folder of markdown notes \(plain-markdown\) with confidence 0\.9.*Return null unless/) });
    expect(status(report, "detect-empty")).toMatchObject({ status: "fail", detail: expect.stringMatching(/claimed an empty folder/) });
  });

  it("throwing on a site without package.json", async () => {
    const careless = defineAdapter({ id: "careless", name: "Careless", detect: (ctx) => (Object.keys(ctx.packageJson!.dependencies!).includes("quay") ? { confidence: 0.9 } : null) });
    const report = await checkAdapter(careless, fixture(QUAY_SITE));

    expect(status(report, "detect-own")?.status).toBe("pass");
    expect(status(report, "detect-empty")).toMatchObject({ status: "fail", detail: expect.stringMatching(/^On an empty folder its detect step failed \(.+\)\. Treat every file as possibly missing/) });
    expect(status(report, "detect-foreign")?.status).toBe("fail");
  });

  it("not recognising its own fixture, or losing it to a built-in", async () => {
    const blind = await checkAdapter(defineAdapter({ id: "blind", name: "Blind", detect: () => null }), fixture(QUAY_SITE));
    const timid = await checkAdapter(defineAdapter({ id: "timid", name: "Timid", detect: (ctx) => (ctx.exists("astro.config.mjs") ? { confidence: 0.5 } : null) }), `${CORE_FIXTURES}astro-site`);

    expect(status(blind, "detect-own")?.detail).toMatch(/returned null for its own fixture/);
    expect(status(timid, "selected")).toMatchObject({ status: "fail", detail: expect.stringMatching(/The built-in Astro adapter was chosen for the fixture \(confidence 0\.95\) instead of the Timid adapter \(0\.5\)/) });
  });

  it("hooks that throw, missing paths, wrong formats and duplicate ids", async () => {
    const root = fixture({ ...QUAY_SITE, "content/settings/a.yaml": "title: A\n", "content/settings/b.yaml": "title: [broken\n" });
    const sloppy = defineAdapter({
      id: "sloppy",
      name: "Sloppy",
      detect: (ctx) => (ctx.exists("quay.toml") ? { confidence: 0.9 } : null),
      conventions: () => ({ dev: { command: "quay serve" }, build: { command: "quay build" } }),
      collections: () => [
        { id: "posts", path: "content/posts" },
        { id: "posts", path: "content/posts", pattern: "a.md" },
        { id: "gone", path: "content/gone" },
        { id: "settings", path: "content/settings", format: "yaml", pattern: "*.yaml" },
      ],
      routes: () => {
        throw new Error("routes not written yet");
      },
    });
    const report = await checkAdapter(sloppy, root);

    expect(status(report, "hooks")?.detail).toMatch(/routes step failed \(routes not written yet\)/);
    expect(status(report, "ids")?.detail).toMatch(/“posts” is used by more than one collection, so the engine renamed the later ones \(posts-2\)/);
    expect(status(report, "paths")?.detail).toMatch(/“Gone” \(gone\) points at content\/gone, which does not exist/);
    expect(status(report, "parse")?.detail).toMatch(/content\/settings\/b\.yaml: The file could not be read/);
  });

  it("URL patterns that are malformed or give two entries one address", async () => {
    const report = await checkAdapter(
      defineAdapter({ id: "urls", name: "Urls", detect: (ctx) => (ctx.exists("quay.toml") ? { confidence: 0.9 } : null), conventions: () => ({ contentDirs: ["content"] }), routes: () => ({ posts: "/posts/" }) }),
      fixture(QUAY_SITE)
    );

    expect(status(report, "urls")?.detail).toMatch(/has the URL pattern “\/posts\/”, which should contain \{slug\} exactly once.*both get the address \/posts\//);
  });

  it("entries that cannot be edited and restored", async () => {
    // A value written once and reused (a YAML anchor) cannot be changed in place without changing its twin.
    const root = fixture({ ...QUAY_SITE, "content/posts/a.md": "---\ntitle: &t Harbour\nheading: *t\n---\nA.\n" });
    const report = await checkAdapter(quay, root);

    expect(status(report, "round-trip")).toMatchObject({ status: "fail", detail: expect.stringMatching(/^content\/posts\/a\.md: changing “title” was refused \(This value is shared with another part of the file.*\), so an editor could not change it from the form either\.$/) });
  });

  it("answers that change between runs", async () => {
    let calls = 0;
    const fickle = defineAdapter({
      id: "fickle",
      name: "Fickle",
      detect: (ctx) => (ctx.exists("quay.toml") ? { confidence: 0.9 } : null),
      collections: () => [{ id: `posts-${(calls += 1) % 2 === 0 ? "even" : "odd"}`, path: "content/posts" }],
    });
    const report = await checkAdapter(fickle, fixture(QUAY_SITE));

    expect(status(report, "ids")?.detail).toMatch(/changed between two runs/);
    expect(status(report, "stable")?.status).toBe("fail");
  });

  it("writing to the fixture", async () => {
    const root = fixture(QUAY_SITE);
    const writer = defineAdapter({
      id: "writer",
      name: "Writer",
      detect: (ctx) => {
        if (!ctx.exists("quay.toml")) return null;
        writeFileSync(join(ctx.root, "cache.json"), "{}");
        return { confidence: 0.9 };
      },
    });
    const report = await checkAdapter(writer, root);

    expect(status(report, "read-only")).toMatchObject({ status: "fail", detail: expect.stringMatching(/^cache\.json was created, changed or removed/) });
  });

  it("a slow detect, and no way to run the site", async () => {
    const slow = defineAdapter({
      id: "slow",
      name: "Slow",
      detect: async (ctx) => {
        await new Promise((done) => setTimeout(done, 150));
        return ctx.exists("quay.toml") ? { confidence: 0.9 } : null;
      },
    });
    const report = await checkAdapter(slow, fixture({ "quay.toml": "", ...Object.fromEntries(Object.entries(QUAY_SITE).filter(([path]) => path.startsWith("content/"))) }));

    expect(status(report, "detect-fast")).toMatchObject({ status: "warn", detail: expect.stringMatching(/^detect\(\) took \d+ ms; under 100 ms is the aim/) });
    expect(status(report, "commands")).toMatchObject({ status: "warn", detail: expect.stringMatching(/no dev command and no build command, so previews will be unavailable/) });
    expect(report.ok).toBe(true);
  });

  it("a list of what the site is built from that leaves its own content out", async () => {
    // The list names the templates' folder and the configuration, and forgets where the posts and the data are.
    const forgetful = conventionAdapter({ id: "quay", name: "Quay", packages: ["quay"], files: ["quay.toml"], build: { outDir: "out" }, contentDirs: ["content"], dataDirs: ["data"], builtFrom: ["layouts/**", "quay.toml"] });
    const report = await checkAdapter(forgetful, fixture(QUAY_SITE));

    expect(failed(report)).toEqual(["built-from"]);
    // The posts, the data file, and the folder served as it is (where media goes).
    expect(status(report, "built-from")?.detail).toMatch(/leaves out content\/posts; data\/menu\.json; public\/images: those are content, media or routes the built site reads/);
    // With the content in it, it passes and says what the list is; a list that isn't globs inside the site is not used at all.
    const whole = conventionAdapter({ id: "quay", name: "Quay", packages: ["quay"], files: ["quay.toml"], build: { outDir: "out" }, contentDirs: ["content"], dataDirs: ["data"], builtFrom: ["content/**", "data/**", "layouts/**", "public/**", "quay.toml"] });
    const good = await checkAdapter(whole, fixture(QUAY_SITE));

    expect(status(good, "built-from")?.detail).toBe("content/**, data/**, layouts/**, public/**, quay.toml");
    expect(failed(good)).toEqual([]);
    expect(good.model.builtFrom).toEqual(["content/**", "data/**", "layouts/**", "public/**", "quay.toml"]);
    const outside = conventionAdapter({ id: "quay", name: "Quay", packages: ["quay"], files: ["quay.toml"], build: { outDir: "out" }, contentDirs: ["content"], dataDirs: ["data"], builtFrom: ["../elsewhere/**"] });
    const refused = await checkAdapter(outside, fixture(QUAY_SITE));

    expect(refused.model.builtFrom).toBeUndefined();
    expect(refused.model.notes.join("\n")).toMatch(/“builtFrom” was not a list of globs inside the site/);
  });

  it("expectations that are not met", async () => {
    const report = await checkAdapter(quay, fixture(QUAY_SITE), { collections: [{ id: "posts", minEntries: 5, url: "/blog/{slug}/", fields: ["summary"] }, { id: "authors" }], dev: { port: 4000 } });

    expect(status(report, "expectations")?.detail).toBe(
      "“posts” has 2 entries, expected at least 5; “posts” has the URL pattern \"/posts/{slug}/\", expected \"/blog/{slug}/\"; “posts” has no field “summary” (it has title); no collection “authors” (found posts, menu); the dev port is 7000, expected 4000."
    );
  });

  it("something that is not an adapter at all", async () => {
    const report = await checkAdapter({ id: "half", name: "Half" } as unknown as GalleyAdapter, fixture(QUAY_SITE));

    expect(status(report, "shape")).toMatchObject({ status: "fail", detail: expect.stringMatching(/“detect” should be a function.*Nothing else can be checked/) });
    expect(report.ok).toBe(false);
  });
});

describe("the built-in adapters pass the kit", () => {
  it("Astro, on the engine's fixture and on the bundled starter", async () => {
    for (const dir of [`${CORE_FIXTURES}astro-site`, STARTER]) {
      const report = await checkAdapter(astroAdapter, dir);

      expect({ dir, failed: failed(report) }).toEqual({ dir, failed: [] });
    }
  });

  it("Hugo, whose TOML pages are read-only and say so", async () => {
    const report = await checkAdapter(hugoAdapter, `${CORE_FIXTURES}hugo-site`, { collections: [{ id: "posts", minEntries: 3, url: "/posts/{slug}/" }], dev: { command: "hugo server", port: 1313 } });

    expect(failed(report)).toEqual([]);
    expect(status(report, "round-trip")?.detail).toMatch(/3 entries edited and restored; 2 TOML files skipped\./);
  });

  it("Docusaurus, on classic preset and docs-only fixtures", async () => {
    const classic = fixture({
      "package.json": JSON.stringify({ scripts: { start: "docusaurus start", build: "docusaurus build" }, dependencies: { "@docusaurus/core": "^3.7.0" } }),
      "docusaurus.config.ts": `export default { url: "https://docs.harbour-lantern.org", baseUrl: "/", presets: [["classic", { docs: { path: "guides", routeBasePath: "guides" }, blog: { path: "blog", routeBasePath: "blog" } }]] };`,
      "guides/intro.md": "---\ntitle: Intro\n---\nHello.\n",
      "guides/setup.md": "---\ntitle: Setup\n---\nSteps.\n",
      "blog/launch.md": "---\ntitle: Launch\n---\nNews.\n",
      "blog/update.md": "---\ntitle: Update\n---\nMore news.\n",
      "data/links.json": '{ "site": "Harbour" }\n',
    });
    const docsOnly = fixture({
      "package.json": JSON.stringify({ scripts: { start: "docusaurus start", build: "docusaurus build" }, dependencies: { "@docusaurus/core": "^3.7.0" } }),
      "docusaurus.config.js": `module.exports = { url: "https://wiki.harbour-lantern.org", presets: [["classic", { docs: { routeBasePath: "/" }, blog: false }]] };`,
      "docs/welcome.md": "---\ntitle: Welcome\n---\nHi.\n",
      "docs/guide.md": "---\ntitle: Guide\n---\nDetails.\n",
    });

    const classicReport = await checkAdapter(docusaurusAdapter, classic, {
      collections: [
        { id: "docs", minEntries: 2, url: "/guides/{slug}/", fields: ["title"] },
        { id: "blog", minEntries: 2, url: "/blog/{slug}/", fields: ["title"] },
        { id: "links", url: null },
      ],
      dev: { command: "npm start", port: 3000 },
    });
    const docsOnlyReport = await checkAdapter(docusaurusAdapter, docsOnly, {
      collections: [{ id: "docs", minEntries: 2, url: "/{slug}/" }],
      dev: { command: "npm start", port: 3000 },
    });

    expect(failed(classicReport)).toEqual([]);
    expect(failed(docsOnlyReport)).toEqual([]);
  });

  it("Nuxt, on @nuxt/content v3 and conventional fixtures", async () => {
    const v3 = fixture({
      "package.json": JSON.stringify({ scripts: { dev: "nuxt dev", build: "nuxt build" }, dependencies: { nuxt: "^3.16.0", "@nuxt/content": "^3.4.0" } }),
      "nuxt.config.ts": `export default defineNuxtConfig({ devServer: { port: 3100 } });`,
      "content.config.ts": `import { defineContentConfig, defineCollection, z } from "@nuxt/content";
        export default defineContentConfig({
          collections: {
            posts: defineCollection({ type: "page", source: "posts/**/*.md", schema: z.object({ title: z.string() }) }),
            authors: defineCollection({ type: "data", source: "authors/*.json" }),
          },
        });`,
      "content/posts/first.md": "---\ntitle: First\n---\nOne.\n",
      "content/posts/second.md": "---\ntitle: Second\n---\nTwo.\n",
      "content/authors/ana.json": '{ "name": "Ana" }\n',
      "content/authors/ben.json": '{ "name": "Ben" }\n',
    });
    const conventional = fixture({
      "package.json": JSON.stringify({ scripts: { dev: "nuxt dev", build: "nuxt build" }, dependencies: { nuxt: "^3.16.0" } }),
      "nuxt.config.ts": "export default defineNuxtConfig({});",
      "content/blog/a.md": "---\ntitle: A\n---\nA.\n",
      "content/blog/b.md": "---\ntitle: B\n---\nB.\n",
    });

    const v3Report = await checkAdapter(nuxtAdapter, v3, {
      collections: [
        { id: "posts", minEntries: 2, url: "/posts/{slug}/", fields: ["title"] },
        { id: "authors", minEntries: 2, url: null },
      ],
      dev: { command: "npm run dev", port: 3100 },
    });
    const convReport = await checkAdapter(nuxtAdapter, conventional, {
      collections: [{ id: "blog", minEntries: 2, url: "/blog/{slug}/" }],
      dev: { command: "npm run dev", port: 3000 },
    });

    expect(failed(v3Report)).toEqual([]);
    expect(failed(convReport)).toEqual([]);
  });

  it("Next.js, on wrapped MDX and Velite fixtures", async () => {
    const mdxSite = fixture({
      "package.json": JSON.stringify({ scripts: { dev: "next dev", build: "next build" }, dependencies: { next: "^15.2.0", "@next/mdx": "^15.2.0" } }),
      "next.config.mjs": `import createMDX from "@next/mdx";
        const withMDX = createMDX();
        const nextConfig = { output: "export", pageExtensions: ["ts", "tsx", "mdx"] };
        export default withMDX(nextConfig);`,
      "pages/index.mdx": "---\ntitle: Home\n---\nWelcome.\n",
      "pages/about.mdx": "---\ntitle: About\n---\nAbout.\n",
      "content/posts/a.md": "---\ntitle: A\n---\nA.\n",
      "content/posts/b.md": "---\ntitle: B\n---\nB.\n",
    });
    const veliteSite = fixture({
      "package.json": JSON.stringify({ scripts: { dev: "next dev", build: "next build" }, dependencies: { next: "^15.2.0" } }),
      "next.config.ts": "export default { trailingSlash: true };",
      "velite.config.ts": `import { defineConfig, defineCollection } from "velite";
        export default defineConfig({ collections: { notes: defineCollection({ name: "Note", pattern: "notes/**/*.md" }) } });`,
      "content/notes/one.md": "---\ntitle: One\n---\nOne.\n",
      "content/notes/two.md": "---\ntitle: Two\n---\nTwo.\n",
    });

    const mdxReport = await checkAdapter(nextAdapter, mdxSite, {
      collections: [
        { id: "pages", minEntries: 2, url: "/{slug}", fields: ["title"] },
        { id: "posts", minEntries: 2, url: "/posts/{slug}" },
      ],
      dev: { command: "npm run dev", port: 3000 },
    });
    const veliteReport = await checkAdapter(nextAdapter, veliteSite, {
      collections: [{ id: "notes", minEntries: 2, url: "/notes/{slug}/" }],
      dev: { command: "npm run dev", port: 3000 },
    });

    expect(failed(mdxReport)).toEqual([]);
    expect(failed(veliteReport)).toEqual([]);
  });

  it("SvelteKit, on custom kit.files and mdsvex fixtures", async () => {
    const custom = fixture({
      "package.json": JSON.stringify({ scripts: { dev: "vite dev", build: "vite build" }, devDependencies: { "@sveltejs/kit": "^2.18.0", mdsvex: "^0.12.0" } }),
      "svelte.config.js": `import adapter from "@sveltejs/adapter-static";
        import { mdsvex } from "mdsvex";
        export default {
          extensions: [".svelte", ".svx", ".md"],
          preprocess: [mdsvex()],
          kit: { adapter: adapter({ pages: "dist" }), files: { assets: "assets" } },
        };`,
      "vite.config.ts": "export default { server: { port: 5180 } };",
      "src/posts/first.svx": "---\ntitle: First\n---\nHello.\n",
      "src/posts/second.svx": "---\ntitle: Second\n---\nWorld.\n",
      "src/routes/+page.svx": "---\ntitle: Home\n---\nWelcome.\n",
      "src/lib/data/site.json": '{ "title": "Harbour" }\n',
    });
    const minimal = fixture({
      "package.json": JSON.stringify({ scripts: { dev: "vite dev", build: "vite build" }, devDependencies: { "@sveltejs/kit": "^2.18.0" } }),
      "svelte.config.js": "export default {};",
      "content/notes/a.md": "---\ntitle: A\n---\nA.\n",
      "content/notes/b.md": "---\ntitle: B\n---\nB.\n",
    });

    const customReport = await checkAdapter(sveltekitAdapter, custom, {
      collections: [
        { id: "posts", minEntries: 2, url: "/posts/{slug}/", fields: ["title"] },
        { id: "pages", minEntries: 1, url: null },
        { id: "site", url: null },
      ],
      dev: { command: "npm run dev", port: 5180 },
    });
    const minimalReport = await checkAdapter(sveltekitAdapter, minimal, {
      collections: [{ id: "notes", minEntries: 2, url: "/notes/{slug}/" }],
      dev: { command: "npm run dev", port: 5173 },
    });

    expect(failed(customReport)).toEqual([]);
    expect(failed(minimalReport)).toEqual([]);
  });
});
