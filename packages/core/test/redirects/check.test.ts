/**
 * Every way a list goes wrong, each found and said plainly; the import
 * review settles each kind as chosen; "try an address" follows the same
 * rules the files do.
 */
import { describe, expect, it } from "vitest";
import { checkRedirects, hostUsage, parseRedirects, reviewImport, routesFrom, traceAddress, canonicalOrder } from "../../src/redirects/index";
import type { Redirect } from "../../src/redirects/index";

const routes = routesFrom(
  [
    { url: "/", title: "Home" },
    { url: "/about/", title: "About us" },
    { url: "/contact/", title: "Contact" },
    { url: "/blog/", title: "Journal" },
    { url: "/blog/first-post/", title: "First post" },
  ],
  { files: (path) => path === "/files/brochure.pdf" }
);
const r = (from: string, to: string, status: Redirect["status"] = 301): Redirect => ({ from, to, status });
const codes = (list: Redirect[], host: Parameters<typeof checkRedirects>[1]["host"] = "cloudflare") => checkRedirects(list, { routes, host }).map((issue) => issue.code);

describe("checks", () => {
  it("duplicates: same old and new address twice", () => {
    const issues = checkRedirects([r("/a/", "/about/"), r("/a/", "/about/")], { routes, host: null });

    expect(issues.find((issue) => issue.code === "duplicate")).toMatchObject({ indices: [0, 1], severity: "warning" });
  });

  it("conflicts: same old address, different new ones — the first wins on every host", () => {
    const issue = checkRedirects([r("/a/", "/about/"), r("/a/", "/contact/")], { routes, host: null }).find((candidate) => candidate.code === "conflict");

    expect(issue).toMatchObject({ severity: "error", indices: [0, 1] });
    expect(issue!.message).toContain("/about/");
  });

  it("self-redirects, including ones that differ only by the slash or capitals", () => {
    expect(codes([r("/about/", "/about/")])).toContain("self");
    expect(codes([r("/About", "/about/")])).toContain("self");
  });

  it("chains: offers the final address", () => {
    const issue = checkRedirects([r("/a/", "/b/"), r("/b/", "/c/"), r("/c/", "/contact/")], { routes, host: null }).find((candidate) => candidate.code === "chain" && candidate.indices[0] === 0);

    expect(issue).toMatchObject({ suggestion: "/contact/", severity: "warning" });
    expect(issue!.message).toContain("3 steps");
  });

  it("loops: refused, once per loop, with every member", () => {
    const issues = checkRedirects([r("/a/", "/b/"), r("/b/", "/c/"), r("/c/", "/a/")], { routes, host: null }).filter((issue) => issue.code === "loop");

    expect(issues).toHaveLength(1);
    expect(issues[0]!.indices.sort()).toEqual([0, 1, 2]);
    expect(issues[0]!.severity).toBe("error");
  });

  it("live pages: names the page that would disappear; wildcards count the pages they hide", () => {
    const exact = checkRedirects([r("/about/", "/contact/")], { routes, host: null }).find((issue) => issue.code === "live-page");
    const wildcard = checkRedirects([r("/blog/*", "/journal/:splat")], { routes, host: null }).find((issue) => issue.code === "live-page");

    expect(exact).toMatchObject({ detail: "About us" });
    expect(exact!.message).toContain("“About us”");
    expect(wildcard!.message).toMatch(/hides 2 live pages/);
  });

  it("broken targets: nothing there, or the page written differently", () => {
    const issues = checkRedirects([r("/x/", "/nowhere/"), r("/y/", "/About"), r("/z/", "/files/brochure.pdf"), r("/w/", "https://elsewhere.example/")], { routes, host: null }).filter((issue) => issue.code === "broken-target");

    expect(issues.map((issue) => issue.indices[0])).toEqual([0, 1]);
    expect(issues[1]!.suggestion).toBe("/about/");
  });

  it("a new address that is itself redirected is a chain, not a broken target", () => {
    expect(codes([r("/a/", "/old-name/"), r("/old-name/", "/about/")])).not.toContain("broken-target");
  });

  it("query strings on old addresses: said per host", () => {
    const cloudflare = checkRedirects([r("/?p=1", "/blog/")], { routes, host: "cloudflare" }).find((issue) => issue.code === "from-query")!;
    const netlify = checkRedirects([r("/?p=1", "/blog/")], { routes, host: "netlify" }).find((issue) => issue.code === "from-query")!;

    expect(cloudflare.severity).toBe("warning");
    expect(cloudflare.message).toMatch(/left out of Cloudflare's file/);
    expect(netlify.message).toMatch(/Netlify matches it only/);
  });

  it("case twins", () => {
    expect(codes([r("/Team/", "/about/"), r("/team/", "/about/")])).toContain("case-twin");
  });

  it("wildcard order: a general wildcard written first is reported (files are written specific-first)", () => {
    expect(codes([r("/blog/*", "/journal/:splat"), r("/blog/2020/*", "/archive/:splat")])).toContain("shadowed");
    expect(canonicalOrder([r("/blog/*", "/journal/:splat"), r("/blog/2020/*", "/archive/:splat"), r("/b/", "/about/")]).map((redirect) => redirect.from)).toEqual(["/b/", "/blog/2020/*", "/blog/*"]);
  });

  it("host limits: Cloudflare's 2,000 exact and 100 wildcard redirects", () => {
    const many = Array.from({ length: 2001 }, (_, index) => r(`/old-${index}/`, "/about/"));
    const wild = Array.from({ length: 101 }, (_, index) => r(`/w${index}/*`, "/about/"));

    expect(hostUsage(many, "cloudflare").over).toBe(true);
    expect(hostUsage(wild, "cloudflare").over).toBe(true);
    expect(hostUsage(many.slice(0, 2000), "cloudflare").over).toBe(false);
    expect(checkRedirects(many, { routes, host: "cloudflare" }).find((issue) => issue.code === "host-limit")!.message).toMatch(/2,001 exact addresses \(the limit is 2,000\)/);
    expect(hostUsage(Array.from({ length: 2049 }, (_, index) => r(`/o${index}/`, "/")), "vercel").over).toBe(true);
  });

  it("Netlify's statuses: 307/308 are written as 302/301 and said so", () => {
    expect(codes([r("/a/", "/about/", 308)], "netlify")).toContain("host-unsupported");
  });
});

describe("import review", () => {
  const existing = [r("/kept/", "/about/"), r("/old-team/", "/contact/")];
  const text = [
    "/a/ /b/ 301",
    "/b/ /contact/ 301",
    "/dup/ /about/ 301",
    "/dup/ /about/ 301",
    "/old-team/ /about/ 301",
    "/about/ /contact/ 301",
    "/loop1/ /loop2/ 301",
    "/loop2/ /loop1/ 301",
    "/no-kind/ /about/",
    "/missing/ /nowhere/ 301",
    "/same/ /same/ 301",
    "not a line",
  ].join("\n");
  const parsed = parseRedirects(text, { siteHosts: [], trailingSlash: "always" });

  it("groups problems, blocks on loops, and changes nothing until confirmed", () => {
    const { review } = reviewImport(existing, parsed, { mode: "add", routes, host: "cloudflare" });
    const byCode = Object.fromEntries(review.problems.map((problem) => [problem.code, problem]));

    expect(review.blocking).toBe(1);
    expect(byCode.loop!.severity).toBe("error");
    expect(byCode.duplicate!.count).toBe(1);
    expect(byCode.conflict!.count).toBe(1);
    expect(byCode.chain!.count).toBe(1);
    expect(byCode["live-page"]!.count).toBe(1);
    expect(byCode["missing-status"]!.count).toBe(1);
    expect(byCode["broken-target"]!.count).toBe(1);
    expect(byCode.self!.count).toBe(1);
    expect(byCode.malformed!.examples[0]).toMatchObject({ line: 12 });
  });

  it("applies the chosen resolutions", () => {
    const { result, review } = reviewImport(existing, parsed, {
      mode: "add",
      routes,
      host: "cloudflare",
      resolutions: { loops: "leave-out", conflicts: "keep-last", livePages: "keep", missingStatus: 302, chains: "flatten", brokenTargets: "leave-out" },
    });
    const by = Object.fromEntries(result.map((redirect) => [redirect.from, redirect]));

    expect(review.blocking).toBe(0);
    expect(by["/loop1/"]).toBeUndefined();
    // Its new address won, then /about/ (kept although it's a live page) is redirected too, so the chain is flattened.
    expect(by["/old-team/"]!.to).toBe("/contact/");
    expect(by["/about/"]!.to).toBe("/contact/");
    expect(by["/no-kind/"]!.status).toBe(302);
    expect(by["/a/"]!.to).toBe("/contact/");
    expect(by["/missing/"]).toBeUndefined();
    expect(by["/same/"]).toBeUndefined();
    expect(by["/kept/"]).toBeDefined();
  });

  it("the defaults: the list's own redirect wins, live pages and self-redirects stay out", () => {
    const { result } = reviewImport(existing, parsed, { mode: "add", routes, host: "cloudflare", resolutions: { loops: "leave-out" } });
    const by = Object.fromEntries(result.map((redirect) => [redirect.from, redirect]));

    expect(by["/old-team/"]!.to).toBe("/contact/");
    expect(by["/about/"]).toBeUndefined();
  });

  it("replace mode starts from an empty list", () => {
    const { result } = reviewImport(existing, parsed, { mode: "replace", routes, host: "cloudflare", resolutions: { loops: "leave-out" } });

    expect(result.some((redirect) => redirect.from === "/kept/")).toBe(false);
  });

  it("is deterministic: the same input reviews to the same list", () => {
    const one = reviewImport(existing, parsed, { mode: "add", routes, host: null, resolutions: { loops: "leave-out" } }).result;
    const two = reviewImport(existing, parsed, { mode: "add", routes, host: null, resolutions: { loops: "leave-out" } }).result;

    expect(one).toEqual(two);
  });
});

describe("try an address", () => {
  const list = [r("/old/", "/older/"), r("/older/", "/about/"), r("/blog/*", "/journal/:splat"), r("/away/", "https://elsewhere.example/x", 302), r("/l1/", "/l2/"), r("/l2/", "/l1/")];
  const ctx = { siteHosts: ["lowfield.example"], trailingSlash: "always" as const, routes, host: "cloudflare" as const };

  it("follows every hop to the final page", () => {
    const trace = traceAddress(list, "https://lowfield.example/old/", ctx);

    expect(trace.hops.map((hop) => hop.to)).toEqual(["/older/", "/about/"]);
    expect(trace).toMatchObject({ final: "/about/", finalKind: "page", finalTitle: "About us", loop: false });
  });

  it("fills in what the wildcard matched", () => {
    expect(traceAddress(list, "/blog/2020/a-post/", ctx).final).toBe("/journal/2020/a-post/");
  });

  it("reports loops, external addresses, near misses and other domains", () => {
    expect(traceAddress(list, "/l1/", ctx).loop).toBe(true);
    expect(traceAddress(list, "/away/", ctx).finalKind).toBe("external");
    expect(traceAddress(list, "/old", ctx)).toMatchObject({ hops: [], nearMiss: "/old/", finalKind: "unchanged" });
    expect(traceAddress(list, "https://other.example/old/", ctx).otherDomain).toBe("other.example");
  });

  it("Netlify ignores the trailing slash, so the near miss matches there", () => {
    expect(traceAddress(list, "/old", { ...ctx, host: "netlify" }).final).toBe("/about/");
  });
});
