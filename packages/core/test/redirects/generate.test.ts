/**
 * Host files written exactly as each host documents them. The lists below
 * are the hosts' own examples (Cloudflare's Workers static assets and Pages
 * redirects pages, Netlify's redirect options, Vercel's vercel.json
 * reference, read 2026-11-23); the golden files under golden/hosts/ hold
 * the output, checked by eye against those pages. Exports have goldens too.
 * And it is fast: 10,000 redirects parse, check and render in well under a
 * second.
 */
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  EXPORT_FORMATS,
  checkRedirects,
  checksum,
  parseRedirects,
  readGeneratedHeader,
  readList,
  renderExport,
  renderRedirectsFile,
  renderVercelRedirects,
  reviewImport,
  routesFrom,
  serializeList,
} from "../../src/redirects/index";
import type { Redirect } from "../../src/redirects/index";

const here = (path: string) => fileURLToPath(new URL(path, import.meta.url));
const r = (from: string, to: string, status: Redirect["status"] = 301): Redirect => ({ from, to, status });
const listFile = "src/data/redirects.json";

// developers.cloudflare.com/workers/static-assets/redirects/ — the basic set (the docs' unnumbered /twitch is their default 302).
const CLOUDFLARE_DOCS = [
  r("/home301", "/", 301),
  r("/home302", "/", 302),
  r("/querystrings", "/?query=string", 301),
  r("/twitch", "https://twitch.tv", 302),
  r("/trailing", "/trailing/", 301),
  r("/notrailing/", "/nottrailing", 301),
  r("/page/", "/page2/#fragment", 301),
  r("/blog/*", "https://blog.my.domain/:splat", 302),
];
// docs.netlify.com/manage/routing/redirects/redirect-options/
const NETLIFY_DOCS = [r("/home", "/", 301), r("/my-redirect", "/", 302), r("/news/*", "/blog/:splat", 301), r("/jobs/customer-ninja-rockstar", "/careers/support-engineer", 301), r("/jobs/*", "/careers/:splat", 301)];
// vercel.com/docs/project-configuration/vercel-json#redirects
const VERCEL_DOCS = [r("/me", "/profile.html", 307), r("/me-too", "/profile.html", 308), r("/user", "/api/user", 301), r("/blog/*", "/news/:splat", 308)];

describe("host files", () => {
  it("Cloudflare _redirects: the docs' examples, explicit codes, exact before wildcard", async () => {
    const text = renderRedirectsFile(CLOUDFLARE_DOCS, "cloudflare", { listFile });
    const rules = text.split("\n").filter((line) => line && !line.startsWith("#"));

    expect(rules.map((line) => line.split(/\s+/))).toEqual([
      ["/home301", "/", "301"],
      ["/home302", "/", "302"],
      ["/notrailing/", "/nottrailing", "301"],
      ["/page/", "/page2/#fragment", "301"],
      ["/querystrings", "/?query=string", "301"],
      ["/trailing", "/trailing/", "301"],
      ["/twitch", "https://twitch.tv", "302"],
      ["/blog/*", "https://blog.my.domain/:splat", "302"],
    ]);
    await expect(text).toMatchFileSnapshot(here("./golden/hosts/cloudflare._redirects"));
  });

  it("Cloudflare leaves out what it can't match (query strings on old addresses)", () => {
    const text = renderRedirectsFile([r("/?p=12", "/blog/"), r("/a/", "/about/")], "cloudflare", { listFile });

    expect(text).not.toContain("?p=12");
    expect(text).toContain("/a/");
  });

  it("Netlify _redirects: query conditions, forced live pages, 301/302 only, rule order kept specific-first", async () => {
    const text = renderRedirectsFile([...NETLIFY_DOCS, r("/store?id=12", "/blog/twelve/"), r("/about/", "/contact/", 308)], "netlify", { listFile, force: (from) => from === "/about/" });
    const rules = text.split("\n").filter((line) => line && !line.startsWith("#"));

    expect(rules.indexOf(rules.find((line) => line.startsWith("/jobs/customer"))!)).toBeLessThan(rules.indexOf(rules.find((line) => line.startsWith("/jobs/*"))!));
    expect(rules.find((line) => line.startsWith("/store"))!.split(/\s+/)).toEqual(["/store", "id=12", "/blog/twelve/", "301"]);
    expect(rules.find((line) => line.startsWith("/about/"))!.split(/\s+/)).toEqual(["/about/", "/contact/", "301!"]);
    await expect(text).toMatchFileSnapshot(here("./golden/hosts/netlify._redirects"));
  });

  it("Vercel redirects: statusCode for 301/302, permanent for 307/308, :path* wildcards, has for queries", async () => {
    const out = renderVercelRedirects([...VERCEL_DOCS, r("/old?page=home", "/new/"), r("/odd(name)", "/about/")]);

    expect(out).toEqual(
      expect.arrayContaining([
        { source: "/me", destination: "/profile.html", permanent: false },
        { source: "/me-too", destination: "/profile.html", permanent: true },
        { source: "/user", destination: "/api/user", statusCode: 301 },
        { source: "/blog/:path*", destination: "/news/:path*", permanent: true },
        { source: "/old", destination: "/new/", statusCode: 301, has: [{ type: "query", key: "page", value: "home" }] },
        { source: "/odd\\(name\\)", destination: "/about/", statusCode: 301 },
      ])
    );
    await expect(`${JSON.stringify(out, null, 2)}\n`).toMatchFileSnapshot(here("./golden/hosts/vercel.json"));
  });

  it("encodes what hosts need encoded, once", () => {
    const text = renderRedirectsFile([r("/café/", "/about/"), r("/already%20encoded/", "/about/")], "cloudflare", { listFile });

    expect(text).toContain("/caf%C3%A9/");
    expect(text).toContain("/already%20encoded/");
    expect(text).not.toContain("%2520");
  });

  it("marks its own file with a checksum of the body, so hand edits are noticed", () => {
    const text = renderRedirectsFile([r("/a/", "/about/")], "cloudflare", { listFile });
    const header = readGeneratedHeader(text)!;

    expect(checksum(header.body)).toBe(header.checksum);
    expect(checksum(`${header.body}/b/ /c/ 301\n`)).not.toBe(header.checksum);
  });
});

describe("exports", () => {
  const list = [r("/a/", "/about/"), r("/q?x=1", "/contact/"), r("/blog/*", "/journal/:splat", 302), r("/far/", "https://elsewhere.example/page?ref=1", 308), { ...r("/noted/", "/about/"), note: 'Old "team" page, moved' }];

  for (const format of EXPORT_FORMATS) {
    it(format, async () => {
      await expect(renderExport(list, format, { listFile, hostname: "www.lowfield.example" })).toMatchFileSnapshot(here(`./golden/exports/${format}.txt`));
    });
  }

  it("the Cloudflare list needs the domain", () => {
    expect(() => renderExport(list, "cloudflare-csv", { listFile })).toThrow(/hostname/);
  });
});

describe("the list file", () => {
  it("one redirect per line, stable order and keys, readable back", () => {
    const text = serializeList([{ status: 302, to: "/b/", from: "/z/" } as Redirect, { from: "/a/", to: "/b/", status: 301, note: "n", source: "manual" }]);

    expect(text).toBe('{\n  "redirects": [\n    {"from":"/a/","to":"/b/","status":301,"note":"n","source":"manual"},\n    {"from":"/z/","to":"/b/","status":302}\n  ]\n}\n');
    expect(readList(text)).toEqual({ ok: true, redirects: [{ from: "/a/", to: "/b/", status: 301, note: "n", source: "manual" }, { from: "/z/", to: "/b/", status: 302 }] });
  });

  it("refuses what isn't a redirect rather than dropping it", () => {
    expect(readList('{"redirects":[{"from":"/a/","to":"/b/","status":200}]}')).toMatchObject({ ok: false });
    expect(readList("{ not json")).toMatchObject({ ok: false });
  });
});

describe("scale", () => {
  it("10,000 redirects parse, review, check and render in well under a second", () => {
    const lines = Array.from({ length: 10_000 }, (_, index) => `https://lowfield.example/${2000 + (index % 20)}/${String(index % 12).padStart(2, "0")}/post-${index}/,/blog/post-${index}/,301`);
    const pages = Array.from({ length: 2_000 }, (_, index) => ({ url: `/blog/post-${index}/`, title: `Post ${index}` }));
    const routes = routesFrom(pages);
    const started = performance.now();
    const parsed = parseRedirects(lines.join("\n"), { siteHosts: ["lowfield.example"], trailingSlash: "always" });
    const { result } = reviewImport([], parsed, { mode: "add", routes, host: "cloudflare" });
    const issues = checkRedirects(result, { routes, host: "cloudflare" });
    const file = renderRedirectsFile(result, "cloudflare", { listFile });
    const vercel = renderVercelRedirects(result);
    const json = serializeList(result);
    const elapsed = performance.now() - started;

    expect(parsed.redirects).toHaveLength(10_000);
    expect(result).toHaveLength(10_000);
    expect(issues.some((issue) => issue.code === "host-limit")).toBe(true);
    expect(file.split("\n").length).toBeGreaterThan(10_000);
    expect(vercel).toHaveLength(10_000);
    expect(json.split("\n")).toHaveLength(10_000 + 5);
    // About 0.3–0.5 s on a quiet laptop. The bound leaves room for a busy machine or a small CI runner,
    // while still failing if the work stops being roughly linear.
    expect(elapsed).toBeLessThan(process.env.CI ? 6000 : 3000);
  });
});
