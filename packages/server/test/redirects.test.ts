/**
 * The redirects routes: wired to the engine's RedirectsService, input
 * validated before it reaches it, a host refusing the Cloudflare key as a
 * 400 (never 401), exports as downloads — and one pass with the real
 * service on a real copy of the starter, so the HTTP shapes are what the
 * engine really returns.
 */
import { execFileSync } from "node:child_process";
import { cpSync, mkdtempSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import { GalleyError } from "@galley/core";
import { createRedirectsService, type RedirectsOverview, type RedirectsService } from "@galley/core/redirects";
import { createEventBus, createSiteService } from "@galley/core/site";
import type { Settings, SiteService } from "@galley/core/types";
import { fake, fakeSite, json, SITE_ID, testApp } from "./helpers";

function withRedirects(impl: Partial<RedirectsService>, site: SiteService = fakeSite()) {
  const app = testApp({ site });

  app.services.redirects = fake<RedirectsService>("redirects", impl);
  return app;
}

describe("redirects routes", () => {
  it("answer 404 in plain words when the server has no redirects service", async () => {
    const { call } = testApp({ site: fakeSite() });
    const response = await call("GET", `/api/sites/${SITE_ID}/redirects`);

    expect(response.status).toBe(404);
    expect((await json(response)).error.message).toBe("Redirects aren't available on this server.");
  });

  it("validate a saved list before the engine sees it", async () => {
    const seen: unknown[] = [];
    const { call } = withRedirects({ save: async (_site, input) => (seen.push(input), {} as RedirectsOverview) });
    const bad = await call("PUT", `/api/sites/${SITE_ID}/redirects`, { redirects: [{ from: "/a/", to: "/b/", status: 200 }] });

    expect(bad.status).toBe(400);
    expect(seen).toEqual([]);
    const good = await call("PUT", `/api/sites/${SITE_ID}/redirects`, { redirects: [{ from: "/a/", to: "/b/", status: 301 }], baseHash: null });

    expect(good.status).toBe(200);
    expect(seen).toEqual([{ redirects: [{ from: "/a/", to: "/b/", status: 301 }], baseHash: null }]);
  });

  it("refuse an import with neither text nor a file", async () => {
    const { call } = withRedirects({});
    const response = await call("POST", `/api/sites/${SITE_ID}/redirects/review`, { mode: "add" });

    expect(response.status).toBe(400);
  });

  it("turn a key Cloudflare refuses into a 400, so the UI doesn't think its own session ended", async () => {
    const { call } = withRedirects({
      cloudflarePlan: async () => {
        throw new GalleyError("unauthorized", "Cloudflare didn't accept the access key.");
      },
    });
    const response = await call("POST", `/api/sites/${SITE_ID}/redirects/cloudflare/plan`);

    expect(response.status).toBe(400);
    expect((await json(response)).error).toMatchObject({ code: "unconfigured" });
  });

  it("send exports as downloads", async () => {
    const { call } = withRedirects({ exportList: async () => ({ filename: "_redirects", type: "text/plain", body: "/a/ /b/ 301\n" }) });
    const response = await call("GET", `/api/sites/${SITE_ID}/redirects/export?format=redirects-file`);

    expect(response.status).toBe(200);
    expect(response.headers.get("content-disposition")).toBe('attachment; filename="_redirects"');
    expect(await response.text()).toBe("/a/ /b/ 301\n");
    expect((await call("GET", `/api/sites/${SITE_ID}/redirects/export?format=zip`)).status).toBe(400);
  });
});

describe("every redirects route answers", () => {
  const OVERVIEW = { file: "src/data/redirects.json", redirects: [] } as unknown as RedirectsOverview;
  const JOB = { id: "j1", kind: "redirects", label: "Setting the redirects on Cloudflare", state: "running", startedAt: 1 };
  const service: Partial<RedirectsService> = {
    overview: async () => OVERVIEW,
    replaceDerived: async () => OVERVIEW,
    removeLeftover: async () => OVERVIEW,
    health: async () => ({ brokenTargets: [], linkedOldAddresses: [] }),
    cloudflarePlan: async () => ({ id: "p1" }) as never,
    cloudflareApply: async () => JOB as never,
    cloudflareCheck: async () => ({ matches: true, differences: [], checkedAt: "x" }) as never,
    cloudflareRemove: async () => OVERVIEW,
  };

  it.each([
    ["GET", "/redirects", undefined],
    ["POST", "/redirects/derived/replace", undefined],
    ["POST", "/redirects/leftover/remove", { path: "vercel.json" }],
    ["GET", "/redirects/health", undefined],
    ["POST", "/redirects/cloudflare/plan", undefined],
    ["POST", "/redirects/cloudflare/apply", { planId: "p1" }],
    ["POST", "/redirects/cloudflare/check", undefined],
    ["POST", "/redirects/cloudflare/remove", undefined],
  ] as const)("%s %s", async (method, path, body) => {
    const { call } = withRedirects(service);
    const response = await call(method, `/api/sites/${SITE_ID}${path}`, body);

    expect(response.status).toBe(200);
    await response.json();
  });
});

const created: string[] = [];

afterAll(() => {
  for (const dir of created) rmSync(dir, { recursive: true, force: true });
});

describe("with the real engine", () => {
  it("review → import → try an address → export, on a copy of the starter", async () => {
    const starter = fileURLToPath(new URL("../../../starters/astro-starter", import.meta.url));
    const root = realpathSync(mkdtempSync(join(tmpdir(), "redirects-route-")));
    const home = realpathSync(mkdtempSync(join(tmpdir(), "redirects-home-")));

    created.push(root, home);
    cpSync(starter, root, { recursive: true, filter: (source) => !["node_modules", "dist", ".astro"].includes(basename(source)) });
    const git = (...args: string[]) => execFileSync("git", ["-c", "user.name=T", "-c", "user.email=t@example.com", ...args], { cwd: root, encoding: "utf8" });

    git("init", "-q", "-b", "main");
    git("add", "-A");
    git("commit", "-q", "-m", "Initial");
    const events = createEventBus();
    const site = await createSiteService(root, { id: SITE_ID, events, overlayScript: () => "", watch: false, author: () => null });
    const app = testApp({ site });

    app.services.redirects = createRedirectsService({ home, events, settings: { readSecret: async () => null, get: async () => ({}) as Settings } });
    try {
      expect((await app.call("PUT", `/api/sites/${SITE_ID}/redirects/settings`, { host: "cloudflare" })).status).toBe(200);
      const review = await json(await app.call("POST", `/api/sites/${SITE_ID}/redirects/review`, { text: "/old/,/about/,301\n/loop-a/ /loop-b/\n/loop-b/ /loop-a/\nnonsense" }));

      expect(review.blocking).toBe(1);
      expect(review.problems.map((problem: { code: string }) => problem.code)).toEqual(expect.arrayContaining(["loop", "malformed", "missing-status"]));
      const refused = await app.call("POST", `/api/sites/${SITE_ID}/redirects/import`, { text: "/old/,/about/,301\n/loop-a/ /loop-b/\n/loop-b/ /loop-a/" });

      expect(refused.status).toBe(400);
      const done = await json(await app.call("POST", `/api/sites/${SITE_ID}/redirects/import`, { text: "/old/,/about/,301\n/loop-a/ /loop-b/\n/loop-b/ /loop-a/", resolutions: { loops: "leave-out" } }));

      expect(done.overview.redirects).toEqual([{ from: "/old/", to: "/about/", status: 301, source: "import:list" }]);
      expect(readFileSync(join(root, "public/_redirects"), "utf8")).toMatch(/^\/old\/\s+\/about\/\s+301$/m);
      const trace = await json(await app.call("POST", `/api/sites/${SITE_ID}/redirects/try`, { address: "/old/" }));

      expect(trace).toMatchObject({ final: "/about/", finalKind: "page" });
      const csv = await app.call("GET", `/api/sites/${SITE_ID}/redirects/export?format=csv`);

      expect(await csv.text()).toBe("from,to,status,note,source\n/old/,/about/,301,,import:list\n");
    } finally {
      app.services.redirects.dispose();
      await site.dispose();
    }
  });
});
