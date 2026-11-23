import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterAll, describe, expect, it } from "vitest";

import { astroAdapter, hugoAdapter } from "@galley/core/adapter";
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
    expect(formatReport(report)).toMatch(/All 17 checks passed\.$/);
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
});
