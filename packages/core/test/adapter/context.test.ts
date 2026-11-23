import { symlinkSync } from "node:fs";
import { join } from "node:path";

import { afterAll, describe, expect, it } from "vitest";

import { defineAdapter, detectWithAdapters, parseModule, type AdapterContext } from "../../src/adapter/index";
import { cleanup, entries, site } from "./helpers";

afterAll(cleanup);

/** Runs `use` with the context the engine hands the winning adapter. */
async function withContext<T>(root: string, use: (ctx: AdapterContext) => T): Promise<T> {
  let out: T | undefined;

  await detectWithAdapters(root, {
    builtins: false,
    adapters: [defineAdapter({ id: "probe", name: "Probe", detect: () => ({ confidence: 1 }), collections: (ctx) => { out = use(ctx); return []; } })],
  });
  return out as T;
}

describe("AdapterContext file access", () => {
  const root = site({
    "package.json": JSON.stringify({ dependencies: { "some-ssg": "^3.2.1" }, devDependencies: { other: "~1.0.0" } }),
    "node_modules/some-ssg/package.json": JSON.stringify({ version: "3.4.0" }),
    "node_modules/some-ssg/index.js": "",
    "config/site.yaml": "title: Hello\nnested:\n  port: 8080\n",
    "config/site.toml": 'title = "Hello"\n',
    "data/list.json": "[1, 2, 3]",
    ...entries("content/posts"),
  });

  it("reads text, JSON, YAML and TOML; missing files are null", async () => {
    const result = await withContext(root, (ctx) => ({
      yaml: ctx.readData("config/site.yaml"),
      toml: ctx.readData("config/site.toml"),
      json: ctx.readJson("data/list.json"),
      missing: ctx.readText("nope.txt"),
      dir: ctx.isDirectory("content"),
      exists: ctx.exists("content/posts/first.md"),
      list: ctx.list("content/posts"),
      listRoot: ctx.list(".").includes("content/"),
    }));

    expect(result).toEqual({ yaml: { title: "Hello", nested: { port: 8080 } }, toml: { title: "Hello" }, json: [1, 2, 3], missing: null, dir: true, exists: true, list: ["first.md", "second.md"], listRoot: true });
  });

  it("refuses paths outside the site — a bug in the adapter, so it throws", async () => {
    const attempts = await withContext(root, (ctx) =>
      ["../outside.txt", "/etc/hosts", "content/../../x"].map((path) => {
        try {
          ctx.readText(path);
          return "read";
        } catch (error) {
          return (error as Error).message;
        }
      })
    );

    expect(attempts.every((message) => /is outside the site folder/.test(message))).toBe(true);
    expect(await withContext(root, (ctx) => { try { ctx.glob("../*"); return "ok"; } catch { return "refused"; } })).toBe("refused");
  });

  it("does not follow a symlink out of the site", async () => {
    const linked = site({ "inside.txt": "fine" });

    symlinkSync(join(root, "config", "site.yaml"), join(linked, "escape.yaml"));
    expect(await withContext(linked, (ctx) => [ctx.readText("inside.txt"), ctx.readText("escape.yaml")])).toEqual(["fine", null]);
  });

  it("globs site files only, never node_modules", async () => {
    const found = await withContext(root, (ctx) => ({ all: ctx.glob("**/*.{json,md}"), scoped: ctx.glob("*.md", { cwd: "content/posts" }), limited: ctx.glob("**/*", { limit: 2 }) }));

    expect(found.all).toEqual(["content/posts/first.md", "content/posts/second.md", "data/list.json", "package.json"]);
    expect(found.scoped).toEqual(["content/posts/first.md", "content/posts/second.md"]);
    expect(found.limited).toHaveLength(2);
  });

  it("answers dependency questions from package.json and node_modules", async () => {
    const deps = await withContext(root, (ctx) => [ctx.hasDependency("some-ssg"), ctx.dependencyVersion("some-ssg"), ctx.dependencyVersion("other"), ctx.hasDependency("absent"), ctx.packageJson?.dependencies]);

    expect(deps).toEqual(["^3.2.1", "3.4.0", "1.0.0", null, { "some-ssg": "^3.2.1" }]);
  });

  it("only the chosen adapter's notes reach the site", async () => {
    const run = await detectWithAdapters(site({}), {
      builtins: false,
      adapters: [
        defineAdapter({ id: "loser", name: "Loser", detect: (ctx) => { ctx.note("loser was here"); return { confidence: 0.2 }; } }),
        defineAdapter({ id: "winner", name: "Winner", detect: (ctx) => { ctx.note("winner checked"); return { confidence: 0.9 }; }, conventions: (ctx) => { ctx.note("winner conventions"); return {}; } }),
      ],
    });

    expect(run.model.notes).toEqual(["No package.json: using Winner's own commands.", "Recognised Winner.", "winner checked", "winner conventions", "No content collections were found. Add a galley.config.json to point at your content."]);
  });

  it("hooks of one detection share one context, so a WeakMap can carry work between them", async () => {
    const seen = new Set<AdapterContext>();
    const record = (ctx: AdapterContext) => seen.add(ctx);

    await detectWithAdapters(site(entries("posts")), {
      builtins: false,
      adapters: [defineAdapter({ id: "memo", name: "Memo", detect: (ctx) => (record(ctx), { confidence: 1 }), conventions: (ctx) => (record(ctx), {}), collections: (ctx) => (record(ctx), null), routes: (ctx) => (record(ctx), {}) })],
    });
    expect(seen.size).toBe(1);
  });
});

describe("helpers", () => {
  it("markdownCollections defaults to the adapter's conventions", async () => {
    const root = site({ ...entries("site/blog"), ...entries("site/docs/guides"), ...entries("elsewhere") });
    const adapter = defineAdapter({
      id: "conv",
      name: "Conv",
      detect: () => ({ confidence: 1 }),
      conventions: () => ({ contentDirs: ["site"], trailingSlash: false }),
      collections: (ctx) => ctx.helpers.markdownCollections(),
    });
    const run = await detectWithAdapters(root, { builtins: false, adapters: [adapter] });

    expect(run.model.collections.map((collection) => [collection.id, collection.path, collection.url])).toEqual([
      ["blog", "site/blog", "/blog/{slug}"],
      ["guides", "site/docs/guides", "/docs/guides/{slug}"],
    ]);
  });

  it("dataCollections and dataFolderCollections", async () => {
    const root = site({ "_data/menu.yaml": "items: []\n", "_data/site.json": "{}", "records/people/ana.json": "{}", "records/people/ben.json": "{}", ...entries("records/notes") });
    const drafts = await withContext(root, (ctx) => [...ctx.helpers.dataCollections(["_data"], { claimed: ["_data/site.json"] }), ...ctx.helpers.dataFolderCollections("records")]);

    expect(drafts.map((draft) => [draft.id, draft.kind, draft.path, draft.format])).toEqual([
      ["menu", "data", "_data/menu.yaml", "yaml"],
      ["people", "entries", "records/people", "json"],
    ]);
  });

  it("fileRoutes and urlPatternFromRoutes read file-based routes", async () => {
    const root = site({
      "pages/index.astro": "<h1>Home</h1>",
      "pages/[...slug].astro": 'const pages = await getCollection("pages");',
      "pages/notes/[id].astro": 'const note = await getEntry("notes", Astro.params.id);',
      "pages/notes/[id].json.ts": 'export const GET = () => getCollection("notes");',
    });
    const result = await withContext(root, (ctx) => {
      const routes = ctx.helpers.fileRoutes("pages");

      return {
        routes: routes.map((route) => [route.route, route.dynamic, route.endpoint, route.renders]),
        pages: ctx.helpers.urlPatternFromRoutes(routes, "pages", true),
        notes: ctx.helpers.urlPatternFromRoutes(routes, "notes", false),
      };
    });

    expect(result.routes).toEqual([
      ["/", false, false, []],
      ["/[...slug]", true, false, ["pages"]],
      ["/notes/[id]", true, false, ["notes"]],
      ["/notes/[id]", true, true, ["notes"]],
    ]);
    expect(result.pages).toBe("/{slug}/");
    expect(result.notes).toBe("/notes/{slug}");
  });

  it("readModule follows relative imports, including JSON", async () => {
    const root = site({
      "config/main.mjs": 'import { shared } from "./shared.js";\nimport settings from "../settings.json";\nexport default { shared, port: settings.port, title: settings.title };\n',
      "config/shared.js": 'const inner = { deep: true };\nexport const shared = { inner, name: "shared" };\n',
      "settings.json": '{ "port": 4000, "title": "Hello" }',
    });
    const read = await withContext(root, (ctx) => {
      const module = ctx.helpers.readModule("config/main.mjs")!;
      const config = module.configObject();

      return module.literal(config);
    });

    expect(read).toEqual({ shared: { inner: { deep: true }, name: "shared" }, port: 4000, title: "Hello" });
  });
});

describe("parseModule", () => {
  it("reads ESM and CommonJS config shapes without running them", () => {
    const esm = parseModule('import site from "./x.json";\nexport default defineConfig({ port: 3000, base: "/docs" });');
    const cjs = parseModule('module.exports = function (config) {\n  config.addPassthroughCopy("img");\n  return { dir: { input: "src", output: "dist" } };\n};');
    const fn = parseModule("export default async function setup() { return { ok: true }; }");
    const named = parseModule("exports.port = 8080;\nmodule.exports.host = 'localhost';");

    expect(esm.literal(esm.configObject())).toEqual({ port: 3000, base: "/docs" });
    expect(esm.imports.get("site")).toEqual({ from: "./x.json", imported: "default" });
    expect(esm.callee(esm.exported("default"))).toBe("defineConfig");
    expect(cjs.literal(cjs.configObject())).toEqual({ dir: { input: "src", output: "dist" } });
    expect(fn.literal(fn.configObject())).toEqual({ ok: true });
    expect([named.number(named.exported("port")), named.string(named.exported("host"))]).toEqual([8080, "localhost"]);
  });

  it("keeps `a || b` fallbacks and resolves members into object literals", () => {
    const module = parseModule('const settings = { url: "https://site.example" };\nexport const site = process.env.SITE_URL || settings.url;\nexport const other = settings.url;');
    const site = module.exported("site")!;

    expect(site.kind).toBe("logical");
    expect(site.kind === "logical" && module.string(site.right)).toBe("https://site.example");
    expect(module.string(module.exported("other"))).toBe("https://site.example");
  });

  it("never throws on nonsense", () => {
    expect(() => parseModule("export default {{{ (( ")).not.toThrow();
    expect(parseModule("}}} const = ;").configObject()).toBeUndefined();
  });
});
