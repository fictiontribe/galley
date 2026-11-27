/**
 * Search & AI Intelligence over HTTP: BYOK key storage, managed metadata on
 * GET /api/meta, live refresh & keyword explorer routes, vendor-name scrubbing,
 * and role-based route access.
 */
import { execFileSync } from "node:child_process";
import { cpSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ROUTE_ACCESS, roleMayCall } from "@galley/core/install/route-access";
import type { KeywordExploreResult, SearchIntelligenceState } from "@galley/core/seo";
import type { MetaInfo, SecretStatus, SiteDetail } from "@galley/core/types";
import { startServer } from "../src/server";
import type { RunningServer } from "../src/types";

const starter = fileURLToPath(new URL("../../../starters/astro-starter", import.meta.url));

describe("visibility intelligence HTTP routes", () => {
  let tmp = "";
  let upstream: Server;
  let upstreamUrl = "";
  let lastAuth = "";
  let server: RunningServer;
  let siteId = "";

  async function api<T>(method: string, path: string, body?: unknown): Promise<{ status: number; body: T; raw: string }> {
    const response = await fetch(`${server.url}${path}`, {
      method,
      headers: {
        authorization: `Bearer ${server.token}`,
        ...(body === undefined ? {} : { "content-type": "application/json" }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const raw = await response.text();

    return { status: response.status, body: (raw ? JSON.parse(raw) : null) as T, raw };
  }

  beforeAll(async () => {
    upstream = createServer((req, res) => {
      lastAuth = String(req.headers.authorization ?? "");
      const url = req.url ?? "";

      res.setHeader("content-type", "application/json");
      if (url.endsWith("ranked_keywords/live")) {
        res.end(
          JSON.stringify({
            tasks: [
              {
                status_code: 20000,
                result: [
                  {
                    items: [
                      {
                        keyword_data: {
                          keyword: "residential architecture studio",
                          keyword_info: { search_volume: 900, cpc: 3.2 },
                          keyword_properties: { keyword_difficulty: 29 },
                          search_intent_info: { main_intent: "commercial" },
                        },
                        ranked_serp_element: {
                          serp_item: { rank_group: 7, url: "https://lowfield.example/", etv: 54 },
                        },
                      },
                    ],
                  },
                ],
              },
            ],
          })
        );
        return;
      }
      if (url.endsWith("keyword_suggestions/live")) {
        res.end(
          JSON.stringify({
            tasks: [
              {
                status_code: 20000,
                result: [
                  {
                    items: [
                      {
                        keyword: "loft conversion architects",
                        keyword_info: { search_volume: 1100, cpc: 2.5 },
                        keyword_properties: { keyword_difficulty: 26 },
                        search_intent_info: { main_intent: "commercial" },
                      },
                    ],
                  },
                ],
              },
            ],
          })
        );
        return;
      }
      if (url.endsWith("llm_mentions/search/live")) {
        res.statusCode = 402;
        res.end(JSON.stringify({ status_code: 40200, status_message: "Plan upgrade required" }));
        return;
      }
      res.end(JSON.stringify({ tasks: [{ status_code: 20000, result: [{ items: [] }] }] }));
    });
    await new Promise<void>((resolve) => upstream.listen(0, "127.0.0.1", resolve));
    upstreamUrl = `http://127.0.0.1:${(upstream.address() as AddressInfo).port}`;

    tmp = realpathSync(mkdtempSync(join(tmpdir(), "galley-vis-intel-")));
    const site = join(tmp, "site");

    cpSync(starter, site, { recursive: true, filter: (source) => !["node_modules", ".astro", "dist"].includes(basename(source)) });
    const git = (...args: string[]) => execFileSync("git", args, { cwd: site, encoding: "utf8" });

    git("init", "-q");
    git("symbolic-ref", "HEAD", "refs/heads/main");
    git("config", "user.name", "Intel Test");
    git("config", "user.email", "intel@example.invalid");
    git("add", "-A");
    git("commit", "-q", "-m", "Initial");

    server = await startServer({
      port: 0,
      home: join(tmp, "home"),
      webDir: join(tmp, "no-ui"),
      env: { PATH: process.env.PATH, HOME: tmp, GALLEY_SEARCH_DATA_BASE_URL: upstreamUrl },
      notice: () => {},
    });
    siteId = (await api<SiteDetail>("POST", "/api/sites/open", { path: site })).body.id;
  }, 60_000);

  afterAll(async () => {
    await server?.close();
    await new Promise((resolve) => upstream?.close(resolve));
    if (tmp) rmSync(tmp, { recursive: true, force: true });
  });

  it("enforces edit access on intelligence routes and manage access on secret writes", () => {
    const routes = [
      "GET /api/sites/:siteId/visibility/intelligence",
      "POST /api/sites/:siteId/visibility/intelligence/refresh",
      "POST /api/sites/:siteId/visibility/intelligence/explore",
      "POST /api/sites/:siteId/visibility/intelligence/tune",
      "POST /api/sites/:siteId/visibility/intelligence/draft-gap",
    ] as const;

    for (const route of routes) {
      expect(ROUTE_ACCESS[route]).toBe("edit");
      expect(roleMayCall("contributor", route)).toBe(true);
      expect(roleMayCall("editor", route)).toBe(true);
      expect(roleMayCall("owner", route)).toBe(true);
    }
    expect(ROUTE_ACCESS["PUT /api/secrets/:name"]).toBe("manage");
    expect(roleMayCall("contributor", "PUT /api/secrets/:name")).toBe(false);
    expect(roleMayCall("owner", "PUT /api/secrets/:name")).toBe(true);
  });

  it("returns unconfigured BYOK state before a key is saved, then refreshes and explores once connected", async () => {
    const meta = await api<MetaInfo>("GET", "/api/meta");

    expect(meta.status).toBe(200);
    expect(meta.body.searchData).toBeUndefined();

    const initial = await api<SearchIntelligenceState>("GET", `/api/sites/${siteId}/visibility/intelligence`);

    expect(initial.status).toBe(200);
    expect(initial.body.status).toEqual({ configured: false, managed: false, source: null });

    const refused = await api<{ error: { code: string } }>("POST", `/api/sites/${siteId}/visibility/intelligence/refresh`, {
      domain: "lowfield.example",
    });

    expect(refused.status).toBe(400);
    expect(refused.body.error.code).toBe("unconfigured");

    // Save BYOK credentials via PUT /api/secrets/search_data (never echoed back)
    const secretKey = "ops@lowfield.example:byok-key-9876";
    const saved = await api<SecretStatus>("PUT", "/api/secrets/search_data", { value: secretKey });

    expect(saved.status).toBe(200);
    expect(saved.body).toEqual({ name: "search_data", configured: true, source: "stored", hint: "9876" });
    expect(saved.raw).not.toContain(secretKey);

    const refreshed = await api<SearchIntelligenceState>("POST", `/api/sites/${siteId}/visibility/intelligence/refresh`, {
      domain: "lowfield.example",
      locationCode: 2826,
    });

    expect(refreshed.status).toBe(200);
    expect(lastAuth).toBe(`Basic ${Buffer.from(secretKey, "utf8").toString("base64")}`);
    expect(refreshed.body.snapshot?.tallies.strikingDistanceCount).toBe(1);
    expect(refreshed.body.snapshot?.rankings[0]?.entryPath).toBe("src/content/pages/index.md");
    expect(refreshed.body.snapshot?.aiCitations.available).toBe(false);
    const vendorWord = ["data", "for", "seo"].join("");
    expect(refreshed.raw.toLowerCase()).not.toContain(vendorWord);

    const explored = await api<KeywordExploreResult>("POST", `/api/sites/${siteId}/visibility/intelligence/explore`, {
      keyword: "loft conversion architects",
      locationCode: 2826,
    });

    expect(explored.status).toBe(200);
    expect(explored.body.suggestions[0]?.keyword).toBe("loft conversion architects");

    const tuned = await api<{ error: { code: string } }>("POST", `/api/sites/${siteId}/visibility/intelligence/tune`, {
      path: "src/content/pages/index.md",
      keyword: "residential architecture studio",
      locationCode: 2826,
    });

    expect(tuned.status).toBe(400);
    expect(tuned.body.error.code).toBe("unconfigured");

    const drafted = await api<{ error: { code: string } }>("POST", `/api/sites/${siteId}/visibility/intelligence/draft-gap`, {
      keyword: "loft conversion architects",
      collection: "pages",
      locationCode: 2826,
    });

    expect(drafted.status).toBe(400);
    expect(drafted.body.error.code).toBe("unconfigured");
  });

  it("exposes searchData.managed on GET /api/meta when GALLEY_SEARCH_DATA_MANAGED=1", async () => {
    const managedServer = await startServer({
      port: 0,
      home: join(tmp, "home-managed"),
      webDir: join(tmp, "no-ui"),
      env: {
        PATH: process.env.PATH,
        HOME: tmp,
        GALLEY_SEARCH_DATA_MANAGED: "1",
        GALLEY_SEARCH_DATA_KEY: "managed-cloud-token",
        GALLEY_SEARCH_DATA_BASE_URL: upstreamUrl,
      },
      notice: () => {},
    });

    try {
      const response = await fetch(`${managedServer.url}/api/meta`, {
        headers: { authorization: `Bearer ${managedServer.token}` },
      });
      const meta = (await response.json()) as MetaInfo;

      expect(response.status).toBe(200);
      expect(meta.searchData).toEqual({ managed: true });
    } finally {
      await managedServer.close();
    }
  });
});
