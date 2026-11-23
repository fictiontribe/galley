/**
 * Redirects and headers reaching the host the way each one reads them:
 * Cloudflare in the upload's `assets.config` (never as files), Vercel in a
 * vercel.json at the root of the deployment's files.
 */
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, afterEach, describe, expect, it } from "vitest";
import { collectFiles, createCloudflareTarget, createVercelTarget, type DeployContext, type DeployInput } from "../../src/deploy/index";
import { CLOUDFLARE_MARKDOWN_RULE, VERCEL_MARKDOWN_RULE, checkCloudflareRedirects, vercelRoutingConfig, withCloudflareMarkdownHeader } from "../../src/deploy/routing";
import { cleanupAll, tempDir, writeTree } from "../workspace/helpers";
import { startFakeCloudflare, type FakeCloudflare } from "./fakes/cloudflare";
import { startFakeVercel, type FakeVercel } from "./fakes/vercel";

afterAll(cleanupAll);

const ACCOUNT = "acc0123456789abcdef0123456789abc";
const TEAM = "team_0123456789abcdef";
const PAGES = { "index.html": "<h1>Home</h1>", "blog/index.html": "<h1>Journal</h1>", "404.html": "<h1>Not here</h1>" };
const REDIRECTS = "# Generated\n/old-blog/* /blog/:splat 301\n/about-us /about/ 301\n";
const HEADERS = "/*\n  X-Frame-Options: DENY\n";

async function built(extra: Record<string, string> = {}) {
  const dir = tempDir("deploy-routing-");

  writeTree(dir, { ...PAGES, ...extra });
  return { dir, files: await collectFiles(dir, { maxFiles: 1000, maxFileBytes: null, maxTotalBytes: null }, "Host", "dist") };
}

function input(dir: string, files: DeployInput["files"], extra: Partial<DeployInput> = {}): DeployInput {
  return { project: "lowfield", account: ACCOUNT, dir, files, kind: "production", onProgress: () => undefined, ...extra };
}

describe("Cloudflare: _redirects and _headers travel in assets.config", () => {
  let fake: FakeCloudflare;
  const target = createCloudflareTarget();
  const ctx = (): DeployContext => ({ token: fake.token, fetch, apiBase: fake.api });

  afterEach(async () => fake?.close());

  it("a site with redirects: the rules go in the config, the file is not an asset (production and preview)", async () => {
    fake = await startFakeCloudflare();
    const site = await built({ _redirects: REDIRECTS });

    await target.ensureProject(ctx(), { account: ACCOUNT, name: "lowfield" });
    for (const kind of ["production", "preview"] as const) {
      await target.deploy(ctx(), input(site.dir, site.files, { kind }));
      const deployed = fake.deployments.at(-1)!;

      expect(deployed.kind).toBe(kind);
      expect(deployed.config).toEqual({ html_handling: "auto-trailing-slash", not_found_handling: "404-page", _redirects: REDIRECTS });
      expect([...deployed.files.keys()].sort()).toEqual(Object.keys(PAGES).sort());
    }
  });

  it("a site with headers", async () => {
    fake = await startFakeCloudflare();
    const site = await built({ _headers: HEADERS });

    await target.ensureProject(ctx(), { account: ACCOUNT, name: "lowfield" });
    await target.deploy(ctx(), input(site.dir, site.files));
    expect(fake.deployments.at(-1)!.config).toEqual({ html_handling: "auto-trailing-slash", not_found_handling: "404-page", _headers: HEADERS });
    expect(fake.deployments.at(-1)!.files.has("_headers")).toBe(false);
  });

  it("a site with neither: the request is as before", async () => {
    fake = await startFakeCloudflare();
    const site = await built();

    await target.ensureProject(ctx(), { account: ACCOUNT, name: "lowfield" });
    await target.deploy(ctx(), input(site.dir, site.files));
    expect(fake.deployments.at(-1)!.config).toEqual({ html_handling: "auto-trailing-slash", not_found_handling: "404-page" });
    expect(fake.deployments.at(-1)!.metadata.assets.config).not.toHaveProperty("_redirects");
  });

  it("only the root files count: a nested _redirects is an ordinary file", async () => {
    fake = await startFakeCloudflare();
    const site = await built({ "docs/_redirects": "/a /b 301\n" });

    await target.ensureProject(ctx(), { account: ACCOUNT, name: "lowfield" });
    await target.deploy(ctx(), input(site.dir, site.files));
    expect(fake.deployments.at(-1)!.files.has("docs/_redirects")).toBe(true);
    expect(fake.deployments.at(-1)!.config).not.toHaveProperty("_redirects");
  });

  it("the fake refuses a _redirects listed as a plain asset", async () => {
    fake = await startFakeCloudflare();
    const response = await fetch(`${fake.api}/accounts/${ACCOUNT}/workers/scripts/x/assets-upload-session`, {
      method: "POST",
      headers: { authorization: `Bearer ${fake.token}`, "content-type": "application/json" },
      body: JSON.stringify({ manifest: { "/_redirects": { hash: "0".repeat(32), size: 10 } } }),
    });

    expect(response.status).toBe(400);
    expect(await response.text()).toContain("must be passed in assets.config");
  });

  it("refuses redirects over Cloudflare's limits before uploading anything, naming the limit", async () => {
    fake = await startFakeCloudflare();
    const many = Array.from({ length: 2_001 }, (_, index) => `/old-${index} /new-${index} 301`).join("\n");
    const site = await built({ _redirects: many });

    await target.ensureProject(ctx(), { account: ACCOUNT, name: "lowfield" });
    const error = (await target.deploy(ctx(), input(site.dir, site.files)).catch((caught: unknown) => caught)) as Error & { reason: string };

    expect(error.reason).toBe("too-large");
    expect(error.message).toBe(
      "The site has 2,001 exact redirects, and Cloudflare takes up to 2,000 (plus 100 with wildcards). Nothing was uploaded. Trim the list on the Redirects screen, or use “Also set them on Cloudflare” there for the rest."
    );
    expect(fake.deployments).toHaveLength(0);
    expect(fake.log.some((entry) => entry.path.endsWith("assets-upload-session"))).toBe(false);

    expect(() => checkCloudflareRedirects(Array.from({ length: 101 }, (_, index) => `/tag/${index}/* /t/${index}/:splat 301`).join("\n"))).toThrow("101 redirects with wildcards");
    expect(() => checkCloudflareRedirects(`/a /${"x".repeat(1_000)} 301`)).toThrow("Line 1 of the site's redirects is 1,008 characters long, and Cloudflare takes redirects up to 1,000 characters each.");
    // Counted like Wrangler: comments and blanks don't count, and everything after the first dynamic rule is dynamic.
    expect(() => checkCloudflareRedirects(["# note", "", "/a/* /b 301", ...Array.from({ length: 99 }, (_, index) => `/s${index} /t 301`)].join("\n"))).not.toThrow();
    expect(() => checkCloudflareRedirects(["/a/* /b 301", ...Array.from({ length: 100 }, (_, index) => `/s${index} /t 301`)].join("\n"))).toThrow("Cloudflare takes up to 100");
  });
});

describe("Vercel: vercel.json rides along at the root of the deployment", () => {
  let fake: FakeVercel;
  const target = createVercelTarget();
  const ctx = (): DeployContext => ({ token: fake.token, fetch, apiBase: fake.url });

  afterEach(async () => fake?.close());

  it("uploads a routing-only copy of the site's vercel.json, so the redirects apply and build settings don't", async () => {
    fake = await startFakeVercel();
    const site = await built();
    const siteRoot = tempDir("deploy-vercel-site-");
    const redirects = [{ source: "/old-blog/:slug", destination: "/blog/:slug", permanent: true }];

    writeFileSync(join(siteRoot, "vercel.json"), JSON.stringify({ $schema: "https://openapi.vercel.sh/vercel.json", buildCommand: "astro build", outputDirectory: "dist", redirects, trailingSlash: true }, null, 2));
    await target.ensureProject(ctx(), { account: TEAM, name: "lowfield" });
    await target.deploy(ctx(), input(site.dir, site.files, { account: TEAM, siteRoot }));
    const deployed = fake.deployments.at(-1)!;

    expect(deployed.config).toEqual({ $schema: "https://openapi.vercel.sh/vercel.json", redirects, trailingSlash: true });
    expect([...deployed.files.keys()].sort()).toEqual([...Object.keys(PAGES), "vercel.json"].sort());
  });

  it("without a vercel.json nothing is added; a broken one is refused in plain words", async () => {
    fake = await startFakeVercel();
    const site = await built();
    const siteRoot = tempDir("deploy-vercel-site-");

    await target.ensureProject(ctx(), { account: TEAM, name: "lowfield" });
    await target.deploy(ctx(), input(site.dir, site.files, { account: TEAM, siteRoot }));
    expect(fake.deployments.at(-1)!.config).toBeNull();
    writeFileSync(join(siteRoot, "vercel.json"), "{ redirects: [");
    await expect(target.deploy(ctx(), input(site.dir, site.files, { account: TEAM, siteRoot }))).rejects.toMatchObject({ reason: "site-file", message: expect.stringContaining("vercel.json has a formatting mistake") });
  });

  it("keeps only the members that say how files are served", () => {
    expect(vercelRoutingConfig(JSON.stringify({ framework: "astro", installCommand: "npm ci" }))).toBeNull();
    expect(JSON.parse(vercelRoutingConfig(JSON.stringify({ headers: [{ source: "/(.*)", headers: [] }], cleanUrls: true, functions: {} }))!)).toEqual({ headers: [{ source: "/(.*)", headers: [] }], cleanUrls: true });
  });
});

describe("markdown copies of pages are served as text", () => {
  let cf: FakeCloudflare | null = null;
  let vercel: FakeVercel | null = null;
  const MD = { "about.md": "# About", "index.md": "# Home", "llms.txt": "# Site" };

  afterEach(async () => {
    await cf?.close();
    await vercel?.close();
    cf = vercel = null;
  });

  async function cloudflareConfig(extra: Record<string, string>) {
    cf = await startFakeCloudflare();
    const target = createCloudflareTarget();
    const ctx: DeployContext = { token: cf.token, fetch, apiBase: cf.api };
    const site = await built(extra);

    await target.ensureProject(ctx, { account: ACCOUNT, name: "lowfield" });
    await target.deploy(ctx, input(site.dir, site.files));
    const deployed = cf.deployments.at(-1)!;

    await cf.close();
    cf = null;
    return deployed;
  }

  it("Cloudflare: a text/markdown rule for /*.md when the site has none; .md files are uploaded as text/markdown too", async () => {
    const deployed = await cloudflareConfig(MD);

    expect(deployed.config._headers).toBe(CLOUDFLARE_MARKDOWN_RULE);
    expect(CLOUDFLARE_MARKDOWN_RULE).toBe("/*.md\n  Content-Type: text/markdown; charset=utf-8\n");
    expect(deployed.files.has("about.md")).toBe(true);
  });

  it("Cloudflare: merged after the site's own rules, never over a Content-Type rule the site wrote", async () => {
    const merged = await cloudflareConfig({ ...MD, _headers: HEADERS });

    expect(merged.config._headers).toBe(`${HEADERS}\n${CLOUDFLARE_MARKDOWN_RULE}`);
    const own = "/*\n  Content-Type: text/plain\n";

    expect((await cloudflareConfig({ ...MD, _headers: own })).config._headers).toBe(own);
    expect(withCloudflareMarkdownHeader("/docs/*.md\n  content-type: text/x-markdown\n")).toBe("/docs/*.md\n  content-type: text/x-markdown\n");
    // A rule for other paths doesn't count, and the 100-rule limit is respected.
    expect(withCloudflareMarkdownHeader("/fonts/x.woff2\n  Content-Type: font/woff2\n")).toContain(CLOUDFLARE_MARKDOWN_RULE);
    const full = Array.from({ length: 100 }, (_, index) => `/p${index}\n  X-A: b`).join("\n");

    expect(withCloudflareMarkdownHeader(full)).toBe(full);
    // No markdown in the output: no rule.
    expect((await cloudflareConfig({})).config).not.toHaveProperty("_headers");
  });

  it("Vercel: the same rule in the uploaded vercel.json, beside the site's redirects, never over its own", async () => {
    vercel = await startFakeVercel();
    const target = createVercelTarget();
    const ctx: DeployContext = { token: vercel.token, fetch, apiBase: vercel.url };
    const site = await built(MD);
    const siteRoot = tempDir("deploy-vercel-md-");

    await target.ensureProject(ctx, { account: TEAM, name: "lowfield" });
    await target.deploy(ctx, input(site.dir, site.files, { account: TEAM, siteRoot }));
    expect(vercel.deployments.at(-1)!.config).toEqual({ headers: [VERCEL_MARKDOWN_RULE] });

    const redirects = [{ source: "/a", destination: "/b", permanent: true }];

    writeFileSync(join(siteRoot, "vercel.json"), JSON.stringify({ redirects }));
    await target.deploy(ctx, input(site.dir, site.files, { account: TEAM, siteRoot }));
    expect(vercel.deployments.at(-1)!.config).toEqual({ redirects, headers: [VERCEL_MARKDOWN_RULE] });

    const own = [{ source: "/(.*)", headers: [{ key: "content-type", value: "text/plain" }] }];

    writeFileSync(join(siteRoot, "vercel.json"), JSON.stringify({ headers: own }));
    await target.deploy(ctx, input(site.dir, site.files, { account: TEAM, siteRoot }));
    expect(vercel.deployments.at(-1)!.config).toEqual({ headers: own });
  });
});
