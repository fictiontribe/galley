/**
 * The list and the host's file, on real temporary git repositories of the
 * starter, through the real SiteService: saving writes exactly the list and
 * the host's file; a hand-edited host file is never overwritten silently; a
 * list edited by the assistant's entry tools is followed; an edit from
 * outside the app is not; vercel.json gains only its redirects member; the
 * generated `_redirects` ends up in the build output a deploy uploads.
 */
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { collectFiles } from "../../src/deploy/files";
import { createRedirectsService, type RedirectsService } from "../../src/redirects/index";
import { createEventBus } from "../../src/site/index";
import type { EventBus, Settings } from "../../src/types";
import { disposeAll, makeSite, openSite, sh, tempDir, until, writeTree } from "../site/helpers";

const LIST = "src/data/redirects.json";
const FILE = "public/_redirects";
const services: RedirectsService[] = [];

afterEach(async () => {
  while (services.length) services.pop()!.dispose();
  await disposeAll();
});

async function rig(root = makeSite()) {
  const bus: EventBus = createEventBus();
  const harness = await openSite(root, { events: bus });
  const site = harness.site;
  const home = tempDir("redirects-home-");
  const redirects = createRedirectsService({
    home,
    events: bus,
    registry: { get: async (id) => (id === site.id ? site : null) },
    settings: { readSecret: async () => null, get: async () => ({ author: { name: "Test Editor", email: "editor@example.com" } }) as Settings },
  });

  services.push(redirects);
  const status = () =>
    sh(root, "status", "--porcelain", "--untracked-files=all")
      .split("\n")
      .filter(Boolean)
      .map((line) => line.slice(3))
      .sort();
  const commitAll = () => {
    sh(root, "add", "-A");
    sh(root, "commit", "-q", "-m", "Settled");
  };

  return { root, site, redirects, bus, home, status, commitAll, read: (path: string) => readFileSync(join(root, path), "utf8") };
}

const PASTE = ["/old-about/,/about/,301", "/2019/05/survey-notes/,/blog/measured-survey/,301", "/services-old/ /services/ 302"].join("\n");

describe("derived file sync", () => {
  it("an import lands as the list plus the host's file, and nothing else", async () => {
    const { site, redirects, status, commitAll, read } = await rig();

    await redirects.configure(site, { host: "cloudflare" });
    commitAll();
    const { overview } = await redirects.confirm(site, { text: PASTE });

    expect(status()).toEqual([FILE, LIST].sort());
    expect(overview.redirects).toHaveLength(3);
    expect(overview.derived).toMatchObject({ path: FILE, state: "in-step" });
    expect(read(LIST).split("\n").filter((line) => line.includes('"from"'))).toHaveLength(3);
    expect(read(FILE)).toMatch(/^\/old-about\/\s+\/about\/\s+301$/m);
  });

  it("choosing the host writes its file; the list collection is hidden from the content list", async () => {
    const { site, redirects, read } = await rig();

    await redirects.save(site, { redirects: [{ from: "/a/", to: "/about/", status: 301 }], baseHash: null });
    let overview = await redirects.overview(site);

    expect(overview.derived).toBeNull();
    overview = await redirects.configure(site, { host: "netlify" });
    expect(overview.derived).toMatchObject({ state: "in-step" });
    expect(read(FILE)).toContain("/a/");
    const model = await site.refresh();

    expect(model.collections.find((collection) => collection.path === LIST)).toMatchObject({ hidden: true });
  });

  it("never overwrites a hand-edited file silently, and replaces it when asked", async () => {
    const { root, site, redirects, read } = await rig();

    await redirects.configure(site, { host: "cloudflare" });
    await redirects.save(site, { redirects: [{ from: "/a/", to: "/about/", status: 301 }], baseHash: null });
    writeFileSync(join(root, FILE), `${read(FILE)}/hand-made/ /contact/ 301\n`);
    const edited = read(FILE);
    const overview = await redirects.save(site, { redirects: [{ from: "/a/", to: "/about/", status: 301 }, { from: "/b/", to: "/contact/", status: 301 }], baseHash: (await redirects.overview(site)).hash });

    expect(read(FILE)).toBe(edited);
    expect(overview.derived).toMatchObject({ state: "hand-edited" });
    expect(overview.derived!.current).toContain("/hand-made/");
    expect(overview.derived!.proposed).toContain("/b/");
    const replaced = await redirects.replaceDerived(site);

    expect(replaced.derived!.state).toBe("in-step");
    expect(read(FILE)).not.toContain("/hand-made/");
  });

  it("a _redirects file the site already had is left alone and offered for import", async () => {
    const { root, site, redirects, read, commitAll } = await rig();

    writeFileSync(join(root, FILE), "/legacy/ /about/ 301\n/legacy-two/ /contact/ 301\n");
    commitAll();
    await redirects.configure(site, { host: "cloudflare" });
    const overview = await redirects.save(site, { redirects: [{ from: "/a/", to: "/about/", status: 301 }], baseHash: null });

    expect(read(FILE)).toBe("/legacy/ /about/ 301\n/legacy-two/ /contact/ 301\n");
    expect(overview.derived!.state).toBe("foreign");
    expect(overview.imports).toEqual([{ path: FILE, label: `The redirects already in ${FILE}`, count: 2, waiting: 2 }]);
    const review = await redirects.review(site, { path: FILE });

    expect(review.counts.add).toBe(2);
  });

  it("keeps offering the WordPress import's redirects on a list that has others, until they are in it", async () => {
    const { root, site, redirects, commitAll } = await rig();

    writeTree(root, { "wordpress-import/_redirects": "/2019/05/coat-notes/ /blog/ 301\n/old-about/ /about/ 301\n/gone/ /contact/ 301\n" });
    commitAll();
    let overview = await redirects.save(site, { redirects: [{ from: "/a/", to: "/about/", status: 301 }], baseHash: null });

    expect(overview.imports).toEqual([{ path: "wordpress-import/_redirects", label: "The WordPress import's redirects", count: 3, waiting: 3 }]);
    overview = (await redirects.confirm(site, { path: "wordpress-import/_redirects" })).overview;
    expect(overview.redirects).toHaveLength(4);
    expect(overview.imports[0]).toMatchObject({ count: 3, waiting: 0 });
  });

  it("refuses a save made on top of a list that changed underneath", async () => {
    const { site, redirects } = await rig();

    await redirects.save(site, { redirects: [{ from: "/a/", to: "/about/", status: 301 }], baseHash: null });
    await expect(redirects.save(site, { redirects: [], baseHash: null })).rejects.toMatchObject({ code: "conflict" });
  });

  it("follows the list edited by the entry tools (the assistant), not edits from outside", async () => {
    const { root, site, redirects, bus, read } = await rig();

    await redirects.configure(site, { host: "cloudflare" });
    await redirects.save(site, { redirects: [{ from: "/a/", to: "/about/", status: 301 }], baseHash: null });
    await site.refresh();
    await site.updateEntry(LIST, [{ op: "insert", path: ["redirects"], index: 1, value: { from: "/by-assistant/", to: "/contact/", status: 301 } }], { origin: "agent" });
    await until(() => read(FILE).includes("/by-assistant/"));
    const before = read(FILE);

    writeFileSync(join(root, LIST), read(LIST).replace('"/a/"', '"/outside/"'));
    bus.emit({ type: "changes.updated", siteId: site.id, paths: [LIST], origin: "external" });
    await new Promise((resolve) => setTimeout(resolve, 150));
    expect(read(FILE)).toBe(before);
    expect((await redirects.overview(site)).derived!.state).toBe("stale");
  });

  it("vercel.json gains only its redirects member, every other byte as it was", async () => {
    const root = makeSite();
    const original = '{\n  "cleanUrls":   true,\n  "headers": [ { "source": "/(.*)", "headers": [ { "key": "X-Frame-Options", "value": "DENY" } ] } ]\n}\n';

    writeTree(root, { "vercel.json": original });
    sh(root, "add", "-A");
    sh(root, "commit", "-q", "-m", "Vercel settings");
    const { site, redirects, read } = await rig(root);

    await redirects.save(site, { redirects: [{ from: "/a/", to: "/about/", status: 301 }, { from: "/blog/*", to: "/journal/:splat", status: 308 }], baseHash: null });
    await redirects.configure(site, { host: "vercel" });
    const after = read("vercel.json");
    const parsed = JSON.parse(after) as { redirects: unknown[]; cleanUrls: boolean };

    expect(parsed.redirects).toEqual([
      { source: "/a/", destination: "/about/", statusCode: 301 },
      { source: "/blog/:path*", destination: "/journal/:path*", permanent: true },
    ]);
    expect(after.startsWith(original.slice(0, original.lastIndexOf("\n}")))).toBe(true);
    const diff = execFileSync("git", ["diff", "--unified=0", "--", "vercel.json"], { cwd: root, encoding: "utf8" });

    expect(diff.split("\n").filter((line) => /^-(?!--)/.test(line))).toEqual(['-  "headers": [ { "source": "/(.*)", "headers": [ { "key": "X-Frame-Options", "value": "DENY" } ] } ]']);
    // Hand-edit the array: noticed, because this computer remembers what it wrote.
    writeFileSync(join(root, "vercel.json"), after.replace('"/a/"', '"/hand/"'));
    const overview = await redirects.save(site, { redirects: [{ from: "/a/", to: "/about/", status: 302 }], baseHash: (await redirects.overview(site)).hash });

    expect(overview.derived!.state).toBe("hand-edited");
  });

  it("health: old addresses the site still links to, and new addresses that have gone", async () => {
    const { root, site, redirects } = await rig();

    writeFileSync(join(root, "src/content/pages/about.md"), readFileSync(join(root, "src/content/pages/about.md"), "utf8") + "\nSee [our old team page](/old-team/).\n");
    await redirects.save(site, { redirects: [{ from: "/old-team/", to: "/about/", status: 301 }, { from: "/x/", to: "/deleted-page/", status: 301 }], baseHash: null });
    const health = await redirects.health(site);

    expect(health.linkedOldAddresses).toEqual([{ from: "/old-team/", to: "/about/", pages: [expect.objectContaining({ path: "src/content/pages/about.md" })] }]);
    expect(health.brokenTargets).toEqual([{ index: 1, from: "/x/", to: "/deleted-page/" }]);
  });

  it("the generated _redirects is in the build output a deploy uploads", async () => {
    const root = makeSite();

    // A dependency-free build that copies public/ to dist/, as Astro does.
    writeTree(root, { "copy-public.mjs": 'import { cpSync } from "node:fs";\ncpSync("public", "dist", { recursive: true });\n' });
    const { site, redirects } = await rig(root);

    await redirects.configure(site, { host: "cloudflare" });
    await redirects.save(site, { redirects: [{ from: "/a/", to: "/about/", status: 301 }], baseHash: null });
    execFileSync(process.execPath, ["copy-public.mjs"], { cwd: root });
    const files = await collectFiles(join(root, "dist"), { maxFiles: 20_000, maxFileBytes: null, maxTotalBytes: null }, "Cloudflare", "dist");

    expect(files.map((file) => file.path)).toContain("_redirects");
  });
});
