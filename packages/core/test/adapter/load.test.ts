import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { afterAll, afterEach, describe, expect, it } from "vitest";

import { configJsonSchema, detectSite, loadSiteModel, validateConfig } from "../../src/content/index";
import { cleanup, entries, site } from "./helpers";

afterAll(cleanup);

const ADAPTER = `
export default {
  id: "lume",
  name: "Lume",
  apiVersion: 1,
  detect: (ctx) => (ctx.exists("_config.ts") ? { confidence: 0.9 } : null),
  conventions: () => ({ dev: { command: "deno task serve", port: 3000 }, contentDirs: ["src"] }),
  environment: () => ({ LUME_DRAFTS: "true" }),
};
`;

const lumeSite = (config: object, extra: Record<string, string> = {}) =>
  site({ "_config.ts": "export default {};\n", "galley.config.json": JSON.stringify(config), ...entries("src/posts"), ...extra });

describe("adapters named in galley.config.json", () => {
  const saved = process.env.GALLEY_DISABLE_SITE_ADAPTERS;

  afterEach(() => {
    if (saved === undefined) delete process.env.GALLEY_DISABLE_SITE_ADAPTERS;
    else process.env.GALLEY_DISABLE_SITE_ADAPTERS = saved;
  });

  it("loads a file inside the site and lets it describe the site", async () => {
    const root = lumeSite({ adapters: ["./tools/lume-adapter.mjs"] }, { "tools/lume-adapter.mjs": ADAPTER });
    const model = await loadSiteModel(root);

    expect(model.framework).toEqual({ id: "lume", name: "Lume" });
    expect(model.dev).toEqual({ command: "deno task serve", port: 3000 });
    expect(model.environment).toEqual({ LUME_DRAFTS: "true" });
    expect(model.collections.map((collection) => [collection.id, collection.url])).toEqual([["posts", "/posts/{slug}/"]]);
    expect(model.notes[0]).toBe("Loaded the Lume adapter from ./tools/lume-adapter.mjs.");
    // detectSite never reads the config, so it never runs the site's code.
    expect((await detectSite(root)).framework.id).toBe("generic");
  });

  it("loads a package from the site's own node_modules (default or named `adapter` export)", async () => {
    const root = lumeSite(
      { adapters: ["galley-adapter-lume"] },
      {
        "node_modules/galley-adapter-lume/package.json": JSON.stringify({ name: "galley-adapter-lume", type: "module", exports: { ".": { import: "./dist/index.js" } } }),
        "node_modules/galley-adapter-lume/dist/index.js": ADAPTER.replace("export default", "export const adapter ="),
      }
    );

    expect((await loadSiteModel(root)).framework.id).toBe("lume");
  });

  it("GALLEY_DISABLE_SITE_ADAPTERS=1 skips them, with a note", async () => {
    process.env.GALLEY_DISABLE_SITE_ADAPTERS = "1";
    const model = await loadSiteModel(lumeSite({ adapters: ["./tools/lume-adapter.mjs"] }, { "tools/lume-adapter.mjs": ADAPTER }));

    expect(model.framework.id).toBe("generic");
    expect(model.notes[0]).toMatch(/^Adapters from the site are turned off \(GALLEY_DISABLE_SITE_ADAPTERS\), so “\.\/tools\/lume-adapter\.mjs” was not loaded/);
  });

  it("never loads from outside the site, and explains every refusal", async () => {
    const outside = site({ "evil.mjs": ADAPTER });
    const root = lumeSite({
      adapters: [`../${outside.split("/").pop()}/evil.mjs`, join(outside, "evil.mjs"), "./missing.mjs", "not-installed", "../../etc", "./tools/broken.mjs", "./tools/not-an-adapter.mjs", "./tools/lume-adapter.mjs", "./tools/lume-again.mjs"],
    }, {
      "tools/broken.mjs": "export default {{{",
      "tools/not-an-adapter.mjs": "export default { id: 'x', name: 'X' };",
      "tools/lume-adapter.mjs": ADAPTER,
      "tools/lume-again.mjs": ADAPTER,
    });
    const model = await loadSiteModel(root);
    const notes = model.notes.filter((note) => /adapter/i.test(note));

    expect(model.framework.id).toBe("lume");
    expect(notes[0]).toMatch(/was skipped: .* is outside the site folder, and adapters are only loaded from inside it\.$/);
    expect(notes[1]).toMatch(/was skipped: .* is outside the site folder/);
    expect(notes[2]).toBe("The adapter ./missing.mjs in galley.config.json was skipped: ./missing.mjs was not found in the site folder.");
    expect(notes[3]).toBe("The adapter not-installed in galley.config.json was skipped: the package “not-installed” is not installed in this site. Add it to the site's devDependencies and install.");
    expect(notes[4]).toMatch(/^The adapter \.\.\/\.\.\/etc in galley\.config\.json was skipped/);
    expect(notes[5]).toMatch(/^The adapter \.\/tools\/broken\.mjs could not be loaded \(.+\), so it was skipped\.$/);
    expect(notes[6]).toBe("./tools/not-an-adapter.mjs is not a usable adapter: “detect” should be a function that returns a match or null. It was skipped.");
    expect(notes[7]).toBe("Loaded the Lume adapter from ./tools/lume-adapter.mjs.");
    expect(notes[8]).toMatch(/uses the id “lume”, which an earlier adapter in galley\.config\.json already uses, so it was skipped\./);
  });

  it("an edited local adapter is picked up on the next load", async () => {
    const root = lumeSite({ adapters: ["./tools/lume-adapter.mjs"] }, { "tools/lume-adapter.mjs": ADAPTER });

    expect((await loadSiteModel(root)).dev?.port).toBe(3000);
    // A later mtime: make sure the clock moves on for coarse file systems.
    await new Promise((done) => setTimeout(done, 20));
    writeFileSync(join(root, "tools/lume-adapter.mjs"), ADAPTER.replace("port: 3000", "port: 3001"));
    expect((await loadSiteModel(root)).dev?.port).toBe(3001);
  });

  it("framework in the config forces a configured adapter, or says when there is none", async () => {
    const root = lumeSite({ adapters: ["./tools/lume-adapter.mjs"], framework: "hugo" }, { "tools/lume-adapter.mjs": ADAPTER });
    const forced = await loadSiteModel(root);

    expect(forced.framework.id).toBe("hugo");
    expect(forced.notes).toContain("galley.config.json sets the framework to Hugo.");
    const missing = await loadSiteModel(lumeSite({ framework: "lume" }));

    expect(missing.framework.id).toBe("generic");
    expect(missing.notes.some((note) => /sets the framework to “lume”, but no adapter with that id is available/.test(note))).toBe(true);
  });

  it("a config that does not parse loads nothing from the site", async () => {
    const root = lumeSite({});

    mkdirSync(join(root, "tools"), { recursive: true });
    writeFileSync(join(root, "tools/lume-adapter.mjs"), ADAPTER);
    writeFileSync(join(root, "galley.config.json"), '{ "adapters": ["./tools/lume-adapter.mjs"], }');
    const model = await loadSiteModel(root);

    expect(model.framework.id).toBe("generic");
    expect(model.notes.at(-1)).toMatch(/not valid JSON.*ignored until it is fixed/);
  });
});

describe("config validation", () => {
  it("accepts any lowercase adapter id and a list of adapters", () => {
    expect(validateConfig({ framework: "lume", adapters: ["galley-adapter-lume", "./tools/a.mjs"] }).ok).toBe(true);
    expect(validateConfig({ framework: "astro" }).ok).toBe(true);
    const bad = validateConfig({ framework: "Lume", adapters: [""] });

    expect(bad.ok).toBe(false);
    expect(!bad.ok && bad.errors).toEqual(["framework: must be an adapter id: lowercase letters, digits and dashes, like “astro” or “eleventy”.", "adapters[0]: must not be empty."]);
  });

  it("the JSON Schema still autocompletes the built-in ids", () => {
    const schema = configJsonSchema() as { properties: Record<string, { anyOf?: Array<{ enum?: string[]; pattern?: string }>; type?: string; items?: unknown }> };

    expect(schema.properties.framework?.anyOf?.[0]?.enum).toEqual(["astro", "eleventy", "hugo", "jekyll", "next", "nuxt", "sveltekit", "docusaurus", "generic"]);
    expect(schema.properties.framework?.anyOf?.[1]?.pattern).toBe("^[a-z][a-z0-9-]*$");
    expect(schema.properties.adapters).toMatchObject({ type: "array", items: { type: "string" } });
  });
});
