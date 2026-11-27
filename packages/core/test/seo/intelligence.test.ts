import { existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import type Anthropic from "@anthropic-ai/sdk";
import { afterAll, afterEach, describe, expect, it } from "vitest";
import { createEventBus } from "../../src/site/index";
import { createSettingsService } from "../../src/ai/settings";
import {
  buildSearchAuthHeader,
  createVisibilityService,
  normalizeDomain,
  scrubSearchError,
  searchDataMetaFromEnv,
} from "../../src/seo";
import { disposeAll, openSite } from "../site/helpers";
import { tempDir } from "../workspace/helpers";
import { cleanFiles, makeFixture } from "./fixture";

afterAll(() => disposeAll());

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

describe("search intelligence helpers", () => {
  it("builds Basic auth for BYOK (login:password or base64) and Bearer auth for managed mode", () => {
    expect(buildSearchAuthHeader("alice@example.com:s3cret", false)).toBe(
      `Basic ${Buffer.from("alice@example.com:s3cret", "utf8").toString("base64")}`
    );
    expect(buildSearchAuthHeader("dXNlcjpwYXNz", false)).toBe("Basic dXNlcjpwYXNz");
    expect(buildSearchAuthHeader("Basic dXNlcjpwYXNz", false)).toBe("Basic dXNlcjpwYXNz");
    expect(buildSearchAuthHeader("cloud-tok-1234", true)).toBe("Bearer cloud-tok-1234");
    expect(buildSearchAuthHeader("Bearer cloud-tok-1234", true)).toBe("Bearer cloud-tok-1234");
  });

  it("scrubs secrets, vendor names, and upstream endpoints from error messages", () => {
    const scrubbed = scrubSearchError(
      "DataForSEO request to https://api.dataforseo.com/v3/serp failed: token=supersecret123456",
      "https://api.dataforseo.com/v3"
    );

    expect(scrubbed.toLowerCase()).not.toContain("dataforseo");
    expect(scrubbed).not.toContain("https://api.");
    expect(scrubbed).not.toContain("supersecret123456");
  });

  it("exposes searchData meta only when GALLEY_SEARCH_DATA_MANAGED=1", () => {
    expect(searchDataMetaFromEnv({})).toBeUndefined();
    expect(searchDataMetaFromEnv({ GALLEY_SEARCH_DATA_MANAGED: "1" })).toEqual({ managed: true });
    expect(searchDataMetaFromEnv({ GALLEY_SEARCH_DATA_MANAGED: "1", GALLEY_SEARCH_DATA_OFF: "1" })).toEqual({
      managed: true,
      disabled: true,
    });
  });

  it("normalizes domains cleanly", () => {
    expect(normalizeDomain("https://www.Example.COM/pricing/")).toBe("example.com");
    expect(normalizeDomain("not a domain")).toBe("");
  });
});

describe("search intelligence engine", () => {
  const dirs: string[] = [];

  afterEach(() => {
    while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true });
  });

  async function setup(env: NodeJS.ProcessEnv, fetchImpl: typeof fetch, client?: Anthropic) {
    const files = cleanFiles();

    files["public/_redirects"] = "/already-moved/ /about/ 301\n";
    const siteRoot = makeFixture(files);
    const home = tempDir("seo-intel-home-");

    dirs.push(siteRoot, home);
    const events = createEventBus();
    const settings = createSettingsService({ home, env });
    const { site } = await openSite(siteRoot);
    const visibility = createVisibilityService({ home, settings, events, env, fetch: fetchImpl, ...(client ? { client } : {}) });

    return { siteRoot, home, settings, site, visibility };
  }

  it("fetches rankings, striking-distance wins, cannibalization, competitor gaps, 404 backlink recovery, and degrades cleanly on 402 llm_mentions", async () => {
    const seen: Array<{ url: string; auth: string | null }> = [];
    const scriptedFetch: typeof fetch = async (input, init) => {
      const url = String(input);
      const auth = new Headers(init?.headers).get("authorization");

      seen.push({ url, auth });
      if (url.endsWith("dataforseo_labs/google/ranked_keywords/live")) {
        return jsonResponse({
          tasks: [
            {
              status_code: 20000,
              result: [
                {
                  items: [
                    {
                      keyword_data: {
                        keyword: "overnight sourdough dough",
                        keyword_info: { search_volume: 1600, cpc: 1.2 },
                        keyword_properties: { keyword_difficulty: 22 },
                        search_intent_info: { main_intent: "informational" },
                      },
                      ranked_serp_element: {
                        serp_item: {
                          rank_group: 6,
                          url: "https://harbour-bakery.test/blog/overnight-dough/",
                          etv: 96,
                          rank_changes: { previous_rank_group: 9 },
                        },
                      },
                    },
                    {
                      keyword_data: {
                        keyword: "portwenn sourdough bakery",
                        keyword_info: { search_volume: 800, cpc: 2.0 },
                        keyword_properties: { keyword_difficulty: 18 },
                        search_intent_info: { main_intent: "commercial" },
                      },
                      ranked_serp_element: {
                        serp_item: { rank_group: 2, url: "https://harbour-bakery.test/", etv: 200 },
                      },
                    },
                    {
                      keyword_data: {
                        keyword: "portwenn sourdough bakery",
                        keyword_info: { search_volume: 800 },
                      },
                      ranked_serp_element: {
                        serp_item: { rank_group: 11, url: "https://harbour-bakery.test/about/", etv: 12 },
                      },
                    },
                  ],
                },
              ],
            },
          ],
        });
      }
      if (url.endsWith("dataforseo_labs/google/domain_intersection/live")) {
        return jsonResponse({
          tasks: [
            {
              status_code: 20000,
              result: [
                {
                  items: [
                    {
                      keyword_data: {
                        keyword: "sourdough starter feeding guide",
                        keyword_info: { search_volume: 2400, cpc: 0.9 },
                        keyword_properties: { keyword_difficulty: 19 },
                        search_intent_info: { main_intent: "informational" },
                      },
                      first_domain_serp_element: { rank_group: 4, url: "https://rival-bakery.test/starter-guide/" },
                    },
                  ],
                },
              ],
            },
          ],
        });
      }
      if (url.endsWith("backlinks/summary/live")) {
        return jsonResponse({ tasks: [{ status_code: 20000, result: [{ backlinks: 140, referring_domains: 27, rank: 31 }] }] });
      }
      if (url.endsWith("backlinks/referring_domains/live")) {
        return jsonResponse({
          tasks: [
            {
              status_code: 20000,
              result: [{ items: [{ domain: "cornwall-food.example", rank: 44, backlinks: 8, first_seen: "2025-11-01" }] }],
            },
          ],
        });
      }
      if (url.endsWith("backlinks/domain_pages_summary/live")) {
        return jsonResponse({
          tasks: [
            {
              status_code: 20000,
              result: [
                {
                  items: [
                    { page: "https://harbour-bakery.test/old-apple-cake-recipe/", status_code: 404, referring_domains: 5, backlinks: 11 },
                    { page: "https://harbour-bakery.test/already-moved/", status_code: 404, referring_domains: 3, backlinks: 4 },
                  ],
                },
              ],
            },
          ],
        });
      }
      if (url.endsWith("ai_optimization/llm_mentions/search/live")) {
        return jsonResponse({ status_code: 40200, status_message: "Payment required for DataForSEO LLM mentions" }, 402);
      }
      return jsonResponse({ tasks: [{ status_code: 20000, result: [] }] });
    };

    const { home, site, visibility } = await setup({ GALLEY_SEARCH_DATA_KEY: "baker@example.com:secretpass" }, scriptedFetch);
    const state = await visibility.refreshIntelligence(site, {
      domain: "harbour-bakery.test",
      locationCode: 2826,
      competitors: ["rival-bakery.test"],
    });

    // Basic auth header verified
    const expectedBasic = `Basic ${Buffer.from("baker@example.com:secretpass", "utf8").toString("base64")}`;

    expect(seen.every((call) => call.auth === expectedBasic)).toBe(true);
    expect(state.status).toEqual({ configured: true, managed: false, source: "env" });
    expect(state.snapshot).not.toBeNull();

    const snap = state.snapshot!;

    expect(snap.tallies).toMatchObject({
      rankingKeywords: 3,
      top3Count: 1,
      strikingDistanceCount: 2,
      referringDomains: 27,
      brokenBacklinkTargets: 1,
      aiCitationsCount: 0,
    });

    // Route-to-entry matching + striking-distance ordering
    expect(snap.strikingDistance[0]).toMatchObject({
      keyword: "overnight sourdough dough",
      position: 6,
      entryPath: "src/content/blog/overnight-dough.md",
      entryTitle: "Why our dough rests overnight",
    });

    // Cannibalization detection
    expect(snap.cannibalization).toHaveLength(1);
    expect(snap.cannibalization[0]!.keyword).toBe("portwenn sourdough bakery");
    expect(snap.cannibalization[0]!.pages.map((p) => p.urlPath)).toEqual(["/", "/about/"]);

    // Competitor gap + suggested collection
    expect(snap.competitorGaps).toHaveLength(1);
    expect(snap.competitorGaps[0]).toMatchObject({
      keyword: "sourdough starter feeding guide",
      competitor: "rival-bakery.test",
      suggestedCollection: "blog",
    });

    // Broken backlink recovery excludes /already-moved/ (covered in _redirects) and suggests closest route (/blog/apple-cake/)
    expect(snap.backlinks.brokenTargets).toHaveLength(1);
    expect(snap.backlinks.brokenTargets[0]).toMatchObject({
      urlPath: "/old-apple-cake-recipe/",
      referringDomains: 5,
      suggestedTarget: "/blog/apple-cake/",
    });

    // Graceful llm_mentions fallback with zero vendor string
    expect(snap.aiCitations).toMatchObject({ available: false, items: [] });
    expect(JSON.stringify(snap).toLowerCase()).not.toContain("dataforseo");

    // Snapshot persisted to <home>/state/<siteId>/seo-intelligence.json
    expect(existsSync(join(home, "state", site.id, "seo-intelligence.json"))).toBe(true);
    const reloaded = await visibility.intelligence(site);

    expect(reloaded.snapshot?.domain).toBe("harbour-bakery.test");
  });

  it("uses Bearer auth and custom proxy URL in Galley Cloud managed mode", async () => {
    let capturedAuth: string | null = null;
    let capturedUrl = "";
    const managedFetch: typeof fetch = async (input, init) => {
      capturedUrl = String(input);
      capturedAuth = new Headers(init?.headers).get("authorization");
      return jsonResponse({ tasks: [{ status_code: 20000, result: [{ items: [] }] }] });
    };

    const { site, visibility } = await setup(
      {
        GALLEY_SEARCH_DATA_MANAGED: "1",
        GALLEY_SEARCH_DATA_KEY: "cloud-proxy-bearer-token",
        GALLEY_SEARCH_DATA_BASE_URL: "http://127.0.0.1:4999/search/v3",
      },
      managedFetch
    );
    const state = await visibility.refreshIntelligence(site, { domain: "harbour-bakery.test" });

    expect(state.status).toEqual({ configured: true, managed: true, source: "managed" });
    expect(capturedAuth).toBe("Bearer cloud-proxy-bearer-token");
    expect(capturedUrl).toMatch(/^http:\/\/127\.0\.0\.1:4999\/search\/v3\//);
  });

  it("explores keywords, tunes an existing entry in Proof, and drafts a gap page in Proof", async () => {
    const fetchMock: typeof fetch = async (input) => {
      const url = String(input);

      if (url.endsWith("dataforseo_labs/google/keyword_suggestions/live")) {
        return jsonResponse({
          tasks: [
            {
              status_code: 20000,
              result: [
                {
                  items: [
                    { keyword: "overnight dough", keyword_info: { search_volume: 1200, cpc: 0.7 }, keyword_properties: { keyword_difficulty: 20 } },
                    { keyword: "rye bread starter", keyword_info: { search_volume: 950, cpc: 1.1 }, keyword_properties: { keyword_difficulty: 25 } },
                  ],
                },
              ],
            },
          ],
        });
      }
      if (url.endsWith("dataforseo_labs/google/search_intent/live")) {
        return jsonResponse({
          tasks: [
            {
              status_code: 20000,
              result: [
                {
                  items: [
                    { keyword: "overnight dough", keyword_intent: { label: "informational" } },
                    { keyword: "rye bread starter", keyword_intent: { label: "informational" } },
                  ],
                },
              ],
            },
          ],
        });
      }
      if (url.endsWith("serp/google/organic/live/advanced")) {
        return jsonResponse({
          tasks: [
            {
              status_code: 20000,
              result: [
                {
                  items: [
                    {
                      type: "organic",
                      rank_group: 1,
                      title: "How Overnight Sourdough Fermentation Works",
                      url: "https://guide.example/overnight-dough",
                      domain: "guide.example",
                      description: "Slow cold fermentation builds an open crumb and dark crust.",
                    },
                  ],
                },
              ],
            },
          ],
        });
      }
      return jsonResponse({ tasks: [{ status_code: 20000, result: [] }] });
    };

    let callIndex = 0;
    const fakeAi = {
      messages: {
        create: async () => {
          callIndex += 1;
          const payload =
            callIndex === 1
              ? {
                  title: "Why our sourdough dough rests overnight",
                  description: "How our slow overnight rise in the cool room builds open crumb, dark crust, and keeping quality in small-kitchen sourdough.",
                  opening: null,
                  summary: "Sharpened title and description for overnight sourdough searches.",
                }
              : {
                  slug: "rye-bread-starter",
                  title: "Rye bread starter guide",
                  description: "How to mix and maintain a lively rye bread starter for home and small-bakery loaves.",
                  body: "## Getting started\n\nA rye starter ferments quickly. [TBD: add bakery feeding ratio].",
                  summary: "Drafted initial rye bread starter guide in Journal.",
                };

          return {
            content: [{ type: "text", text: JSON.stringify(payload) }],
            usage: { input_tokens: 400, output_tokens: 120 },
          };
        },
      },
    } as unknown as Anthropic;

    const { site, visibility } = await setup(
      {
        ANTHROPIC_API_KEY: "sk-ant-test-key-0000000000000000",
        GALLEY_SEARCH_DATA_KEY: "user:pass1234",
      },
      fetchMock,
      fakeAi
    );

    const explored = await visibility.exploreKeyword(site, { keyword: "overnight dough" });

    expect(explored.suggestions).toHaveLength(2);
    expect(explored.suggestions[0]).toMatchObject({
      keyword: "overnight dough",
      intent: "informational",
      coveredBy: { entryPath: "src/content/blog/overnight-dough.md" },
    });
    expect(explored.serpTop[0]?.domain).toBe("guide.example");

    const tuned = await visibility.tuneEntry(site, { path: "src/content/blog/overnight-dough.md", keyword: "overnight sourdough dough" });

    expect(tuned.applied).toBe(2);
    expect(tuned.title?.after).toBe("Why our sourdough dough rests overnight");
    expect(tuned.serpTop).toHaveLength(1);

    const drafted = await visibility.draftGapPage(site, { keyword: "rye bread starter", collection: "blog" });

    expect(drafted.path).toBe("src/content/blog/rye-bread-starter.md");
    expect(drafted.collection).toBe("blog");

    const changes = await site.changes();

    expect(changes.files.map((f) => f.path)).toEqual(
      expect.arrayContaining(["src/content/blog/overnight-dough.md", "src/content/blog/rye-bread-starter.md"])
    );
  });
});
