/** The pure pieces: widths, robots rules, the policy edit, sitemaps, llms.txt, HTML facts, similarity, the fact guard. */
import { describe, expect, it } from "vitest";
import { parseLlmsTxt, parseRedirects, parseSitemap, pathKey } from "../../src/seo/files";
import { parsePage } from "../../src/seo/html";
import { CRAWLERS, crawlerStatus, isAllowed, parseRobots, planRobotsPolicy, POLICY_END, POLICY_START, summarizeCrawlers } from "../../src/seo/robots";
import { fitWidth, jaccard, shingles, similarPairs, textWidth } from "../../src/seo/text";
import { inventedFacts } from "../../src/seo/write";
import { withoutBrand } from "../../src/seo/content-checks";

describe("pixel widths", () => {
  it("measures with Arial's advance widths, not characters", () => {
    // H 722 + e 556 + l 222 + l 222 + o 556 = 2278 units → 45.56 px at 20 px.
    expect(textWidth("Hello", 20)).toBe(46);
    // Ten characters each, fourfold apart: why a character count misleads.
    expect(textWidth("iiiiiiiiii", 20)).toBe(44);
    expect(textWidth("WWWWWWWWWW", 20)).toBe(189);
    expect(textWidth("Lowfield Studio — architecture for the homes people already love", 20)).toBe(578);
  });

  it("cuts at a word with an ellipsis when it doesn't fit", () => {
    const fitted = fitWidth("What a measured survey tells you before anything gets knocked down · Lowfield Studio", 20, 600);

    expect(fitted.cut).toBe(true);
    expect(fitted.width).toBe(774);
    expect(fitted.shown).toBe("What a measured survey tells you before anything gets knocked …");
    expect(fitWidth("Short title", 20, 600)).toEqual({ shown: "Short title", width: textWidth("Short title", 20), cut: false });
  });
});

describe("robots.txt", () => {
  const text = [
    "User-agent: *",
    "Disallow: /private/",
    "Allow: /private/press/",
    "",
    "User-agent: GPTBot",
    "User-agent: CCBot",
    "Disallow: /",
    "",
    "user-agent: oai-searchbot # case doesn't matter",
    "Allow: /",
    "Disallow: /*.pdf$",
    "",
    "Sitemap: https://harbour.test/sitemap.xml",
  ].join("\n");
  const file = parseRobots(text);

  it("groups agents, keeps sitemaps, and matches the longest rule (Allow wins a tie)", () => {
    expect(file.sitemaps).toEqual(["https://harbour.test/sitemap.xml"]);
    expect(isAllowed(file, "Googlebot", "/private/notes")).toEqual({ allowed: false, by: "wildcard" });
    expect(isAllowed(file, "Googlebot", "/private/press/kit")).toEqual({ allowed: true, by: "wildcard" });
    expect(isAllowed(file, "GPTBot", "/")).toEqual({ allowed: false, by: "rule" });
    expect(isAllowed(file, "ccbot", "/anything")).toEqual({ allowed: false, by: "rule" });
    expect(isAllowed(file, "OAI-SearchBot", "/menu.pdf").allowed).toBe(false);
    expect(isAllowed(file, "OAI-SearchBot", "/menu.pdf?x=1").allowed).toBe(true);
    expect(isAllowed(parseRobots("User-agent: *\nDisallow: /a\nAllow: /a"), "x", "/a").allowed).toBe(true);
    expect(isAllowed(parseRobots("User-agent: *\nDisallow:"), "x", "/").allowed).toBe(true);
  });

  it("knows the documented AI crawler tokens and says the policy plainly", () => {
    expect(CRAWLERS.map((c) => c.token)).toEqual(["OAI-SearchBot", "GPTBot", "ChatGPT-User", "Claude-SearchBot", "ClaudeBot", "Claude-User", "PerplexityBot", "Perplexity-User", "Google-Extended", "Applebot-Extended", "CCBot"]);
    const statuses = crawlerStatus(file);

    expect(statuses.find((s) => s.token === "OAI-SearchBot")).toMatchObject({ allowed: true, decidedBy: "rule" });
    expect(statuses.find((s) => s.token === "ClaudeBot")).toMatchObject({ allowed: true, decidedBy: "wildcard" });
    expect(summarizeCrawlers(statuses)[0]).toBe("OpenAI: ChatGPT's search crawler is allowed; OpenAI's training crawler is blocked; ChatGPT fetching a page for someone is allowed.");
    expect(crawlerStatus(null).every((s) => s.allowed && s.decidedBy === "default")).toBe(true);
  });

  it("changes only a marked block, appended once, and nothing else", () => {
    const original = "User-agent: *\nAllow: /\n\nSitemap: https://harbour.test/sitemap.xml\n";
    const first = planRobotsPolicy(original, { GPTBot: "block", ClaudeBot: "block", "OAI-SearchBot": "allow" });

    if (!first.ok) throw new Error(first.reason);
    expect(first.text.startsWith(original)).toBe(true);
    expect(first.text.slice(original.length)).toBe(`\n${POLICY_START}\nUser-agent: GPTBot\nDisallow: /\n\nUser-agent: ClaudeBot\nDisallow: /\n${POLICY_END}\n`);
    // Allowing a crawler the * group already allows writes nothing for it.
    const again = planRobotsPolicy(first.text, { ClaudeBot: "allow" });

    if (!again.ok) throw new Error(again.reason);
    expect(again.text).toBe(`${original}\n${POLICY_START}\nUser-agent: GPTBot\nDisallow: /\n${POLICY_END}\n`);
    const cleared = planRobotsPolicy(again.text, { GPTBot: "allow" });

    if (!cleared.ok) throw new Error(cleared.reason);
    expect(cleared.text).toBe(original);
    // Under a blocking * group, "allow" needs its own group.
    const strict = planRobotsPolicy("User-agent: *\nDisallow: /\n", { "OAI-SearchBot": "allow" });

    expect(strict.ok && strict.text).toContain("User-agent: OAI-SearchBot\nAllow: /");
  });

  it("refuses to contradict a rule someone wrote by hand", () => {
    const plan = planRobotsPolicy("User-agent: GPTBot\nDisallow: /\n", { GPTBot: "allow" });

    expect(plan.ok).toBe(false);
    expect(plan.ok ? "" : plan.reason).toMatch(/already has its own rules for GPTBot/);
    expect(planRobotsPolicy("User-agent: GPTBot\nDisallow: /\n", { GPTBot: "block" })).toEqual({ ok: true, text: "User-agent: GPTBot\nDisallow: /\n", changed: false });
    expect(planRobotsPolicy("", { NotABot: "block" }).ok).toBe(false);
  });
});

describe("site files", () => {
  it("reads sitemaps and sitemap indexes", () => {
    expect(parseSitemap('<urlset><url><loc>https://a.test/x/?a=1&amp;b=2</loc><lastmod>2026-01-02</lastmod></url></urlset>')).toEqual({ urls: [{ loc: "https://a.test/x/?a=1&b=2", lastmod: "2026-01-02" }], sitemaps: [] });
    expect(parseSitemap("<sitemapindex><sitemap><loc>https://a.test/s-0.xml</loc></sitemap></sitemapindex>").sitemaps).toEqual(["https://a.test/s-0.xml"]);
  });

  it("reads llms.txt as the proposal describes it", () => {
    const parsed = parseLlmsTxt("# Harbour Bakery\n\n> A bakery.\n\n## Pages\n\n- [About](https://a.test/about.md): who we are\n- [Menu](/menu.md)\n\n## Optional\n\n- [Old](/old.md)\n");

    expect(parsed).toMatchObject({ title: "Harbour Bakery", summary: "A bakery.", problems: [] });
    expect(parsed.links.map((l) => `${l.section}:${l.url}`)).toEqual(["Pages:https://a.test/about.md", "Pages:/menu.md", "Optional:/old.md"]);
    expect(parseLlmsTxt("Harbour Bakery\n").problems[0]).toMatch(/top-level heading/);
    expect(parseLlmsTxt("<!doctype html><html>").problems).toHaveLength(2);
  });

  it("reads plain one-to-one redirects and skips wildcards", () => {
    expect(parseRedirects("netlify.toml", '[[redirects]]\nfrom = "/old/"\nto = "/new/"\n\n[[redirects]]\nfrom = "/blog/*"\nto = "/journal/:splat"\n')).toEqual([{ from: "/old/", to: "/new/", status: 301 }]);
    expect(parseRedirects("public/_redirects", "/a /b 302\n/c/* /d 301\n# note\n/e /f 200\n")).toEqual([{ from: "/a", to: "/b", status: 302 }]);
    expect(parseRedirects("vercel.json", JSON.stringify({ redirects: [{ source: "/x", destination: "/y", permanent: true }] }))).toEqual([{ from: "/x", to: "/y", status: 308 }]);
    expect(pathKey("/about/index.html")).toBe(pathKey("/about"));
  });
});

describe("rendered pages", () => {
  it("reads head tags, headings, images, links and structured data", () => {
    const facts = parsePage(
      '<html lang="en"><head><title>Menu &amp; prices · Bakery</title><meta name="description" content="What we bake."><link rel="canonical" href="https://a.test/menu/"><link rel="alternate" type="text/markdown" href="/menu/index.md"><script type="application/ld+json">{"@type":"WebSite","name":"Bakery"}</script><script type="application/ld+json">{"broken": </script></head>' +
        '<body><h1>Menu</h1><svg><title>icon</title></svg><h3 id="cakes">Cakes</h3><img src="/a.png" width="10" height="10"><img src="/b.png" alt=""><a href="/x/"><span role="img" aria-label="Ostrell"></span></a><a href="#cakes">Cakes</a><a href="/y/"><svg aria-hidden="true"></svg></a><script>document.write("hidden")</script><noscript>Turn on scripts</noscript></body></html>'
    );

    expect(facts.title).toBe("Menu & prices · Bakery");
    expect(facts.metas.get("description")).toBe("What we bake.");
    expect(facts.links.find((l) => l.rel === "alternate")).toEqual({ rel: "alternate", href: "/menu/index.md", type: "text/markdown" });
    expect(facts.headings).toEqual([{ level: 1, text: "Menu" }, { level: 3, text: "Cakes" }]);
    expect(facts.images.map((i) => i.alt)).toEqual([null, ""]);
    expect(facts.anchors.map((a) => [a.href, a.text || a.imageAlt])).toEqual([["/x/", "Ostrell"], ["#cakes", "Cakes"], ["/y/", ""]]);
    expect(facts.jsonld[0]!.value).toEqual({ "@type": "WebSite", name: "Bakery" });
    expect(facts.jsonld[1]!.error).toBeTruthy();
    expect(facts.ids.has("cakes")).toBe(true);
    expect(facts.text).not.toMatch(/hidden|icon/);
    expect(facts.text).toMatch(/Turn on scripts/);
  });
});

describe("near-duplicates", () => {
  const base = "Fresh sourdough every morning from the harbour bakery, shaped by hand and baked in a stone oven before the town wakes up and the boats come in.";

  it("finds pairs above the threshold, confirms them exactly, and ignores the rest", () => {
    const docs = [
      { id: "a", shingles: shingles(`${base} ${base} Order cakes in person.`) },
      { id: "b", shingles: shingles(`${base} ${base} Order cakes by email.`) },
      { id: "c", shingles: shingles("A completely different page about knitting jumpers for lifeboat crews in the winter months, with patterns and wool.") },
    ];
    const pairs = similarPairs(docs, 0.8);

    expect(pairs.map((p) => `${p.a}-${p.b}`)).toEqual(["a-b"]);
    expect(pairs[0]!.similarity).toBeCloseTo(jaccard(docs[0]!.shingles, docs[1]!.shingles), 6);
    expect(jaccard(docs[0]!.shingles, docs[2]!.shingles)).toBe(0);
  });
});

describe("the fact guard", () => {
  it("catches figures, money and addresses the page doesn't state", () => {
    const page = "Open from 7:30 every day except Monday. A loaf is £4.50. Orders by email to orders@bakery.test.";

    expect(inventedFacts("Fresh bread from 7:30, loaves £4.50.", page)).toEqual([]);
    expect(inventedFacts("Loaves from £3, 20% off on Fridays, since 1998.", page)).toEqual(["£3", "20%", "1998"]);
    expect(inventedFacts("Write to hello@bakery.test", page)).toEqual(["hello@bakery.test"]);
  });

  it("takes a site name off a title only where it sits with a separator", () => {
    expect(withoutBrand("The October apple cake | Harbour Bakery", "Harbour Bakery")).toBe("The October apple cake");
    expect(withoutBrand("Harbour Bakery — bread on the quay", "Harbour Bakery")).toBe("bread on the quay");
    expect(withoutBrand("About Harbour Bakery", "Harbour Bakery")).toBeNull();
  });
});
