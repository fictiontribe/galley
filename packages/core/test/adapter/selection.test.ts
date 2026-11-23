import { afterAll, describe, expect, it } from "vitest";

import {
  ADAPTER_API_VERSION,
  BUILTIN_ADAPTERS,
  conventionAdapter,
  defineAdapter,
  detectWithAdapters,
  validateAdapter,
  type GalleyAdapter,
} from "../../src/adapter/index";
import { detectSite } from "../../src/content/index";
import { cleanup, entries, site } from "./helpers";

afterAll(cleanup);

const zola = conventionAdapter({
  id: "zola",
  name: "Zola",
  files: ["config.toml"],
  requires: (ctx) => ctx.isDirectory("templates"),
  dev: { command: "zola serve", port: 1111 },
  build: { command: "zola build", outDir: "public" },
  publicDir: "static",
  contentDirs: ["content"],
  pageDirs: ["content"],
});

describe("defineAdapter and conventionAdapter", () => {
  it("defineAdapter returns the very object it was given", () => {
    const adapter = { id: "x", name: "X", detect: () => null };

    expect(defineAdapter(adapter)).toBe(adapter);
  });

  it("conventionAdapter scores a dependency, a file, and both", async () => {
    const both = site({ "package.json": JSON.stringify({ devDependencies: { zolaish: "^2.1.0" } }), "zola.toml": "", templates: "" });
    const spec = conventionAdapter({ id: "zolaish", name: "Zolaish", packages: ["zolaish"], files: ["zola.toml"] });
    const run = await detectWithAdapters(both, { adapters: [spec] });
    const pkgOnly = await detectWithAdapters(site({ "package.json": JSON.stringify({ dependencies: { zolaish: "2.0.0" } }) }), { adapters: [spec] });
    const fileOnly = await detectWithAdapters(site({ "zola.toml": "" }), { adapters: [spec] });

    expect(run.match).toEqual({ confidence: 0.95, version: "2.1.0" });
    expect(pkgOnly.match).toEqual({ confidence: 0.9, version: "2.0.0" });
    expect(fileOnly.match).toEqual({ confidence: 0.8 });
  });

  it("conventionAdapter merges a conventions hook over the static values", async () => {
    const adapter = conventionAdapter({
      id: "zolaish",
      name: "Zolaish",
      files: ["zola.toml"],
      dev: { command: "zolaish serve", port: 1111 },
      conventions: (ctx) => ({ dev: { port: Number(ctx.readText("port.txt")) } }),
    });
    const model = await detectSite(site({ "zola.toml": "", "port.txt": "2222" }), { adapters: [adapter] });

    expect(model.dev).toEqual({ command: "zolaish serve", port: 2222 });
  });
});

describe("choosing an adapter", () => {
  const zolaSite = { "config.toml": 'base_url = "https://zola.example"\n', "templates/index.html": "<html></html>", ...entries("content/posts") };

  it("the highest confidence wins over the built-ins", async () => {
    const root = site(zolaSite);
    // Without the Zola adapter, Hugo claims config.toml + content/ weakly.
    expect((await detectSite(root)).framework.id).toBe("hugo");
    const model = await detectSite(root, { adapters: [zola] });

    expect(model.framework).toEqual({ id: "zola", name: "Zola" });
    expect(model.dev).toEqual({ command: "zola serve", port: 1111 });
    expect(model.build).toEqual({ command: "zola build", outDir: "public" });
    expect(model.collections.map((collection) => [collection.id, collection.path, collection.url])).toEqual([["posts", "content/posts", "/posts/{slug}/"]]);
  });

  it("ties go to registration order: configured adapters before the built-ins", async () => {
    const root = site({ "package.json": JSON.stringify({ dependencies: { astro: "5.0.0" } }), "astro.config.mjs": "export default {}" });
    const mine = defineAdapter({ id: "my-astro", name: "My Astro", detect: () => ({ confidence: 0.95 }) });
    const run = await detectWithAdapters(root, { adapters: [mine] });

    expect(run.adapter).toBe(mine);
    expect(run.candidates.find((candidate) => candidate.id === "astro")?.match?.confidence).toBe(0.95);
  });

  it("the generic adapter is the weak fallback", async () => {
    const run = await detectWithAdapters(site(entries("notes")));

    expect(run.adapter.id).toBe("generic");
    expect(run.match.confidence).toBeLessThan(0.1);
    expect(BUILTIN_ADAPTERS.at(-1)?.id).toBe("generic");
  });

  it("an adapter that throws, or returns nonsense, is skipped with a note", async () => {
    const thrower = defineAdapter({ id: "thrower", name: "Thrower", detect: () => { throw new Error("boom"); } });
    const odd = { id: "odd", name: "Odd", detect: () => ({ confidence: "high" }) } as unknown as GalleyAdapter;
    const model = await detectSite(site(entries("notes")), { adapters: [thrower, odd] });

    expect(model.framework.id).toBe("generic");
    expect(model.notes).toContain("The Thrower adapter could not check this site — its detect step failed (boom) — so it was skipped.");
    expect(model.notes.some((note) => note.startsWith("The Odd adapter could not check this site"))).toBe(true);
  });

  it("a structurally broken adapter is refused before it runs", async () => {
    const model = await detectSite(site({}), { adapters: [{ id: "Bad Id", name: "Bad", detect: () => null } as GalleyAdapter] });

    expect(model.notes[0]).toMatch(/is not a usable adapter: its id should be lowercase/);
  });

  it("galley.config.json's framework forces an adapter (and says so)", async () => {
    const root = site(zolaSite);
    const forced = await detectSite(root, { adapters: [zola], framework: "hugo" });

    expect(forced.framework.id).toBe("hugo");
    expect(forced.notes).toContain("galley.config.json sets the framework to Hugo.");
    const unknown = await detectSite(root, { framework: "lume" });

    expect(unknown.framework.id).toBe("hugo");
    expect(unknown.notes.some((note) => note.includes("“lume”, but no adapter with that id is available"))).toBe(true);
  });
});

describe("hooks that fail cost only what they would have provided", () => {
  it("conventions, collections, routes and environment failures become notes and problems", async () => {
    const root = site({ "marker.txt": "", ...entries("content/posts") });
    const flaky = defineAdapter({
      id: "flaky",
      name: "Flaky",
      detect: (ctx) => (ctx.exists("marker.txt") ? { confidence: 0.9 } : null),
      conventions: () => { throw new Error("no conventions today"); },
      collections: async () => { throw new Error("config unreadable"); },
      routes: () => { throw new Error("routes broke"); },
      environment: () => { throw new Error("env broke"); },
    });
    const run = await detectWithAdapters(root, { adapters: [flaky] });

    expect(run.adapter.id).toBe("flaky");
    expect(run.problems).toEqual([
      "The Flaky adapter's conventions step failed (no conventions today), so the usual defaults were used.",
      "The Flaky adapter's collections step failed (config unreadable), so content folders were scanned instead.",
      "The Flaky adapter's routes step failed (routes broke), so page addresses were left as they were.",
      "The Flaky adapter's environment step failed (env broke), so the site's commands run with the usual environment.",
    ]);
    // Conventional discovery stepped in for the failed collections hook.
    expect(run.model.collections.map((collection) => collection.id)).toEqual(["posts"]);
  });

  it("unusable conventions and drafts are reported and the rest is kept", async () => {
    const root = site({ "marker.txt": "", ...entries("stuff") });
    const sloppy = defineAdapter({
      id: "sloppy",
      name: "Sloppy",
      detect: () => ({ confidence: 0.9 }),
      conventions: () => ({ dev: { command: "sloppy dev", port: "eighty" as unknown as number }, contentDirs: "stuff" as unknown as string[] }),
      collections: () => [{ id: "stuff", path: "stuff" }, { id: "", path: "nowhere" }],
      routes: () => ({ stuff: "stuff/{slug}" }),
      environment: () => ({ SLOPPY_MODE: "1", "not a name": "x", UNSET: undefined }),
    });
    const model = await detectSite(root, { adapters: [sloppy] });

    expect(model.dev).toEqual({ command: "sloppy dev", port: null });
    expect(model.collections.map((collection) => [collection.id, collection.count, collection.url])).toEqual([["stuff", 2, null]]);
    expect(model.environment).toEqual({ SLOPPY_MODE: "1" });
    expect(model.notes.filter((note) => note.startsWith("The Sloppy adapter"))).toEqual([
      "The Sloppy adapter's conventions were partly unusable (“dev.port” was not a port number); the default was used instead.",
      "The Sloppy adapter's conventions were partly unusable (“contentDirs” was not a list of folders); the default was used instead.",
      "The Sloppy adapter described a collection Galley can't use (a collection has no id); it was left out.",
      'The Sloppy adapter gave “Stuff” the address "stuff/{slug}", which does not start with "/"; it was ignored.',
    ]);
  });

  it("an empty list from collections() means 'none', not 'go and look'", async () => {
    const model = await detectSite(site(entries("posts")), { adapters: [defineAdapter({ id: "none", name: "None", detect: () => ({ confidence: 1 }), collections: () => [] })] });

    expect(model.collections).toEqual([]);
  });

  it("fills in what a draft leaves out", async () => {
    const root = site({ ...entries("src/posts"), "src/settings.yaml": "title: Hi\n" });
    const model = await detectSite(root, {
      adapters: [defineAdapter({ id: "drafty", name: "Drafty", detect: () => ({ confidence: 1 }), collections: () => [{ id: "posts", path: "./src/posts/" }, { id: "settings", path: "src/settings.yaml" }] })],
    });

    expect(model.collections.map(({ id, label, singular, kind, path, format, body, url, create, count, source }) => ({ id, label, singular, kind, path, format, body, url, create, count, source }))).toEqual([
      { id: "posts", label: "Posts", singular: "post", kind: "entries", path: "src/posts", format: "markdown", body: true, url: null, create: true, count: 2, source: "inferred" },
      { id: "settings", label: "Settings", singular: "settings", kind: "data", path: "src/settings.yaml", format: "yaml", body: false, url: null, create: false, count: 1, source: "inferred" },
    ]);
    expect(model.collections[0]!.fields.map((field) => field.key)).toEqual(["title"]);
  });
});

describe("validateAdapter", () => {
  it("explains what is wrong in plain words", () => {
    const problem = (value: unknown) => {
      const result = validateAdapter(value, "./my-adapter.mjs");

      return result.ok ? null : result.problem;
    };

    expect(problem(null)).toBe("./my-adapter.mjs is not a usable adapter: it should be an object with an id, a name and a detect function (export it as the module's default export).");
    expect(problem({ id: "x", name: "X" })).toMatch(/“detect” should be a function/);
    expect(problem({ id: "x", name: "", detect() {} })).toMatch(/needs a display name/);
    expect(problem({ id: "x", name: "X", detect() {}, routes: "yes" })).toMatch(/“routes” should be a function, or left out/);
    expect(problem({ id: "x", name: "X", detect() {}, apiVersion: "1" })).toMatch(/whole number/);
    expect(problem({ id: "x", name: "X", detect() {} })).toBeNull();
  });

  it("an apiVersion mismatch is a warning, not a refusal", async () => {
    const future = { id: "future", name: "Future", apiVersion: ADAPTER_API_VERSION + 1, detect: () => null };
    const result = validateAdapter(future, "galley-adapter-future");

    expect(result.ok).toBe(true);
    expect(result.ok && result.warnings[0]).toMatch(/written for adapter API version 2, and this version of Galley speaks version 1/);
  });
});
