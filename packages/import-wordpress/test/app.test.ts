/**
 * What the app and the `galley import` door rely on: the quick look at a
 * source, the address guard a server reads through, stopping part-way
 * without losing what arrived, the redirect hand-off, the rebuild request
 * handed to the assistant, and `--plan` with a target [path].
 */
import { existsSync, readFileSync } from "node:fs";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { importCommand, planContext } from "../src/command";
import { inspectWordPress } from "../src/inspect";
import { planImport } from "../src/plan";
import { rebuildRequest } from "../src/rebuild";
import { runImport } from "../src/run";
import { createGuardedFetch } from "../src/source/guarded";
import { readWordPress } from "../src/source/index";
import type { ProgressEvent } from "../src/types";
import { buildFakeSite, serveFakeSite, writeFakeSiteWxr, type RunningFakeSite } from "./fake-site";
import { git, makeSite, openSite, tempDir } from "./helpers";

const site = buildFakeSite({ posts: 14, pages: 5, elementor: 2 });
let fake: RunningFakeSite;
let wxr: string;

beforeAll(async () => {
  fake = await serveFakeSite(site);
  wxr = join(tempDir("wxr-"), "fernhill.xml");
  writeFakeSiteWxr(site, fake.url, wxr);
});
afterAll(async () => {
  await fake.close();
});

function io(cwd: string) {
  const stdout: string[] = [];
  const stderr: string[] = [];

  return { stdout, stderr, out: (line = "") => stdout.push(line), err: (line = "") => stderr.push(line), cwd, env: {} as NodeJS.ProcessEnv };
}

describe("the quick look at a source", () => {
  it("counts a live site from its own totals, without reading it", async () => {
    const before = fake.requests.length;
    const look = await inspectWordPress({ url: fake.url });

    expect(look).toMatchObject({ kind: "rest", title: "Fernhill Garden Studio", counts: { posts: 14, pages: 5, comments: 37 } });
    expect(look.counts.media).toBe(site.media.length);
    // Discovery plus one tiny request per list — never the whole site.
    expect(fake.requests.length - before).toBeLessThan(10);
  });

  it("takes an address typed without https://, falling back to plain http when https can't connect", async () => {
    const started = Date.now();
    const look = await inspectWordPress({ url: fake.url.replace(/^http:\/\//, "") });

    expect(look.counts.posts).toBe(14);
    // The https attempt fails at once: no retries for a connection that can't work.
    expect(Date.now() - started).toBeLessThan(3000);
  });

  it("reads an export file whole, with its page-builder pages", async () => {
    const look = await inspectWordPress({ file: wxr });

    expect(look).toMatchObject({ kind: "file", counts: { posts: 14, pages: 5 }, builderPages: 2 });
    expect(look.site?.items.length).toBe(19);
  });

  it("says a locked site hides its content, and that a wrong password is wrong", async () => {
    const locked = await serveFakeSite(site, { credentials: "ines:abcd efgh ijkl" });

    try {
      await expect(inspectWordPress({ url: locked.url })).rejects.toMatchObject({ reason: "blocked", message: expect.stringMatching(/hides its content from visitors/) });
      await expect(inspectWordPress({ url: locked.url, auth: { user: "ines", password: "nope" } })).rejects.toMatchObject({ reason: "auth" });
      expect((await inspectWordPress({ url: locked.url, auth: { user: "ines", password: "abcd efgh ijkl" } })).signedIn).toBe(true);
    } finally {
      await locked.close();
    }
  });
});

describe("the server-side address guard", () => {
  it("refuses this computer and private networks in hosted mode, before connecting", async () => {
    const hosted = createGuardedFetch({ allowPrivate: false });

    await expect(hosted(`${fake.url}/wp-json/`)).rejects.toMatchObject({ name: "OutboundRefused" });
    const lying = createGuardedFetch({ allowPrivate: false, resolve: async () => [{ address: "10.1.2.3", family: 4 }] });

    await expect(lying("http://wordpress.example/")).rejects.toThrow(/private or local network address/);
    // Through the importer it is a plain refusal, not "the site didn't answer".
    await expect(inspectWordPress({ url: fake.url }, { fetch: hosted })).rejects.toMatchObject({ reason: "refused" });
  });

  it("allows a WordPress on this computer in local mode", async () => {
    const local = createGuardedFetch({ allowPrivate: true });
    const look = await inspectWordPress({ url: fake.url }, { fetch: local });

    expect(look.counts.posts).toBe(14);
  });

  it("checks every redirect again, even from a public address", async () => {
    // A stand-in for a public host: it answers from this computer, but the guard sees only the public address.
    const bouncer = createServer((req, res) => {
      if (req.url === "/ok") {
        res.writeHead(200, { "content-type": "text/plain" });
        return res.end("fine");
      }
      res.writeHead(302, { location: req.url === "/inside" ? "http://192.168.1.10/admin" : "/ok" });
      res.end();
    });

    await new Promise<void>((resolve) => bouncer.listen(0, "127.0.0.1", resolve));
    const port = (bouncer.address() as AddressInfo).port;
    const guarded = createGuardedFetch({
      allowPrivate: false,
      resolve: async () => [{ address: "93.184.215.14", family: 4 }],
      connectTo: (checked) => (checked.address === "93.184.215.14" ? { address: "127.0.0.1", family: 4 } : checked),
    });

    try {
      const followed = await guarded(`http://public.example:${port}/hop`);

      expect(await followed.text()).toBe("fine");
      expect(followed.url).toBe(`http://public.example:${port}/ok`);
      await expect(guarded(`http://public.example:${port}/inside`)).rejects.toThrow(/private or local network address/);
    } finally {
      await new Promise((resolve) => bouncer.close(resolve));
    }
  });
});

describe("running from the app", () => {
  it("stops part-way, keeps what arrived, and finishes on the next run without duplicates", async () => {
    const root = makeSite("stop");
    const service = await openSite(root);
    const slow = await serveFakeSite(site, { mediaDelayMs: 15 });

    try {
      const wp = await readWordPress({ url: slow.url }, { fresh: true, cacheDir: tempDir("cache-") });
      const model = await service.model();
      const plan = planImport(wp, model, { context: await planContext(service, model), only: ["posts"], defaults: { blog: { author: "nell-okafor" } } });
      const controller = new AbortController();
      const seen: ProgressEvent[] = [];
      const report = await runImport(service, wp, plan, {
        signal: controller.signal,
        onProgress: (event) => {
          seen.push(event);
          if (event.phase === "entries" && event.done === 3) controller.abort();
        },
      });

      expect(report.stopped).toBe(true);
      expect(report.counts.posts.created).toBe(3);
      expect(report.nextSteps[0]).toMatch(/stopped.*kept as pending changes/);
      expect(seen.some((event) => event.phase === "entries" && event.label === "Bringing over posts" && event.total === 14)).toBe(true);
      // The record holds what arrived, so the next run picks up the rest.
      expect(existsSync(join(root, "wordpress-import/manifest.json"))).toBe(true);
      const again = await runImport(service, wp, planImport(wp, await service.model(), { context: await planContext(service, model), only: ["posts"], defaults: { blog: { author: "nell-okafor" } } }));

      expect(again.counts.posts).toMatchObject({ created: 11, unchanged: 3 });
    } finally {
      await service.dispose();
      await slow.close();
    }
  });

  it("hands redirects to the import folder only, never the site's own redirect file", async () => {
    const root = makeSite("handoff");
    const service = await openSite(root);

    try {
      const wp = await readWordPress({ file: wxr });
      const model = await service.model();
      const plan = planImport(wp, model, { context: await planContext(service, model), only: ["posts"], defaults: { blog: { author: "nell-okafor" } } });
      const report = await runImport(service, wp, plan, { writeRedirects: true, redirectFiles: "import-folder" });

      // Both forms of the same list, beside the record: the Redirects screen offers them once.
      expect(report.files).toEqual(["wordpress-import/manifest.json", "wordpress-import/redirects.mjs", "wordpress-import/_redirects"]);
      expect(existsSync(join(root, "public/_redirects"))).toBe(false);
      expect(readFileSync(join(root, "wordpress-import/_redirects"), "utf8")).toMatch(/^\/\d{4}\/\d\d\/[a-z0-9-]+\/\s+\/blog\/[a-z0-9-]+\/\s+301$/m);
    } finally {
      await service.dispose();
    }
  });

  it("writes a rebuild request that names the page, its sections and the site's section types", async () => {
    const wp = await readWordPress({ file: wxr });
    const root = makeSite("brief");
    const service = await openSite(root);

    try {
      const model = await service.model();
      const plan = planImport(wp, model, { context: await planContext(service, model), only: ["pages"] });
      const rebuild = plan.rebuilds.find((r) => r.title === "Garden design")!;
      const types = model.collections.find((c) => c.id === "pages")!.fields.find((f) => f.type === "blocks")!.blocks!.map((b) => ({ type: b.type, label: b.label }));
      const text = rebuildRequest(rebuild, types, "https://old.example/garden-design/");

      expect(text).toMatch(/^Rebuild the page “Garden design” \(src\/content\/pages\/garden-design\.md\) from this site's own sections\. On the old site it was made with Elementor \(https:\/\/old\.example\/garden-design\/\)/);
      expect(text).toMatch(/1\. heading “Garden design for gardens that look after themselves”.* → a “.+” section/);
      expect(text).toContain("Use the page's words exactly as they are");
      expect(text.length).toBeLessThan(20_000);
    } finally {
      await service.dispose();
    }
  });
});

describe("galley import wordpress <source> [path] --plan", () => {
  it("plans into the site named by [path] and writes nothing", async () => {
    const root = makeSite("plan");
    const run = io(tempDir("cwd-"));

    expect(await importCommand.run(["wordpress", wxr, root, "--plan", "--only", "posts", "--default", "blog.author=nell-okafor"], run)).toBe(0);
    expect(run.stdout.join("\n")).toMatch(/^Import plan \(nothing was written\)[\s\S]*Posts: 14 to add/);
    expect(git(root, "status", "--porcelain", "-uall")).toBe("");
  });

  it("asks who to credit when the writers aren't on the site, with the option to answer", async () => {
    const root = makeSite("ask", { people: false });
    const run = io(root);

    expect(await importCommand.run(["wordpress", wxr, "--only", "posts"], run)).toBe(1);
    expect(run.stdout.join("\n")).toMatch(/Questions to answer first[\s\S]*Ines Calder, Rowan Pike and Mae Tulloch as authors[\s\S]*--default blog\.author=/);
    expect(git(root, "status", "--porcelain", "-uall")).toBe("");
  });
});
